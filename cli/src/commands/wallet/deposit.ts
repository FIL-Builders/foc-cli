import { parseUnits, Synapse } from '@filoz/synapse-sdk'
import { z } from 'incur'
import { privateKeyClient } from '../../client.ts'
import { OutputContext } from '../../output.ts'
import { hashLink, txExplorerUrl } from '../../utils.ts'

export const depositCommand = {
  description: 'Deposit USDFC into payment account (uses permit approvals)',
  args: z.object({
    amount: z.string().describe('Amount of USDFC to deposit'),
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
  examples: [
    { args: { amount: '1' }, description: 'Deposit 1 USDFC' },
    {
      args: { amount: '10' },
      options: { chain: 314 },
      description: 'Deposit 10 USDFC on mainnet',
    },
  ],
  async run(c: any) {
    const out = new OutputContext(c)
    const { client, chain } = privateKeyClient(c.options.chain)
    const synapse = new Synapse({ client, source: 'foc-cli' })

    try {
      out.step('Depositing funds')
      const hash = await synapse.payments.depositWithPermitAndApproveOperator({
        amount: parseUnits(c.args.amount),
      })

      out.step('Waiting for transaction to be mined')
      out.info(`Tx: ${hashLink(hash, chain)}`)
      await synapse.client.waitForTransactionReceipt({ hash })

      return out.done(
        {
          status: 'deposited',
          txHash: hash,
          txExplorerUrl: txExplorerUrl(hash, chain),
        },
        {
          cta: {
            description: 'Next steps:',
            commands: [
              {
                command: 'wallet balance',
                description: 'Check updated balances',
              },
              { command: 'upload', description: 'Upload a file' },
            ],
          },
        }
      )
    } catch (error) {
      if (c.options.debug) console.error(error)
      return out.fail('DEPOSIT_FAILED', (error as Error).message)
    }
  },
}
