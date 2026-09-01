import { getPiecesWithMetadata } from '@filoz/synapse-core/pdp-verifier'
import { getPdpDataSet } from '@filoz/synapse-core/warm-storage'
import { z } from 'incur'
import { privateKeyClient, requireWallet } from '../../client.ts'
import { chainCta, commandOutput, OutputContext } from '../../output.ts'
import { datasetScannerUrl, pieceScannerUrl } from '../../utils.ts'

export const detailsCommand = {
  description: 'Show dataset metadata and all pieces with their metadata',
  mcp: {
    annotations: { title: 'Dataset details', readOnlyHint: true },
  },
  options: z.object({
    dataSetId: z.coerce.number().describe('Dataset ID to inspect'),
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
  alias: { chain: 'c', dataSetId: 'd' },
  output: commandOutput({
    dataset: z.object({
      dataSetId: z.string(),
      scannerUrl: z.string(),
      provider: z.string(),
      serviceURL: z.string(),
      cdn: z.boolean(),
      live: z.boolean(),
      managed: z.boolean(),
      terminating: z.boolean(),
      hasActivePieces: z.boolean(),
      metadata: z.record(z.string(), z.string()),
    }),
    pieces: z.array(
      z.object({
        id: z.string(),
        cid: z.string(),
        scannerUrl: z.string(),
        url: z.string(),
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
  async run(c: any) {
    const out = new OutputContext(c)
    const blocked = requireWallet(c, out)
    if (blocked) return blocked
    const { client, chain } = privateKeyClient(c.options.chain)

    try {
      out.step('Fetching datasets')
      const ds = await getPdpDataSet(client, {
        dataSetId: BigInt(c.options.dataSetId),
      })

      if (!ds) {
        return out.fail(
          'DATASET_NOT_FOUND',
          `Dataset ${c.options.dataSetId} not found`
        )
      }

      const limit = c.options.limit ?? 100

      out.step('Fetching pieces and metadata')
      const { items, nextCursor } = await getPiecesWithMetadata(client, {
        dataSet: ds,
        address: client.account.address,
        cursor: BigInt(c.options.cursor ?? 0),
        limit: BigInt(limit),
      })

      const dataset = {
        dataSetId: ds.dataSetId,
        scannerUrl: datasetScannerUrl(ds.dataSetId, chain),
        provider: ds.provider.payee,
        serviceURL: ds.provider.pdp.serviceURL,
        cdn: !!ds.cdn,
        live: !!ds.live,
        managed: !!ds.managed,
        terminating: ds.pdpEndEpoch > 0n,
        hasActivePieces: ds.hasActivePieces,
        metadata: ds.metadata,
      }

      const piecesList = items.map((piece: any) => {
        const cid = piece.cid.toString()
        return {
          id: piece.id,
          cid,
          scannerUrl: pieceScannerUrl(cid, chain),
          url: piece.url,
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
                command: 'dataset details',
                options: {
                  dataSetId: c.options.dataSetId,
                  cursor: nextCursor.toString(),
                  limit,
                },
                description: `Show the next page of pieces (cursor ${nextCursor})`,
              },
            ]
          : []

      return out.done(
        {
          dataset,
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
                description: 'Remove a piece from this dataset',
              },
              {
                command: 'dataset terminate',
                description: 'Terminate this dataset',
              },
            ],
          }),
        }
      )
    } catch (error) {
      if (c.options.debug) console.error(error)
      return out.fail('DATASET_DETAILS_FAILED', (error as Error).message)
    }
  },
}
