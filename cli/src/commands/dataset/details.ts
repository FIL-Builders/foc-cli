import { getPiecesWithMetadata } from '@filoz/synapse-core/pdp-verifier'
import { getPdpDataSet } from '@filoz/synapse-core/warm-storage'
import { z } from 'incur'
import { privateKeyClient } from '../../client.ts'
import { OutputContext } from '../../output.ts'
import { datasetScannerUrl, pieceScannerUrl } from '../../utils.ts'

export const detailsCommand = {
  description: 'Show dataset metadata and all pieces with their metadata',
  options: z.object({
    dataSetId: z.coerce.number().describe('Dataset ID to inspect'),
    chain: z
      .number()
      .default(314159)
      .describe('Chain ID. 314159 = Calibration, 314 = Mainnet'),
    debug: z.boolean().optional().describe('Enable debug mode'),
  }),
  alias: { chain: 'c', dataSetId: 'd' },
  output: z.object({
    dataset: z.object({
      dataSetId: z.string(),
      scannerUrl: z.string(),
      provider: z.string(),
      serviceURL: z.string(),
      cdn: z.boolean(),
      live: z.boolean(),
      managed: z.boolean(),
      terminating: z.boolean(),
      activePieceCount: z.string(),
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
  }),
  async run(c: any) {
    const out = new OutputContext(c)
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

      out.step('Fetching pieces and metadata')
      const { pieces } = await getPiecesWithMetadata(client, {
        dataSet: ds,
        address: client.account.address,
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
        activePieceCount: ds.activePieceCount,
        metadata: ds.metadata,
      }

      const piecesList = pieces.map((piece: any) => {
        const cid = piece.cid.toString()
        return {
          id: piece.id,
          cid,
          scannerUrl: pieceScannerUrl(cid, chain),
          url: piece.url,
          metadata: piece.metadata,
        }
      })

      return out.done(
        { dataset, pieces: piecesList },
        {
          cta: {
            commands: [
              {
                command: 'piece remove',
                description: 'Remove a piece from this dataset',
              },
              {
                command: 'dataset terminate',
                description: 'Terminate this dataset',
              },
            ],
          },
        }
      )
    } catch (error) {
      if (c.options.debug) console.error(error)
      return out.fail('DATASET_DETAILS_FAILED', (error as Error).message)
    }
  },
}
