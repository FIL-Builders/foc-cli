import * as sp from '@filoz/synapse-core/sp'
import { getPDPProvider } from '@filoz/synapse-core/sp-registry'
import { z } from 'incur'
import { privateKeyClient, requireWallet } from '../../client.ts'
import { chainCta, commandOutput, OutputContext } from '../../output.ts'
import { datasetScannerUrl, hashLink } from '../../utils.ts'

export const createCommand = {
  description:
    'Create a new PDP dataset with a storage provider. Starts a paid storage rail: an onchain transaction that commits ongoing USDFC charges.',
  mcp: {
    annotations: {
      title: 'Create dataset (starts paid rail)',
      destructiveHint: false,
    },
  },
  args: z.object({
    providerId: z.coerce
      .number()
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
  output: commandOutput({
    dataSetId: z.string(),
    scannerUrl: z.string(),
    providerId: z.string(),
  }),
  examples: [
    { args: { providerId: 1 }, description: 'Create dataset with provider #1' },
  ],
  // --cdn is a switch; `{ cdn: true }` would render as `--cdn true`, and the
  // parser reads that `true` as a stray positional rather than as the value.
  hint: 'Add --cdn to enable CDN for the dataset. It is a switch — pass `--cdn` alone, not `--cdn true`.',
  async run(c: any) {
    const out = new OutputContext(c)
    const blocked = requireWallet(c, out)
    if (blocked) return blocked
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
            cta: chainCta(c.options.chain, {
              description: 'List providers first:',
              commands: [
                {
                  command: 'provider list',
                  description: 'List available providers',
                },
              ],
            }),
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
          cta: chainCta(c.options.chain, {
            description: 'Next steps:',
            commands: [
              {
                command: 'upload',
                args: { path: '<file>' },
                description:
                  'Upload a file — provider selection reuses this dataset when its provider is chosen',
              },
              {
                command: 'dataset details',
                options: { dataSetId: dataset.dataSetId.toString() },
                description: 'Inspect the new dataset',
              },
            ],
          }),
        }
      )
    } catch (error) {
      if (c.options.debug) console.error(error)
      return out.fail('DATASET_CREATE_FAILED', (error as Error).message)
    }
  },
}
