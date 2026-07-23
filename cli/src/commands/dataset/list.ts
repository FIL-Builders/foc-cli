import { getPdpDataSets } from '@filoz/synapse-core/warm-storage'
import { z } from 'incur'
import { getBlockNumber } from 'viem/actions'
import { privateKeyClient } from '../../client.ts'
import { chainCta, commandOutput, OutputContext } from '../../output.ts'
import { datasetScannerUrl } from '../../utils.ts'

export const listCommand = {
  description: 'List all PDP datasets with provider info and status',
  mcp: {
    annotations: { title: 'List datasets', readOnlyHint: true },
  },
  options: z.object({
    chain: z
      .number()
      .default(314159)
      .describe('Chain ID. 314159 = Calibration, 314 = Mainnet'),
    debug: z.boolean().optional().describe('Enable debug mode'),
  }),
  alias: { chain: 'c' },
  output: commandOutput({
    datasets: z.array(
      z.object({
        dataSetId: z.string(),
        scannerUrl: z.string(),
        provider: z.string(),
        serviceURL: z.string(),
        cdn: z.boolean(),
        live: z.boolean(),
        managed: z.boolean(),
        terminating: z.boolean(),
        terminatingAtEpoch: z.string().optional(),
      })
    ),
    blockNumber: z.string(),
  }),
  async run(c: any) {
    const out = new OutputContext(c)
    const { client, chain } = privateKeyClient(c.options.chain)

    try {
      out.step('Listing data sets')
      const [dataSets, blockNumber] = await Promise.all([
        getPdpDataSets(client, { address: client.account.address }),
        getBlockNumber(client),
      ])

      const datasets = dataSets.map((ds: any) => ({
        dataSetId: ds.dataSetId,
        scannerUrl: datasetScannerUrl(ds.dataSetId, chain),
        provider: ds.provider.payee,
        serviceURL: ds.provider.pdp.serviceURL,
        cdn: !!ds.cdn,
        live: !!ds.live,
        managed: !!ds.managed,
        terminating: ds.pdpEndEpoch > 0n,
        terminatingAtEpoch: ds.pdpEndEpoch > 0n ? ds.pdpEndEpoch : undefined,
      }))

      return out.done(
        { datasets, blockNumber },
        {
          cta: chainCta(c.options.chain, {
            commands: [
              {
                command: 'dataset details',
                description: 'View pieces and metadata for a dataset',
              },
            ],
          }),
        }
      )
    } catch (error) {
      if (c.options.debug) console.error(error)
      return out.fail('DATASET_LIST_FAILED', (error as Error).message)
    }
  },
}
