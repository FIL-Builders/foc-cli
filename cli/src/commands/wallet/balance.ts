import { formatBalance } from '@filoz/synapse-core/utils'
import { TOKENS } from '@filoz/synapse-sdk'
import { z } from 'incur'
import { commandOutput, OutputContext } from '../../output.ts'
import { synapseClient } from '../../synapse.ts'

export const balanceCommand = {
  description: 'Check FIL and USDFC wallet balances and payment account info',
  mcp: {
    annotations: { title: 'Check wallet balances', readOnlyHint: true },
  },
  options: z.object({
    chain: z
      .number()
      .default(314159)
      .describe('Chain ID. 314159 = Calibration, 314 = Mainnet'),
  }),
  alias: { chain: 'c' },
  output: commandOutput({
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
    const { client, synapse } = synapseClient(c.options.chain)

    try {
      out.step('Checking wallet balance')
      const result = await fetchBalances(client, synapse)

      return out.done(result)
    } catch (error) {
      const message = (error as Error).message
      // A brand-new address has no onchain actor until it first receives
      // funds, and this is the first command a new user runs after wallet
      // init — the raw viem multicall dump ("actor not found") must not be
      // their first impression.
      if (message.includes('actor not found')) {
        return out.fail(
          'ADDRESS_NOT_ON_CHAIN',
          `${client.account.address} has no onchain history on chain ${c.options.chain} yet — every balance is zero. Fund it first: wallet fund (testnet) or send FIL to the address (mainnet).`,
          {
            cta: {
              description: 'Fund this address:',
              commands: [
                {
                  command: 'wallet fund',
                  description: 'Claim free testnet FIL + USDFC (Calibration)',
                },
              ],
            },
          }
        )
      }
      return out.fail('BALANCE_FETCH_FAILED', message)
    }
  },
}

async function fetchBalances(client: any, synapse: any) {
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
