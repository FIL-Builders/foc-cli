import { execFileSync } from 'node:child_process'
import { basename, dirname } from 'node:path'
import { getChain } from '@filoz/synapse-core/chains'
import { createPublicClient, createWalletClient, type Hex, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import config from './config.ts'
import {
  availableProviders,
  isProviderAvailable,
  parseKeyRef,
  resolveKeyRef,
} from './key-ref.ts'
import { expandHome } from './utils.ts'

type Problem = { code: string; message: string; cta?: any }

/**
 * Cheap checks that must pass before a command can sign anything.
 *
 * Run before constructing a client so an unusable setup fails as a typed,
 * actionable error instead of escaping as an untyped throw from deep inside
 * key resolution. Deliberately does not resolve the key: that costs a round
 * trip and an authenticated provider, and belongs at use time, not here.
 */
export function walletPreflight(): Problem | null {
  const source = keySource()

  if (source === 'none') {
    const providers = availableProviders()
    return {
      code: 'WALLET_NOT_CONFIGURED',
      message: 'No wallet configured. Run `foc-cli wallet init` to set one up.',
      cta: {
        description: 'Choose one:',
        commands: [
          {
            command: 'wallet init',
            options: { auto: true },
            description: 'Generate a random key (testnet)',
          },
          // Only offered where it would actually work — see availableProviders().
          ...providers.map((provider) => ({
            command: 'wallet init',
            options: { keyRef: `${provider}:FILECOIN_PRIVATE_KEY` },
            description: `Use a key held in ${provider} (nothing at rest)`,
          })),
        ],
      },
    }
  }

  if (source === 'keyRef') {
    const parsed = parseKeyRef(config.get('keyRef') as string)
    if (parsed && !isProviderAvailable(parsed.provider)) {
      return {
        code: 'KEY_REF_PROVIDER_MISSING',
        message: `This wallet resolves its key through ${parsed.provider}, which is not installed on this machine. Install it, or reconfigure the wallet with a different method.`,
        cta: {
          description: 'Choose one:',
          commands: [
            {
              command: 'wallet init',
              options: { auto: true, force: true },
              description: 'Switch to a locally generated key (testnet)',
            },
          ],
        },
      }
    }
  }

  return null
}

/**
 * Which custody mode is configured, without resolving anything. Safe to call
 * from read-only paths and from output formatting — it touches no secret and
 * costs no round trip.
 */
export function keySource(): 'keyRef' | 'keystore' | 'privateKey' | 'none' {
  if (config.get('keyRef')) return 'keyRef'
  if (config.get('keystore')) return 'keystore'
  if (config.get('privateKey')) return 'privateKey'
  return 'none'
}

function privateKeyFromConfig() {
  // First because it is the most explicit: only ever present when someone ran
  // `wallet init --key-ref`, and it holds a reference rather than a key, so
  // nothing is at rest. Absent on every other install, which is why the
  // branches below are reached unchanged.
  const keyRef = config.get('keyRef')
  if (keyRef) {
    return resolveKeyRef(keyRef, config.get('keyRefProject'))
  }

  const keystore = config.get('keystore')
  if (!keystore) {
    const privateKey = config.get('privateKey')
    if (!privateKey) {
      throw new Error(
        'Private key not found. Please run `foc-cli wallet init` to initialize the CLI'
      )
    }
    return privateKey
  }
  // execFileSync with an argv array: the keystore path is data, never shell
  // syntax — a path containing metacharacters must not become a command.
  const keystorePath = expandHome(keystore)
  const keystoreDir = dirname(keystorePath)
  const keystoreName = basename(keystorePath)
  try {
    const extraction = execFileSync('cast', [
      'w',
      'dk',
      '-k',
      keystoreDir,
      keystoreName,
    ]).toString()
    const foundAt = extraction.search(/0x[a-fA-F0-9]{64}/)
    if (foundAt === -1) {
      throw new Error('Failed to retrieve private key from keystore')
    }
    return extraction.slice(foundAt, foundAt + 66)
  } catch (error) {
    // cast's own stderr (password prompt, "Error: Mac Mismatch") passes
    // through to the terminal; this message decodes what that output means
    // rather than re-reading it.
    if ((error as { code?: string }).code === 'ENOENT') {
      throw new Error(
        'Failed to access keystore: Foundry `cast` is not on PATH. Install Foundry (https://getfoundry.sh), or switch to a private-key wallet with `foc-cli wallet init`.'
      )
    }
    throw new Error(
      'Failed to access keystore. "Mac Mismatch" above means the password was wrong. Other causes: an invalid keystore file, or a session with no terminal for the password prompt — keystore mode is interactive-only, so MCP/CI must use a private-key wallet.'
    )
  }
}

export function privateKeyClient(chainId: number) {
  const chain = getChain(chainId)

  const privateKey = privateKeyFromConfig()

  const account = privateKeyToAccount(privateKey as Hex)
  const client = createWalletClient({
    account,
    chain,
    transport: http(),
  })
  return {
    client,
    chain,
  }
}

export function publicClient(chainId: number) {
  const chain = getChain(chainId)
  const publicClient = createPublicClient({
    chain,
    transport: http(),
  })
  return publicClient
}
