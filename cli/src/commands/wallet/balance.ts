import { formatBalance } from '@filoz/synapse-core/utils'
import { Synapse, TOKENS } from '@filoz/synapse-sdk'
import { z } from 'incur'
import { privateKeyClient } from '../../client.ts'
import { OutputContext } from '../../output.ts'

export const balanceCommand = {
  description: 'Check FIL and USDFC wallet balances and payment account info',
  options: z.object({
    chain: z
      .number()
      .default(314159)
      .describe('Chain ID. 314159 = Calibration, 314 = Mainnet'),
  }),
  alias: { chain: 'c' },
  output: z.object({
    address: z.string(),
    fil: z.string(),
    usdfc: z.string(),
    availableFunds: z.string(),
    lockupCurrent: z.string(),
    lockupRate: z.string(),
    lockupLastSettledAt: z.string(),
    funds: z.string(),
  }),
  examples: [
    { description: 'Check balances on testnet' },
    { options: { chain: 314 }, description: 'Check mainnet balances' },
  ],
  async run(c: any) {
    const out = new OutputContext(c)
    const { client } = privateKeyClient(c.options.chain)

    try {
      out.step('Checking wallet balance')
      const result = await fetchBalances(client)

      return out.done(result)
    } catch (error) {
      return out.fail('BALANCE_FETCH_FAILED', (error as Error).message)
    }
  },
}

async function fetchBalances(client: any) {
  const synapse = new Synapse({ client, source: 'foc-cli' })
  const filBalance = await synapse.payments.walletBalance()
  const usdfcBalance = await synapse.payments.walletBalance({
    token: TOKENS.USDFC,
  })
  const paymentsBalance = await synapse.payments.accountInfo()

  return {
    address: client.account.address,
    fil: formatBalance({ value: filBalance }),
    usdfc: formatBalance({ value: usdfcBalance }),
    availableFunds: formatBalance({ value: paymentsBalance.availableFunds }),
    lockupCurrent: formatBalance({ value: paymentsBalance.lockupCurrent }),
    lockupRate: formatBalance({ value: paymentsBalance.lockupRate }),
    lockupLastSettledAt: formatBalance({
      value: paymentsBalance.lockupLastSettledAt,
    }),
    funds: formatBalance({ value: paymentsBalance.funds }),
  }
}
