import { paginate } from '@filoz/synapse-core'
import { formatBalance } from '@filoz/synapse-core/utils'
import { getPdpDataSets } from '@filoz/synapse-core/warm-storage'
import { z } from 'incur'
import { requireWallet } from '../../client.ts'
import { commandOutput, OutputContext } from '../../output.ts'
import { synapseClient } from '../../synapse.ts'

export const costsCommand = {
  description:
    'Estimate storage costs before uploading: live per-month rate, required deposit, and whether an operator approval is still needed. Approximates the requested copies (default 2, like upload) against your existing datasets; the actual upload selects providers itself and re-quotes via its own prepare(), so treat the upload-time quote as final. Read-only — spends nothing.',
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
    copies: z
      .number()
      .default(2)
      .optional()
      .describe(
        'Copies the upload will create — the estimate prices this many storage contexts (match the --copies you will pass to upload)'
      ),
    withCDN: z
      .boolean()
      .optional()
      .describe('Price CDN-enabled storage for any new datasets'),
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
    const blocked = requireWallet(c, out)
    if (blocked) return blocked
    const { client, synapse } = synapseClient(c.options.chain)

    try {
      out.step('Getting costs')

      const copies = c.options.copies ?? 2
      // Paged since synapse-core 0.8: walk every page so reuse still sees all
      // active datasets, not just the first hundred.
      const dataSets = await Array.fromAsync(
        paginate(({ cursor }) =>
          getPdpDataSets(client, { address: client.account.address, cursor })
        )
      )
      // Active, non-terminating datasets only. Contexts are created one at a
      // time via createContext — the plural createContexts rejects datasets
      // sharing a provider.
      const dataSetIds = dataSets
        .filter((ds) => ds.live && ds.managed && ds.pdpEndEpoch === 0n)
        .map((ds) => ds.dataSetId)

      // Approximate what the next upload will pay for: prepare() applies
      // dataSize once per supplied context, so the estimate must contain
      // exactly `copies` contexts — pricing every active dataset made the
      // quote scale with historical dataset count instead. Reuse existing
      // datasets first (their current size shifts the effective rate and they
      // carry no creation fee), then pad with new-dataset placeholders.
      // Known approximation (tracked for full alignment with upload's
      // provider selection): upload picks reachable UNIQUE providers and
      // matches source/CDN metadata, so it may not reuse the datasets chosen
      // here — creation fees, CDN lockups, and depositNeeded can differ. The
      // upload itself re-quotes via its own prepare() before spending.
      const reused = await Promise.all(
        dataSetIds
          .slice(0, copies)
          .map((dataSetId) => synapse.storage.createContext({ dataSetId }))
      )
      // prepare() reads only dataSetId/withCDN off each context when costing;
      // a placeholder without a dataSetId is priced as a new dataset (creation
      // fee included) and never touches endorsed-provider selection — which
      // also keeps the empty-wallet case fully offline.
      const placeholders = Array.from(
        { length: Math.max(0, copies - reused.length) },
        () => ({ dataSetId: undefined, withCDN: c.options.withCDN ?? false })
      )
      const context = [...reused, ...placeholders] as any

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
