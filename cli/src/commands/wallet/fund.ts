import { claimTokens, formatBalance } from '@filoz/synapse-core/utils'
import { z } from 'incur'
import { waitForTransactionReceipt } from 'viem/actions'
import { requireWallet } from '../../client.ts'
import { chainCta, commandOutput, OutputContext } from '../../output.ts'
import { synapseClient } from '../../synapse.ts'

export const fundCommand = {
  description: 'Request testnet FIL and USDFC from faucet (testnet only)',
  mcp: {
    annotations: {
      title: 'Claim testnet faucet tokens',
      destructiveHint: false,
    },
  },
  options: z.object({
    chain: z
      .number()
      .default(314159)
      .describe('Chain ID. 314159 = Calibration, 314 = Mainnet'),
  }),
  alias: { chain: 'c' },
  output: commandOutput({
    fil: z.string(),
    usdfc: z.string(),
  }),
  hint: 'Only works on Calibration testnet (chain 314159).',
  async run(c: any) {
    const out = new OutputContext(c)
    const blocked = requireWallet(c, out)
    if (blocked) return blocked
    const { client, synapse } = synapseClient(c.options.chain)

    try {
      out.step('Requesting faucet tokens')
      const hashes = await claimTokens({ address: client.account.address })

      out.step('Waiting for transactions to be mined')
      await waitForTransactionReceipt(client, { hash: hashes[0].tx_hash })

      out.step('Fetching updated balances')
      const filBalance = await synapse.payments.walletBalance()
      const usdfcBalance = await synapse.payments.walletBalance({
        token: 'USDFC',
      })

      const result = {
        fil: formatBalance({ value: filBalance }),
        usdfc: formatBalance({ value: usdfcBalance }),
      }

      return out.done(result, {
        cta: chainCta(c.options.chain, {
          description: 'Next steps:',
          commands: [
            {
              command: 'wallet deposit',
              args: { amount: '1' },
              description: 'Deposit USDFC into payment account',
            },
            { command: 'wallet balance', description: 'Check balances' },
          ],
        }),
      })
    } catch (error) {
      return out.fail('FUND_FAILED', (error as Error).message)
    }
  },
}
