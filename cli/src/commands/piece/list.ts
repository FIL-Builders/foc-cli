import { getPiecesWithMetadata } from '@filoz/synapse-core/pdp-verifier'
import { getPdpDataSet } from '@filoz/synapse-core/warm-storage'
import { z } from 'incur'
import { privateKeyClient } from '../../client.ts'
import { chainCta, commandOutput, OutputContext } from '../../output.ts'
import { datasetScannerUrl, pieceScannerUrl } from '../../utils.ts'

export const listCommand = {
  description: 'List pieces in a dataset with metadata',
  mcp: {
    annotations: { title: 'List pieces in a dataset', readOnlyHint: true },
  },
  args: z.object({
    dataSetId: z.coerce.number().describe('Dataset ID to list pieces from'),
  }),
  options: z.object({
    chain: z
      .number()
      .default(314159)
      .describe('Chain ID. 314159 = Calibration, 314 = Mainnet'),
    offset: z.coerce
      .number()
      .default(0)
      .describe('Piece offset to start from (for pagination)'),
    limit: z.coerce
      .number()
      .default(100)
      .describe('Max pieces per page (defaults to 100)'),
    debug: z.boolean().optional().describe('Enable debug mode'),
  }),
  alias: { chain: 'c' },
  output: commandOutput({
    dataSetId: z.string(),
    datasetScannerUrl: z.string(),
    pieces: z.array(
      z.object({
        id: z.string(),
        cid: z.string(),
        scannerUrl: z.string(),
        metadata: z.record(z.string(), z.string()),
      })
    ),
    hasMore: z.boolean(),
    nextOffset: z.number().optional(),
  }),
  examples: [
    { args: { dataSetId: 42 }, description: 'List pieces in dataset #42' },
  ],
  async run(c: any) {
    const out = new OutputContext(c)
    const { client, chain } = privateKeyClient(c.options.chain)

    try {
      out.step('Fetching dataset')
      const dataSet = await getPdpDataSet(client, {
        dataSetId: BigInt(c.args.dataSetId),
      })
      if (!dataSet)
        return out.fail('NOT_FOUND', `Dataset ${c.args.dataSetId} not found`)

      const offset = c.options.offset ?? 0
      const limit = c.options.limit ?? 100

      out.step('Fetching pieces')
      const { pieces, hasMore } = await getPiecesWithMetadata(client, {
        dataSet,
        address: client.account.address,
        offset: BigInt(offset),
        limit: BigInt(limit),
      })

      const piecesList = pieces.map((piece: any) => {
        const cid = piece.cid.toString()
        return {
          id: piece.id,
          cid,
          scannerUrl: pieceScannerUrl(cid, chain),
          metadata: piece.metadata,
        }
      })

      const nextOffset = offset + piecesList.length
      const totalPieces = Number(dataSet.activePieceCount)
      const nextPage = hasMore
        ? [
            {
              command: 'piece list',
              args: { dataSetId: c.args.dataSetId },
              options: { offset: nextOffset, limit },
              description: `Show the next page of pieces (offset ${nextOffset})`,
            },
            {
              command: 'piece list',
              args: { dataSetId: c.args.dataSetId },
              options: { offset: 0, limit: totalPieces },
              description: `Fetch all ${totalPieces} pieces in one call`,
            },
          ]
        : []

      return out.done(
        {
          dataSetId: c.args.dataSetId.toString(),
          datasetScannerUrl: datasetScannerUrl(c.args.dataSetId, chain),
          pieces: piecesList,
          hasMore,
          ...(hasMore ? { nextOffset } : {}),
        },
        {
          cta: chainCta(c.options.chain, {
            commands: [
              ...nextPage,
              {
                command: 'piece remove',
                args: { dataSetId: c.args.dataSetId },
                description: 'Remove a piece',
              },
              {
                command: 'dataset details',
                options: { dataSetId: c.args.dataSetId },
                description: 'View full dataset details',
              },
            ],
          }),
        }
      )
    } catch (error) {
      if (c.options.debug) console.error(error)
      return out.fail('PIECE_LIST_FAILED', (error as Error).message)
    }
  },
}
