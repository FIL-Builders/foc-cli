import { schedulePieceDeletion } from '@filoz/synapse-core/sp'
import { getPdpDataSet } from '@filoz/synapse-core/warm-storage'
import { z } from 'incur'
import { waitForTransactionReceipt } from 'viem/actions'
import { privateKeyClient, walletPreflight } from '../../client.ts'
import { chainCta, commandOutput, OutputContext } from '../../output.ts'
import { datasetScannerUrl, hashLink } from '../../utils.ts'

export const removeCommand = {
  description:
    'Remove a piece from a dataset. Schedules onchain deletion — the provider stops proving (and eventually drops) the piece.',
  mcp: {
    annotations: {
      title: 'Remove piece (deletes data)',
      destructiveHint: true,
    },
  },
  args: z.object({
    dataSetId: z.coerce.number().describe('Dataset ID'),
    pieceId: z.coerce.number().describe('Piece ID to remove'),
  }),
  options: z.object({
    chain: z
      .number()
      .default(314159)
      .describe('Chain ID. 314159 = Calibration, 314 = Mainnet'),
    debug: z.boolean().optional().describe('Enable debug mode'),
  }),
  alias: { chain: 'c' },
  output: commandOutput({
    status: z.string(),
    dataSetId: z.string(),
    datasetScannerUrl: z.string(),
    pieceId: z.string(),
  }),
  examples: [
    {
      args: { dataSetId: 42, pieceId: 7 },
      description: 'Remove piece #7 from dataset #42',
    },
  ],
  async run(c: any) {
    const out = new OutputContext(c)
    const preflight = walletPreflight()
    if (preflight)
      return out.fail(preflight.code, preflight.message, {
        cta: preflight.cta,
      })
    const { client, chain } = privateKeyClient(c.options.chain)

    try {
      out.step('Fetching dataset')
      const dataSetId = BigInt(c.args.dataSetId)
      const dataSet = await getPdpDataSet(client, { dataSetId })
      if (!dataSet)
        return out.fail('NOT_FOUND', `Data set ${dataSetId} not found.`)

      const pieceId = BigInt(c.args.pieceId)

      out.step(`Removing piece ${pieceId} from data set ${dataSetId}`)
      const result = await schedulePieceDeletion(client, {
        dataSetId,
        clientDataSetId: dataSet.clientDataSetId,
        pieceId,
        serviceURL: dataSet.provider.pdp.serviceURL,
      })

      out.step('Waiting for transaction to be mined')
      out.info(`Tx: ${hashLink(result.hash, chain)}`)
      await waitForTransactionReceipt(client, result)

      return out.done(
        {
          status: 'removed',
          dataSetId,
          datasetScannerUrl: datasetScannerUrl(dataSetId, chain),
          pieceId,
        },
        {
          cta: chainCta(c.options.chain, {
            commands: [
              {
                command: 'piece list',
                args: { dataSetId: c.args.dataSetId },
                description: 'View remaining pieces',
              },
              { command: 'dataset list', description: 'View all datasets' },
            ],
          }),
        }
      )
    } catch (error) {
      if (c.options.debug) console.error(error)
      return out.fail('PIECE_REMOVE_FAILED', (error as Error).message)
    }
  },
}
