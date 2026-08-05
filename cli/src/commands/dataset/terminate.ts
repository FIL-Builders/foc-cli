import { terminateServiceSync } from '@filoz/synapse-core/warm-storage'
import { z } from 'incur'
import { privateKeyClient, walletPreflight } from '../../client.ts'
import { chainCta, commandOutput, OutputContext } from '../../output.ts'
import { datasetScannerUrl, hashLink } from '../../utils.ts'

export const terminateCommand = {
  description:
    'Terminate a PDP dataset (stops storage service). Irreversible: ends the paid rail and releases the providers from proving they hold its pieces.',
  mcp: {
    annotations: {
      title: 'Terminate dataset (irreversible)',
      destructiveHint: true,
    },
  },
  args: z.object({
    dataSetId: z.coerce
      .number()
      .describe('Dataset ID to terminate (use dataset list to find)'),
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
    dataSetId: z.string(),
    scannerUrl: z.string(),
    status: z.string(),
  }),
  examples: [{ args: { dataSetId: 42 }, description: 'Terminate dataset #42' }],
  async run(c: any) {
    const out = new OutputContext(c)
    const preflight = walletPreflight()
    if (preflight)
      return out.fail(preflight.code, preflight.message, {
        cta: preflight.cta,
      })
    const { client, chain } = privateKeyClient(c.options.chain)

    try {
      out.step(`Terminating data set ${c.args.dataSetId}`)
      const { event } = await terminateServiceSync(client, {
        dataSetId: BigInt(c.args.dataSetId),
        onHash(hash: string) {
          out.info(`Tx: ${hashLink(hash, chain)}`)
        },
      })

      return out.done(
        {
          dataSetId: event.args.dataSetId,
          scannerUrl: datasetScannerUrl(event.args.dataSetId, chain),
          status: 'terminated',
        },
        {
          cta: chainCta(c.options.chain, {
            commands: [
              {
                command: 'dataset list',
                description: 'View remaining datasets',
              },
            ],
          }),
        }
      )
    } catch (error) {
      if (c.options.debug) console.error(error)
      return out.fail('DATASET_TERMINATE_FAILED', (error as Error).message)
    }
  },
}
