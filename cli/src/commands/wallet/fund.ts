import { claimTokens, formatBalance } from '@filoz/synapse-core/utils'
import { z } from 'incur'
import { waitForTransactionReceipt } from 'viem/actions'
import { requireWallet } from '../../client.ts'
import { chainCta, commandOutput, OutputContext } from '../../output.ts'
import { synapseClient } from '../../synapse.ts'

const assetOutput = z.object({
  status: z.enum(['funded', 'missing', 'unconfirmed']),
  balance: z.string().optional(),
  txHash: z.string().optional(),
  error: z.string().optional(),
})

type Asset = 'fil' | 'usdfc'
type AssetOutcome = z.infer<typeof assetOutput>

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
    status: z.enum(['funded', 'partially_funded', 'not_funded', 'unconfirmed']),
    fil: assetOutput,
    usdfc: assetOutput,
    faucetError: z.string().optional(),
  }),
  hint: 'Only works on Calibration testnet (chain 314159).',
  async run(c: any) {
    const out = new OutputContext(c)
    if (c.options.chain !== 314159) {
      return out.fail(
        'TESTNET_ONLY',
        'wallet fund only supports Filecoin Calibration (chain 314159). Fund mainnet wallets by sending FIL and USDFC to the wallet address.'
      )
    }

    const blocked = requireWallet(c, out)
    if (blocked) return blocked
    const { client, synapse } = synapseClient(c.options.chain)
    const outcomes: Record<Asset, AssetOutcome> = {
      fil: { status: 'unconfirmed' },
      usdfc: { status: 'unconfirmed' },
    }
    let faucetError: string | undefined

    try {
      out.step('Requesting faucet tokens')
      const hashes = await claimTokens({ address: client.account.address })

      out.step('Waiting for transactions to be mined')
      for (const transaction of hashes) {
        const asset: Asset | undefined =
          transaction.faucetInfo === 'CalibnetFIL'
            ? 'fil'
            : transaction.faucetInfo === 'CalibnetUSDFC'
              ? 'usdfc'
              : undefined
        if (!asset) {
          faucetError = `Unexpected faucet asset: ${transaction.faucetInfo}`
          out.failStep(faucetError)
          continue
        }
        outcomes[asset].txHash = transaction.tx_hash
        try {
          const receipt = await waitForTransactionReceipt(client, {
            hash: transaction.tx_hash,
          })
          outcomes[asset].status = 'missing'
          if (receipt.status !== 'success') {
            outcomes[asset].error = 'Faucet transaction reverted'
            out.failStep(outcomes[asset].error)
          }
        } catch (error) {
          outcomes[asset].error = (error as Error).message
          out.failStep(outcomes[asset].error)
        }
      }
    } catch (error) {
      faucetError = (error as Error).message
      out.failStep(faucetError)
    }

    out.step('Fetching updated balances')
    for (const asset of ['fil', 'usdfc'] as const) {
      try {
        const balance =
          asset === 'fil'
            ? await synapse.payments.walletBalance()
            : await synapse.payments.walletBalance({ token: 'USDFC' })
        outcomes[asset].balance = formatBalance({ value: balance })
        if (outcomes[asset].status === 'missing' && !outcomes[asset].error) {
          outcomes[asset].status = balance > 0n ? 'funded' : 'unconfirmed'
        }
      } catch (error) {
        if (!outcomes[asset].error) outcomes[asset].status = 'unconfirmed'
        const balanceError = `Balance check failed: ${(error as Error).message}`
        outcomes[asset].error = [outcomes[asset].error, balanceError]
          .filter(Boolean)
          .join('; ')
        out.failStep(balanceError)
      }
    }

    const funded = [outcomes.fil, outcomes.usdfc].filter(
      ({ status }) => status === 'funded'
    ).length
    const hasUnconfirmed = [outcomes.fil, outcomes.usdfc].some(
      ({ status }) => status === 'unconfirmed'
    )
    const status = hasUnconfirmed
      ? 'unconfirmed'
      : funded === 2
        ? 'funded'
        : funded === 1
          ? 'partially_funded'
          : 'not_funded'
    const unavailable = (['fil', 'usdfc'] as const).filter(
      (asset) => outcomes[asset].status !== 'funded'
    )
    const unavailableSummary = unavailable
      .map((asset) => `${asset.toUpperCase()} is ${outcomes[asset].status}`)
      .join(', ')
    const hasMissing = unavailable.some(
      (asset) => outcomes[asset].status === 'missing'
    )
    const recovery = [
      hasMissing
        ? 'Request only missing assets from a documented Calibration faucet.'
        : '',
      hasUnconfirmed ? 'Check unconfirmed balances before retrying.' : '',
    ]
      .filter(Boolean)
      .join(' ')
    const cta =
      status === 'funded'
        ? {
            description:
              'Funding complete. Run wallet costs for the intended upload before depositing.',
            commands: [],
          }
        : {
            description: `Funding incomplete: ${unavailableSummary}. ${recovery}`,
            commands: [
              {
                command: 'wallet balance',
                description: 'Verify wallet balances before continuing',
              },
            ],
          }

    return out.done(
      {
        status,
        fil: outcomes.fil,
        usdfc: outcomes.usdfc,
        ...(faucetError ? { faucetError } : {}),
      },
      { cta: chainCta(c.options.chain, cta) }
    )
  },
}
