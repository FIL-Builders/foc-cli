import { getAccountSummary } from '@filoz/synapse-core/pay'
import { formatBalance } from '@filoz/synapse-core/utils'
import { z } from 'incur'
import { maxUint256 } from 'viem'
import { privateKeyClient } from '../../client.ts'
import { OutputContext } from '../../output.ts'

export const summaryCommand = {
  description: 'Get payment account summary with funding timeline',
  options: z.object({
    chain: z
      .number()
      .default(314159)
      .describe('Chain ID. 314159 = Calibration, 314 = Mainnet'),
    debug: z.boolean().optional().describe('Enable debug mode'),
  }),
  alias: { chain: 'c' },
  output: z.object({
    availableFunds: z.string(),
    timeRemaining: z.string(),
    totalLockup: z.string(),
    rateBasedLockup: z.string(),
    monthlyAccountRate: z.string(),
    funds: z.string(),
  }),
  async run(c: any) {
    const out = new OutputContext(c)
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
  const secondsUntilFunded = summary.runwayInEpochs * 30n
  const hoursUntilFunded = secondsUntilFunded / 60n / 60n
  const daysUntilFunded = hoursUntilFunded / 24n
  const weeksUntilFunded = daysUntilFunded / 7n
  const monthsUntilFunded = weeksUntilFunded / 4n
  const yearsUntilFunded = monthsUntilFunded / 12n
  return `${hoursUntilFunded}h ${daysUntilFunded}d ${weeksUntilFunded}w ${monthsUntilFunded}m ${yearsUntilFunded}y`
}
