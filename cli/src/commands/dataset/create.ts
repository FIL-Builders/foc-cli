import * as sp from '@filoz/synapse-core/sp'
import { getPDPProvider } from '@filoz/synapse-core/sp-registry'
import { z } from 'incur'
import { privateKeyClient } from '../../client.ts'
import { OutputContext } from '../../output.ts'
import { datasetScannerUrl, hashLink } from '../../utils.ts'

export const createCommand = {
  description: 'Create a new PDP dataset with a storage provider',
  args: z.object({
    providerId: z.coerce
      .number()
      .optional()
      .describe('Provider ID. Use provider list to choose one.'),
  }),
  options: z.object({
    chain: z
      .number()
      .default(314159)
      .describe('Chain ID. 314159 = Calibration, 314 = Mainnet'),
    cdn: z.boolean().optional().describe('Enable CDN for this dataset'),
    debug: z.boolean().optional().describe('Enable debug mode'),
  }),
  alias: { chain: 'c' },
  output: z.object({
    dataSetId: z.string(),
    scannerUrl: z.string(),
    providerId: z.string(),
  }),
  examples: [
    { args: { providerId: 1 }, description: 'Create dataset with provider #1' },
    {
      args: { providerId: 1 },
      options: { cdn: true },
      description: 'Create dataset with CDN',
    },
  ],
  async run(c: any) {
    const out = new OutputContext(c)
    const { client, chain } = privateKeyClient(c.options.chain)

    try {
      let provider: any
      if (c.args.providerId) {
        out.step('Fetching provider')
        provider = await getPDPProvider(client, {
          providerId: BigInt(c.args.providerId),
        })
      } else {
        return out.fail(
          'PROVIDER_REQUIRED',
          'providerId argument required in non-interactive mode',
          {
            retryable: true,
            cta: {
              description: 'List providers first:',
              commands: [
                {
                  command: 'provider list',
                  description: 'List available providers',
                },
              ],
            },
          }
        )
      }

      out.info(
        `Selected provider: #${provider.id} - ${provider.serviceProvider} ${provider.pdp.serviceURL}`
      )

      out.step('Creating data set')
      const result = await sp.createDataSet(client, {
        payee: provider.payee,
        payer: client.account.address,
        serviceURL: provider.pdp.serviceURL,
        cdn: c.options.cdn ?? false,
      })

      out.step('Waiting for transaction to be mined')
      out.info(`Tx: ${hashLink(result.txHash, chain)}`)
      const dataset = await sp.waitForCreateDataSet(result)

      return out.done(
        {
          dataSetId: dataset.dataSetId,
          scannerUrl: datasetScannerUrl(dataset.dataSetId, chain),
          providerId: provider.id,
        },
        {
          cta: {
            description: 'Next steps:',
            commands: [
              {
                command: 'piece upload',
                args: {
                  path: '<file>',
                  dataSetId: dataset.dataSetId.toString(),
                },
                description: 'Upload a piece',
              },
              { command: 'dataset list', description: 'List all datasets' },
            ],
          },
        }
      )
    } catch (error) {
      if (c.options.debug) console.error(error)
      return out.fail('DATASET_CREATE_FAILED', (error as Error).message)
    }
  },
}
