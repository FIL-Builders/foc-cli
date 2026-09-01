import { getPiecesWithMetadata } from '@filoz/synapse-core/pdp-verifier'
import { getPdpDataSet } from '@filoz/synapse-core/warm-storage'
import { z } from 'incur'
import { privateKeyClient, requireWallet } from '../../client.ts'
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
    cursor: z
      .string()
      .regex(
        /^\d+$/,
        'must be the decimal nextCursor value from a previous page'
      )
      .optional()
      .describe(
        'Resume from a previous page: pass the nextCursor value that page returned (an opaque decimal string). Omit for the first page.'
      ),
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
    nextCursor: z
      .string()
      .optional()
      .describe(
        'Present when more pieces remain — pass it back as --cursor to fetch the next page'
      ),
  }),
  examples: [
    { args: { dataSetId: 42 }, description: 'List pieces in dataset #42' },
  ],
  async run(c: any) {
    const out = new OutputContext(c)
    const blocked = requireWallet(c, out)
    if (blocked) return blocked
    const { client, chain } = privateKeyClient(c.options.chain)

    try {
      out.step('Fetching dataset')
      const dataSet = await getPdpDataSet(client, {
        dataSetId: BigInt(c.args.dataSetId),
      })
      if (!dataSet)
        return out.fail('NOT_FOUND', `Dataset ${c.args.dataSetId} not found`)

      const limit = c.options.limit ?? 100

      out.step('Fetching pieces')
      const { items, nextCursor } = await getPiecesWithMetadata(client, {
        dataSet,
        address: client.account.address,
        cursor: BigInt(c.options.cursor ?? 0),
        limit: BigInt(limit),
      })

      const piecesList = items.map((piece: any) => {
        const cid = piece.cid.toString()
        return {
          id: piece.id,
          cid,
          scannerUrl: pieceScannerUrl(cid, chain),
          metadata: piece.metadata,
        }
      })

      // Cursors are opaque continuation values; there is no total piece count
      // any more (synapse-core 0.8 dropped activePieceCount), so "fetch all"
      // means following nextCursor pages until it stops appearing.
      const nextPage =
        nextCursor !== undefined
          ? [
              {
                command: 'piece list',
                args: { dataSetId: c.args.dataSetId },
                options: { cursor: nextCursor.toString(), limit },
                description: `Show the next page of pieces (cursor ${nextCursor})`,
              },
            ]
          : []

      return out.done(
        {
          dataSetId: c.args.dataSetId.toString(),
          datasetScannerUrl: datasetScannerUrl(c.args.dataSetId, chain),
          pieces: piecesList,
          ...(nextCursor !== undefined
            ? { nextCursor: nextCursor.toString() }
            : {}),
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
