import { formatBalance } from '@filoz/synapse-core/utils'
import { TOKENS } from '@filoz/synapse-sdk'
import { z } from 'incur'
import { keySource, walletPreflight } from '../../client.ts'
import { chainCta, commandOutput, OutputContext } from '../../output.ts'
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
    keySource: z
      .enum(['keyRef', 'keystore', 'privateKey'])
      .describe(
        'Where the signing key came from. keyRef: fetched per command from an external secret manager, nothing at rest. keystore: decrypted from a Foundry keystore. privateKey: stored in the config file.'
      ),
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
    const preflight = walletPreflight()
    if (preflight)
      return out.fail(preflight.code, preflight.message, {
        cta: preflight.cta,
      })
    const { client, synapse } = synapseClient(c.options.chain)

    try {
      out.step('Checking wallet balance')
      const result = await fetchBalances(client, synapse)

      return out.done(result)
    } catch (error) {
      const message = (error as Error).message
      // A brand-new address has no onchain actor until it first receives
      // funds, and this is the first command a new user runs after wallet
      // init — the raw viem multicall dump must not be their first
      // impression. The RPC wording varies: older Glif nodes say "actor not
      // found"; current ones fail the eth_call with "failed to apply on
      // state with gas" (live-observed 2026-07-23).
      if (
        message.includes('actor not found') ||
        message.includes('failed to apply on state')
      ) {
        // The faucet CTA is Calibration-only: wallet fund defaults to 314159
        // and rejects mainnet, so suggesting it on chain 314 would send an
        // agent to fund the wrong network. Mainnet gets prose guidance only.
        const calibration = c.options.chain === 314159
        return out.fail(
          'ADDRESS_NOT_ON_CHAIN',
          `${client.account.address} has no onchain history on chain ${c.options.chain} yet — every balance is zero. ${
            calibration
              ? 'Fund it first: wallet fund.'
              : 'Fund it first by sending FIL and USDFC to the address (there is no mainnet faucet).'
          }`,
          calibration
            ? {
                cta: chainCta(c.options.chain, {
                  description: 'Fund this address:',
                  commands: [
                    {
                      command: 'wallet fund',
                      description:
                        'Claim free testnet FIL + USDFC (Calibration)',
                    },
                  ],
                }),
              }
            : undefined
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
    // Reported so a vault-backed setup is verifiable at a glance: the address
    // proves which key signed, this proves where it came from. Never the value.
    keySource: keySource(),
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
