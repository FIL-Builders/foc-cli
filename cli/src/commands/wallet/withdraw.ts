import { parseUnits, Synapse } from '@filoz/synapse-sdk'
import { z } from 'incur'
import { privateKeyClient } from '../../client.ts'
import { OutputContext } from '../../output.ts'
import { hashLink, txExplorerUrl } from '../../utils.ts'

export const withdrawCommand = {
  description: 'Withdraw USDFC from payment account to wallet',
  args: z.object({
    amount: z.string().describe('Amount of USDFC to withdraw'),
  }),
  options: z.object({
    chain: z
      .number()
      .default(314159)
      .describe('Chain ID. 314159 = Calibration, 314 = Mainnet'),
    debug: z.boolean().optional().describe('Enable debug mode'),
  }),
  alias: { chain: 'c' },
  output: z.object({
    status: z.string(),
    txHash: z.string(),
    txExplorerUrl: z.string(),
  }),
  examples: [{ args: { amount: '1' }, description: 'Withdraw 1 USDFC' }],
  async run(c: any) {
    const out = new OutputContext(c)
    const { client, chain } = privateKeyClient(c.options.chain)
    const synapse = new Synapse({ client, source: 'foc-cli' })

    try {
      out.step('Withdrawing funds')
      const hash = await synapse.payments.withdraw({
        amount: parseUnits(c.args.amount),
      })

      out.step('Waiting for tx to be mined')
      out.info(`Tx: ${hashLink(hash, chain)}`)
      await synapse.client.waitForTransactionReceipt({ hash })

      return out.done({
        status: 'withdrawn',
        txHash: hash,
        txExplorerUrl: txExplorerUrl(hash, chain),
      })
    } catch (error) {
      if (c.options.debug) console.error(error)
      return out.fail('WITHDRAW_FAILED', (error as Error).message)
    }
  },
}
