import { getAccountSummary } from '@filoz/synapse-core/pay'
import { formatBalance } from '@filoz/synapse-core/utils'
import { z } from 'incur'
import { maxUint256 } from 'viem'
import { privateKeyClient, requireWallet } from '../../client.ts'
import { commandOutput, OutputContext } from '../../output.ts'

export const summaryCommand = {
  description: 'Get payment account summary with funding timeline',
  mcp: {
    annotations: { title: 'Payment account summary', readOnlyHint: true },
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
    availableFunds: z.string(),
    timeRemaining: z.string(),
    totalLockup: z.string(),
    rateBasedLockup: z.string(),
    monthlyAccountRate: z.string(),
    funds: z.string(),
  }),
  async run(c: any) {
    const out = new OutputContext(c)
    const blocked = requireWallet(c, out)
    if (blocked) return blocked
    const { client } = privateKeyClient(c.options.chain)

    try {
      out.step('Fetching account summary')
      const summary = await getAccountSummary(client, {
        address: client.account.address,
      })

      const timeRemaining = formatTimeUntilFunded(summary)

      const result = {
        availableFunds: formatBalance({ value: summary.availableFunds }),
        timeRemaining,
        totalLockup: formatBalance({ value: summary.totalLockup }),
        rateBasedLockup: formatBalance({
          value: summary.totalRateBasedLockup,
        }),
        monthlyAccountRate: formatBalance({
          value: summary.lockupRatePerMonth,
        }),
        funds: formatBalance({ value: summary.funds }),
      }

      return out.done(result)
    } catch (error) {
      if (c.options.debug) console.error(error)
      return out.fail('SUMMARY_FAILED', (error as Error).message)
    }
  },
}

function formatTimeUntilFunded(summary: getAccountSummary.OutputType) {
  if (summary.runwayInEpochs === maxUint256) {
    return 'No active storage, unlimited'
  }
  // One unit, the largest that fits — the old format concatenated the SAME
  // duration in five units ("17468h 727d 103w 25m 2y"), which read as
  // nonsense. "mo" for months so it can't be misread as minutes.
  const seconds = summary.runwayInEpochs * 30n
  const hours = seconds / 3600n
  if (hours < 1n) return '<1h'
  if (hours < 48n) return `~${hours}h`
  const days = hours / 24n
  if (days < 60n) return `~${days}d`
  const months = days / 30n
  if (months < 24n) return `~${months}mo`
  return `~${(days + 182n) / 365n}y`
}
