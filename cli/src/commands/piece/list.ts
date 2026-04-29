import { getPiecesWithMetadata } from '@filoz/synapse-core/pdp-verifier'
import { getPdpDataSet } from '@filoz/synapse-core/warm-storage'
import { z } from 'incur'
import { privateKeyClient } from '../../client.ts'
import { OutputContext } from '../../output.ts'
import { datasetScannerUrl, pieceScannerUrl } from '../../utils.ts'

export const listCommand = {
  description: 'List pieces in a dataset with metadata',
  args: z.object({
    dataSetId: z.coerce.number().describe('Dataset ID to list pieces from'),
  }),
  options: z.object({
    chain: z
      .number()
      .default(314159)
      .describe('Chain ID. 314159 = Calibration, 314 = Mainnet'),
    debug: z.boolean().optional().describe('Enable debug mode'),
  }),
  alias: { chain: 'c' },
  output: z.object({
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

      out.step('Fetching pieces')
      const { pieces } = await getPiecesWithMetadata(client, {
        dataSet,
        address: client.account.address,
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

      return out.done(
        {
          dataSetId: c.args.dataSetId.toString(),
          datasetScannerUrl: datasetScannerUrl(c.args.dataSetId, chain),
          pieces: piecesList,
        },
        {
          cta: {
            commands: [
              {
                command: 'piece remove',
                args: { dataSetId: c.args.dataSetId },
                description: 'Remove a piece',
              },
              {
                command: 'dataset details',
                description: 'View full dataset details',
              },
            ],
          },
        }
      )
    } catch (error) {
      if (c.options.debug) console.error(error)
      return out.fail('PIECE_LIST_FAILED', (error as Error).message)
    }
  },
}
