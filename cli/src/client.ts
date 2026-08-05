import { execFileSync } from 'node:child_process'
import { basename, dirname } from 'node:path'
import { getChain } from '@filoz/synapse-core/chains'
import { createPublicClient, createWalletClient, type Hex, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import config from './config.ts'
import {
  isOnPath,
  isProviderAvailable,
  keyRefCtaCommands,
  parseKeyRef,
  providerInstallHint,
  resolveKeyRef,
} from './key-ref.ts'
import type { OutputContext } from './output.ts'
import { expandHome, isAgent } from './utils.ts'

type Problem = {
  code: string
  message: string
  cta?: any
  retryable?: boolean
}

/**
 * Cheap checks that must pass before a command can sign anything.
 *
 * Run before constructing a client so an unusable setup fails as a typed,
 * actionable error instead of escaping as an untyped throw from deep inside
 * key resolution. Deliberately does not resolve the key: that costs a round
 * trip and an authenticated provider, and belongs at use time, not here.
 *
 * Every custody mode is checked, not just the newest one. A guard that covers
 * one mode moves the failure rather than removing it — a keystore install would
 * still have died inside `cast` as an untyped throw, which is the exact shape
 * this function exists to eliminate.
 */
export function walletPreflight(c: { agent?: boolean }): Problem | null {
  const source = keySource()

  if (source === 'none') {
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
          ...keyRefCtaCommands(),
        ],
      },
    }
  }

  if (source === 'keyRef') {
    const raw = config.get('keyRef') as string
    const parsed = parseKeyRef(raw)
    // The cheapest failure of all, and the one worth catching here more than
    // any other: a reference that never had a provider prefix (hand-edited, or
    // copied out of a doc snippet) throws from inside key resolution, which
    // most commands reach outside their try block — so it surfaces as an
    // untyped UNKNOWN with no code and no way to act on it.
    if (!parsed) {
      return {
        code: 'MALFORMED_KEY_REF',
        message: `The configured key reference (${raw}) is not of the form <provider>:<reference> — e.g. clawdi:FILECOIN_PRIVATE_KEY. Reconfigure it with \`foc-cli wallet init --key-ref <provider>:<reference> --force\`.`,
        cta: {
          description: 'Reconfigure the reference:',
          commands: keyRefCtaCommands().map((cmd) => ({
            ...cmd,
            // A wallet is configured (badly), so replacing it needs --force.
            options: { ...cmd.options, force: true },
          })),
        },
      }
    }
    if (!isProviderAvailable(parsed.provider)) {
      // No executable call to action on purpose. The fix lives outside foc-cli
      // — install the helper, or start the process from somewhere that can see
      // it — and the only foc-cli command that would "resolve" this is one that
      // overwrites a working vault-backed wallet with a throwaway key. Offering
      // that as the machine-readable next step turns a PATH problem, which is
      // usually transient and is the single most reported symptom of running
      // under an agent, into a destroyed configuration. `retryable` says what
      // is actually true: nothing is wrong with the wallet, try again once the
      // provider is reachable.
      const install = providerInstallHint(parsed.provider)
      return {
        code: 'KEY_REF_PROVIDER_MISSING',
        retryable: true,
        message: `This wallet resolves its key through ${parsed.provider}, which is not on the PATH of this process. ${install ?? ''} If it works in your shell but not here, this process has a shorter PATH — GUI-launched agents and MCP servers usually do. The wallet itself is fine and the reference is intact; nothing needs reconfiguring.`,
      }
    }
  }

  if (source === 'keystore') {
    // Symmetric with the keyRef checks above: the two ways a keystore is
    // unusable are both knowable without touching the file, and both otherwise
    // surface from `cast` as an untyped throw the command never catches.
    if (isAgent(c)) {
      return {
        code: 'KEYSTORE_INTERACTIVE_ONLY',
        message:
          'This wallet is a Foundry keystore, which prompts for its password on the terminal at use time — so it cannot be used from MCP or automation. Configure a private-key or key-reference wallet for this context.',
        cta: {
          description: 'Choose one:',
          commands: [
            {
              command: 'wallet init',
              options: { auto: true, force: true },
              description: 'Generate a random key (testnet)',
            },
            {
              command: 'wallet init',
              options: { privateKey: '0x...', force: true },
              description: 'Set a key directly',
            },
            ...keyRefCtaCommands().map((cmd) => ({
              ...cmd,
              options: { ...cmd.options, force: true },
            })),
          ],
        },
      }
    }
    if (!isOnPath('cast')) {
      return {
        code: 'KEYSTORE_TOOL_MISSING',
        retryable: true,
        message:
          'This wallet is a Foundry keystore, and Foundry `cast` — which decrypts it — is not on the PATH of this process. Install Foundry (https://getfoundry.sh), or reconfigure the wallet with `foc-cli wallet init --force`. The keystore file itself is untouched.',
      }
    }
  }

  return null
}

/**
 * The one way a command guards its wallet.
 *
 * Every signing command needs this and every signing command used to inline
 * it, which made the guard a convention rather than a rule: a new command that
 * forgot the block compiled, passed review, and failed at the wrong layer.
 * Collapsing it to a single call keeps the failure shape — code, message and
 * call to action — defined in exactly one place, and `tests/preflight.test.ts`
 * asserts every command that builds a signing client actually calls it.
 */
export function requireWallet(c: { agent?: boolean }, out: OutputContext) {
  const problem = walletPreflight(c)
  if (!problem) return null
  return out.fail(problem.code, problem.message, {
    cta: problem.cta,
    retryable: problem.retryable,
  })
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
