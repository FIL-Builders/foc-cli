import { execFileSync } from 'node:child_process'
import { basename, dirname } from 'node:path'
import { getChain } from '@filoz/synapse-core/chains'
import { Errors } from 'incur'
import { createPublicClient, createWalletClient, type Hex, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import config from './config.ts'
import {
  findPrivateKeys,
  isKnownProvider,
  isOnPath,
  isProviderAvailable,
  KEY_TOOL_TIMEOUT_MS,
  keyRefCtaCommands,
  parseKeyRef,
  providerInstallHint,
  providerNames,
  redactKeyLike,
  resolveKeyRef,
  unsafeRefPart,
} from './key-ref.ts'
import { type CTA, ctaFlags, type OutputContext } from './output.ts'
import { canPrompt, expandHome } from './utils.ts'

type Problem = {
  code: string
  message: string
  // The shared CTA type, not `any`: it is what type-checks the suggestions this
  // file builds, and an untyped `cta` is how `--force <force>` shipped.
  cta?: CTA
  retryable?: boolean
}

/**
 * "Reconfigure the reference", for the several ways a stored one can be broken.
 * A wallet is configured (badly), so every suggestion carries --force or it
 * would bounce off WALLET_ALREADY_CONFIGURED.
 */
function reconfigureRefCta() {
  return {
    description: 'Reconfigure the reference:',
    commands: keyRefCtaCommands().map((cmd) => ctaFlags(cmd, 'force')),
  }
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
            command: 'wallet init --auto',
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
        // Redacted: a reference that never parsed is most often a private key
        // passed to --key-ref, and this message is the one place that mistake
        // would be echoed into a log. The command to fix it says the shape.
        message: `The configured key reference (${redactKeyLike(raw)}) is not of the form <provider>:<reference> — e.g. clawdi:FILECOIN_PRIVATE_KEY. Reconfigure it with \`foc-cli wallet init --key-ref <provider>:<reference> --force\`.`,
        cta: reconfigureRefCta(),
      }
    }
    // Before the PATH probe, which cannot tell "this provider does not exist"
    // from "this provider is not installed" — isProviderAvailable() returns
    // false for both. Reported as the same problem, a typo'd or newer-CLI
    // prefix becomes a retryable PATH gap, and an agent retries a permanent
    // misconfiguration forever.
    if (!isKnownProvider(parsed.provider)) {
      return {
        code: 'UNKNOWN_KEY_REF_PROVIDER',
        message: `The configured key reference names an unknown provider "${parsed.provider}". Supported: ${providerNames().join(', ')}. Reconfigure it with \`foc-cli wallet init --key-ref <provider>:<reference> --force\`.`,
        cta: reconfigureRefCta(),
      }
    }
    // Cheap and config-only, so it belongs with the other guard checks rather
    // than at use time: a reference or scope holding characters the resolver
    // refuses is a permanent misconfiguration, and catching it here is what
    // gives it a call to action instead of a bare throw mid-command.
    const unsafe = unsafeRefPart(parsed.ref, config.get('keyRefProject'))
    if (unsafe) {
      return {
        code: 'MALFORMED_KEY_REF',
        message: `Malformed key ${unsafe.what} in config: it ${unsafe.reason}. Reconfigure the wallet with \`foc-cli wallet init --key-ref <provider>:<reference> --force\`.`,
        cta: reconfigureRefCta(),
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
      //
      // Always present, since the guard above established the provider is
      // known and every provider defines one.
      const install = providerInstallHint(parsed.provider) ?? ''
      return {
        code: 'KEY_REF_PROVIDER_MISSING',
        retryable: true,
        message: `This wallet resolves its key through ${parsed.provider}, which is not on the PATH of this process. ${install} If it works in your shell but not here, this process has a shorter PATH — GUI-launched agents and MCP servers usually do. The wallet itself is fine and the reference is intact; nothing needs reconfiguring.`,
      }
    }
  }

  if (source === 'keystore') {
    // Symmetric with the keyRef checks above: the two ways a keystore is
    // unusable are both knowable without touching the file, and both otherwise
    // surface from `cast` as an untyped throw the command never catches.
    //
    // canPrompt, not isAgent: the question is whether cast can reach a terminal
    // for its password, and it reads /dev/tty rather than stdin. isAgent() is
    // true whenever stdout is not a TTY, so asking it here refused every
    // keystore command that was piped or redirected — `wallet balance --json |
    // jq` — on installs where they had always worked.
    if (!canPrompt(c)) {
      return {
        code: 'KEYSTORE_INTERACTIVE_ONLY',
        message:
          'This wallet is a Foundry keystore, which prompts for its password on the terminal at use time — so it cannot be used from MCP or automation. Configure a private-key or key-reference wallet for this context.',
        cta: {
          description: 'Choose one:',
          commands: [
            {
              command: 'wallet init --auto --force',
              description: 'Generate a random key (testnet)',
            },
            {
              command: 'wallet init --force',
              options: { privateKey: '0x...' },
              description: 'Set a key directly',
            },
            ...keyRefCtaCommands().map((cmd) => ctaFlags(cmd, 'force')),
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

  if (source === 'privateKey') {
    // The remaining mode, and the one this guard existed to skip. A stored key
    // that is not 0x + 64 hex — hand-edited, truncated by a partial write,
    // migrated from another tool — reaches `privateKeyToAccount` inside
    // `privateKeyClient()`, which every command calls *before* its try block.
    // That throws a raw viem error, which incur renders as `{ code: 'UNKNOWN' }`
    // with no code and no `retryable`: precisely the shape this function exists
    // to remove. Checking it costs nothing and touches no secret.
    const privateKey = config.get('privateKey') as string
    if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
      return {
        code: 'INVALID_KEY',
        // The value is never echoed: it is a key, or something someone believed
        // was one, and this message travels into the MCP result and the logs.
        message:
          'The private key stored in config is not a 0x-prefixed 64-hex-digit key, so it cannot sign. Reconfigure the wallet with `foc-cli wallet init --force`.',
        cta: {
          description: 'Choose one:',
          commands: [
            {
              command: 'wallet init --auto --force',
              description: 'Generate a random key (testnet)',
            },
            {
              command: 'wallet init --force',
              options: { privateKey: '0x...' },
              description: 'Set a key directly',
            },
            ...keyRefCtaCommands().map((cmd) => ctaFlags(cmd, 'force')),
          ],
        },
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
      throw new Errors.IncurError({
        code: 'WALLET_NOT_CONFIGURED',
        message:
          'Private key not found. Please run `foc-cli wallet init` to initialize the CLI',
      })
    }
    return privateKey
  }
  // execFileSync with an argv array: the keystore path is data, never shell
  // syntax — a path containing metacharacters must not become a command.
  const keystorePath = expandHome(keystore)
  const keystoreDir = dirname(keystorePath)
  const keystoreName = basename(keystorePath)
  // Only the call is wrapped. Scraping inside the try meant every diagnosis
  // below also fired for a decrypt that had *succeeded* — a failure to find the
  // key in cast's output was reported as "Mac Mismatch means the password was
  // wrong", which is the one thing it is not.
  let extraction: string
  try {
    extraction = execFileSync(
      'cast',
      ['w', 'dk', '-k', keystoreDir, keystoreName],
      {
        // `cast` reads its password from /dev/tty, so ignoring stdin does not
        // stop it waiting — and this call is synchronous, so a wait here blocks
        // the event loop indefinitely. The preflight tries to keep keystore
        // mode out of contexts with nobody to type, but it answers "is a
        // terminal attached", not "is a human watching": a harness that inherits
        // one tty descriptor passes it. The bound is what actually guarantees
        // the process comes back. Shared with the key-reference helper, which
        // can block for its own reasons.
        timeout: KEY_TOOL_TIMEOUT_MS,
      }
    ).toString()
  } catch (error) {
    // cast's own stderr (password prompt, "Error: Mac Mismatch") passes
    // through to the terminal; this message decodes what that output means
    // rather than re-reading it.
    //
    // Symmetric with the key-reference path, which this claimed to mirror and
    // did not: ENOENT is a vanished binary, EINVAL/ENOEXEC a binary that cannot
    // be launched at all — on Windows, `resolveBin` happily finds a `cast.cmd`
    // shim that Node has refused to launch implicitly since CVE-2024-27980.
    // None of those means cast ran and rejected a password, so none may be
    // handed the "Mac Mismatch" diagnosis below.
    const code = (error as { code?: string }).code
    if (code === 'ENOENT' || code === 'EINVAL' || code === 'ENOEXEC') {
      throw new Errors.IncurError({
        code: 'KEYSTORE_TOOL_MISSING',
        retryable: true,
        message:
          'Failed to access keystore: Foundry `cast` could not be launched from this process. Install Foundry (https://getfoundry.sh) and check it runs as `cast --help`, or switch to a private-key wallet with `foc-cli wallet init --force`.',
      })
    }
    if (code === 'ETIMEDOUT') {
      throw new Errors.IncurError({
        code: 'KEYSTORE_TIMED_OUT',
        retryable: true,
        message: `Foundry \`cast\` did not finish within ${KEY_TOOL_TIMEOUT_MS / 1000}s while decrypting the keystore, so it was stopped — most often it was waiting on the password prompt with nobody to answer it. Keystore mode is interactive-only; use a private-key or key-reference wallet for MCP and automation.`,
      })
    }
    throw new Errors.IncurError({
      code: 'KEYSTORE_DECRYPT_FAILED',
      message:
        'Failed to access keystore. "Mac Mismatch" above means the password was wrong. Other causes: an invalid keystore file, or a session with no terminal for the password prompt — keystore mode is interactive-only, so MCP/CI must use a private-key wallet.',
    })
  }

  // The same bounded matcher the key-reference path uses, for the same reason:
  // an unbounded search would take the first 64 hex digits of a longer blob in
  // cast's output and sign as a completely different address, and every 32-byte
  // value is a valid key so nothing downstream would notice. Two scrapes of the
  // same shape, one matcher.
  const found = findPrivateKeys(extraction)
  if (found.length === 0) {
    throw new Errors.IncurError({
      code: 'KEYSTORE_NOT_A_KEY',
      message:
        "Keystore decrypted, but no private key (0x + 64 hex, on its own rather than inside a longer value) was found in cast's output. Check `cast wallet decrypt-keystore` works on this file directly — the output is not shown here on purpose.",
    })
  }
  if (found.length > 1) {
    throw new Errors.IncurError({
      code: 'KEYSTORE_AMBIGUOUS',
      message: `Keystore decrypted to output containing ${found.length} different 0x + 64 hex values, so which one is the key is ambiguous. Use a keystore that holds a single key — the values are not shown here on purpose.`,
    })
  }
  return found[0]
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
