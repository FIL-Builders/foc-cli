import { formatBalance } from '@filoz/synapse-core/utils'
import { getPdpDataSets } from '@filoz/synapse-core/warm-storage'
import { z } from 'incur'
import { commandOutput, OutputContext } from '../../output.ts'
import { synapseClient } from '../../synapse.ts'

export const costsCommand = {
  description:
    'Estimate storage costs before uploading: live per-month rate, required deposit, and whether an operator approval is still needed. Read-only — spends nothing.',
  mcp: {
    annotations: { title: 'Estimate storage costs', readOnlyHint: true },
  },
  options: z.object({
    chain: z
      .number()
      .default(314159)
      .describe('Chain ID. 314159 = Calibration, 314 = Mainnet'),
    extraBytes: z.number().describe('Extra bytes to upload in bytes'),
    extraRunway: z.number().describe('Extra runway in months'),
    debug: z.boolean().optional().describe('Enable debug mode'),
  }),
  alias: { chain: 'c' },
  output: commandOutput({
    newPerMonthRate: z.string(),
    depositNeeded: z.string(),
    alreadyCovered: z.boolean(),
    needsFwssMaxApproval: z.boolean(),
  }),
  examples: [
    {
      options: { extraBytes: 1000000, extraRunway: 1 },
      description: 'Get costs for uploading 1MB with 1 month runway',
    },
    {
      options: { extraBytes: 1000000, extraRunway: 1, chain: 314 },
      description: 'Get costs on mainnet',
    },
  ],
  async run(c: any) {
    const out = new OutputContext(c)
    const { client, synapse } = synapseClient(c.options.chain)

    try {
      out.step('Getting costs')

      // Cost estimation only needs the user's existing datasets — build
      // contexts from them explicitly so prepare() never falls back to
      // smart provider selection (which requires a live endorsed provider).
      const dataSets = await getPdpDataSets(client, {
        address: client.account.address,
      })
      // Active, non-terminating datasets only. Contexts are created one at a
      // time via createContext — the plural createContexts rejects datasets
      // sharing a provider, but every dataset has its own rail and lockup, so
      // each must be costed individually.
      const dataSetIds = dataSets
        .filter((ds) => ds.live && ds.managed && ds.pdpEndEpoch === 0n)
        .map((ds) => ds.dataSetId)

      const context =
        dataSetIds.length > 0
          ? await Promise.all(
              dataSetIds.map((dataSetId) =>
                synapse.storage.createContext({ dataSetId })
              )
            )
          : undefined

      const prep = await synapse.storage.prepare({
        dataSize: BigInt(c.options.extraBytes),
        extraRunwayEpochs: BigInt(c.options.extraRunway * 30 * 24 * 60 * 2),
        context,
      })

      const newPerMonthRate = formatBalance({
        value: prep.costs.rates.perMonth,
      })
      const depositNeeded = formatBalance({ value: prep.costs.depositNeeded })
      const alreadyCovered = prep.costs.ready
      const needsFwssMaxApproval = prep.costs.needsFwssMaxApproval

      return out.done({
        newPerMonthRate,
        depositNeeded,
        alreadyCovered,
        needsFwssMaxApproval,
      })
    } catch (error) {
      if (c.options.debug) console.error(error)
      return out.fail('COSTS_FAILED', (error as Error).message)
    }
  },
}
