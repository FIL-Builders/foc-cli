import { formatBalance } from '@filoz/synapse-core/utils'
import { z } from 'incur'
import { OutputContext } from '../../output.ts'
import { synapseClient } from '../../synapse.ts'

export const costsCommand = {
  description: 'Get costs for uploading a file to Filecoin warm storage',
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
  output: z.object({
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
    const { synapse } = synapseClient(c.options.chain)

    try {
      out.step('Getting costs')

      const prep = await synapse.storage.prepare({
        dataSize: BigInt(c.options.extraBytes),
        extraRunwayEpochs: BigInt(c.options.extraRunway * 30 * 24 * 60 * 2),
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
