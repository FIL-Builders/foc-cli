import { existsSync, readFileSync, statSync } from 'node:fs'
import * as p from '@clack/prompts'
import { z } from 'incur'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { keySource } from '../../client.ts'
import config from '../../config.ts'
import {
  isKnownProvider,
  isProviderAvailable,
  keyRefCtaCommands,
  parseKeyRef,
  providerNames,
  redactKeyLike,
  unsafeRefReason,
} from '../../key-ref.ts'
import { commandOutput, OutputContext } from '../../output.ts'
import { canPrompt, expandHome, isAgent } from '../../utils.ts'

/**
 * What custody an explicit method would take over, or null when it takes over
 * nothing.
 *
 * Only a change that actually replaces a credential needs confirming.
 * Re-running the same `--keyRef` or `--privateKey` is idempotent, and prompting
 * for it would train agents to pass --force reflexively — which would defeat
 * the guard entirely.
 *
 * The consequence is stated per mode because it genuinely differs, and only one
 * of the three is irreversible. Claiming a key is about to be lost when it is
 * sitting in a vault or an encrypted file on disk is the same failure as
 * prompting for a no-op: it teaches the reader that the warning does not mean
 * what it says.
 */
function wouldReplace(options: {
  auto?: boolean
  privateKey?: string
  keystore?: string
  keyRef?: string
  keyProject?: string
}): { source: string; detail?: string; consequence: string } | null {
  const current = keySource()
  if (current === 'none') return null

  if (options.keyRef) {
    // The reference alone identifies the key. Adding or changing --keyProject
    // re-scopes the same lookup against the same secret manager, so nothing is
    // replaced — and refusing it would block the documented way to pin a
    // project on an account that has more than one.
    if (config.get('keyRef') === options.keyRef) return null
  } else if (options.keystore) {
    if (config.get('keystore') === expandHome(options.keystore)) return null
  } else if (options.privateKey) {
    if (config.get('privateKey') === options.privateKey) return null
  } else if (!options.auto) {
    // No explicit method: nothing is replaced.
    return null
  }
  // --auto always mints a fresh key, so it always replaces.

  // Naming what changes makes the choice concrete. The address is derived, not
  // secret; a keystore path is already in the config; a reference is safe to
  // display. The key itself is never shown.
  if (current === 'privateKey') {
    const consequence =
      'That key exists only in this config file, so replacing it destroys it — if the address holds funds, move them first.'
    try {
      const address = privateKeyToAccount(
        config.get('privateKey') as `0x${string}`
      ).address
      return { source: 'privateKey', detail: address, consequence }
    } catch {
      return { source: 'privateKey', consequence }
    }
  }
  if (current === 'keystore') {
    return {
      source: 'keystore',
      detail: config.get('keystore'),
      consequence:
        'The encrypted keystore file stays on disk and can be configured again; this install just stops using it.',
    }
  }
  return {
    source: 'keyRef',
    detail: config.get('keyRef'),
    consequence:
      'The key stays in the secret manager and can be referenced again; this install just stops using the reference.',
  }
}

/**
 * Init is the only moment a bad keystore path is cheap to catch — once it's
 * in config, the mistake surfaces at first use as an opaque decrypt failure.
 * Validate shape only, not the password: a decrypt test would need the
 * password prompt here, and cast owns that interaction at use time.
 */
function validateKeystoreFile(
  path: string
): { code: string; message: string } | null {
  if (!existsSync(path)) {
    return {
      code: 'KEYSTORE_NOT_FOUND',
      message: `Keystore file not found: ${path}`,
    }
  }
  const stats = statSync(path)
  if (stats.isDirectory()) {
    return {
      code: 'KEYSTORE_INVALID',
      message: `${path} is a directory, not a keystore file. cast wallet new/import writes a file named by a random UUID inside that directory — pass the file's full path.`,
    }
  }
  // Not just directories: a FIFO or device node reaches the synchronous read
  // below and can block the whole CLI/MCP process indefinitely.
  if (!stats.isFile()) {
    return {
      code: 'KEYSTORE_INVALID',
      message: `${path} is not a regular file. Pass the path to an encrypted keystore file created with cast wallet new or cast wallet import.`,
    }
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.crypto !== 'object' ||
      parsed.crypto === null
    ) {
      return {
        code: 'KEYSTORE_INVALID',
        message: `${path} is not an encrypted keystore (expected JSON with a "crypto" field). Create one with cast wallet new or cast wallet import — see the keystore-setup guide.`,
      }
    }
  } catch {
    return {
      code: 'KEYSTORE_INVALID',
      message: `${path} is not an encrypted keystore (could not parse it as JSON). Create one with cast wallet new or cast wallet import — see the keystore-setup guide.`,
    }
  }
  return null
}

/**
 * The caller's own options, replayed for a call to action — minus the secret.
 *
 * An allowlist, not a redaction pass: an error envelope travels into the MCP
 * result, the agent's context and every log downstream, so `--privateKey` must
 * never ride along with it. The placeholder keeps the CTA shaped like a command
 * the caller can run, while making it obvious the value has to be re-supplied.
 */
function replayOptions(options: Record<string, any>) {
  const safe: Record<string, any> = {}
  for (const key of ['auto', 'keystore', 'keyRef', 'keyProject', 'source']) {
    if (options[key] !== undefined) safe[key] = options[key]
  }
  if (options.privateKey !== undefined) safe.privateKey = '0x...'
  // An allowlist only stops the secret riding along under the flag it was meant
  // for. `--key-ref 0x<64 hex>` puts the same value in the envelope under a
  // field that is documented as safe to display, so scrub by shape as well as
  // by name.
  if (typeof safe.keyRef === 'string') safe.keyRef = redactKeyLike(safe.keyRef)
  safe.force = true
  return safe
}

function clearKeyRef() {
  config.delete('keyRef')
  config.delete('keyRefProject')
}

export const initCommand = {
  description:
    'Initialize wallet with a private key, a keystore, or a reference to a key held by an external secret manager. An explicit method (--auto, --keystore, --privateKey, --keyRef) configures the wallet; without one, an existing wallet is kept. Replacing an already-configured wallet additionally requires --force — without it the command fails with WALLET_ALREADY_CONFIGURED (or asks, on a terminal). Re-running the method already in effect changes nothing and is never blocked. Keystore mode prompts for its password on the terminal at use time, so it only works in interactive CLI sessions — agent mode rejects --keystore; use --auto, --privateKey, or --keyRef. --keyRef stores only a reference and fetches the key per command, so it works from MCP and automation with no key at rest.',
  mcp: {
    annotations: {
      title: 'Configure wallet (replacing an existing one needs --force)',
      destructiveHint: true,
    },
  },
  options: z.object({
    auto: z.boolean().optional().describe('Generate a new random private key'),
    keystore: z
      .string()
      .optional()
      .describe(
        'Path to a Foundry keystore file (requires foundry; interactive CLI only — rejected in agent/MCP mode)'
      ),
    privateKey: z.string().optional().describe('Private key (0x-prefixed hex)'),
    keyRef: z
      .string()
      .optional()
      .describe(
        'Reference to a key held by an external secret manager, as <provider>:<reference> (e.g. clawdi:FILECOIN_PRIVATE_KEY). Only the reference is stored; the key is fetched per command and never written to disk.'
      ),
    keyProject: z
      .string()
      .optional()
      .describe(
        "Scope --keyRef to a specific project. Omit to use the provider's own default."
      ),
    source: z
      .string()
      .optional()
      .describe(
        'Source tag reported to Synapse/Warm Storage for telemetry (default: foc-cli)'
      ),
    force: z
      .boolean()
      .optional()
      .describe(
        'Replace an already-configured wallet. Without it, a change that would discard an existing key is refused (or confirmed, in an interactive terminal).'
      ),
  }),
  alias: { auto: 'a' },
  output: commandOutput({
    status: z
      .enum(['configured', 'already_configured'])
      .describe(
        'configured: a wallet was (re)configured this run. already_configured: an existing wallet was kept because no explicit method was passed.'
      ),
    method: z
      .enum(['auto', 'keystore', 'manual', 'keyRef'])
      .optional()
      .describe('How the wallet was configured (absent on already_configured)'),
    path: z
      .string()
      .optional()
      .describe('Configured keystore path (keystore wallets only)'),
    keyRef: z
      .string()
      .optional()
      .describe(
        'Configured key reference, safe to display (method: keyRef only)'
      ),
    keyProject: z
      .string()
      .optional()
      .describe('Project the reference is scoped to, when one was given'),
    providerAvailable: z
      .boolean()
      .optional()
      .describe(
        'Whether the key-reference provider is installed here (method: keyRef only). False means the wallet is configured but no command can sign until the provider is installed.'
      ),
    configPath: z
      .string()
      .optional()
      .describe('Config file location (already_configured only)'),
    source: z
      .string()
      .optional()
      .describe('Attribution tag reported to Synapse/Warm Storage'),
  }),
  examples: [
    { description: 'Interactive key entry' },
    { options: { auto: true }, description: 'Generate random key' },
    {
      options: { keystore: '~/.foundry/keystores/alice' },
      description: 'Use Foundry keystore',
    },
    {
      options: { privateKey: '0x...' },
      description: 'Set private key directly',
    },
    {
      options: { auto: true, source: 'my-app' },
      description: 'Generate a key and set the source tag',
    },
    {
      options: { keyRef: 'clawdi:FILECOIN_PRIVATE_KEY' },
      description: 'Use a key held in a Clawdi vault (nothing stored on disk)',
    },
    {
      options: {
        keyRef: 'clawdi:FILECOIN_PRIVATE_KEY',
        keyProject: 'engineering',
      },
      description: 'Same, scoped to one project instead of the default',
    },
  ],
  async run(c: any) {
    const out = new OutputContext(c)
    const agent = isAgent(c)

    // Before anything is written: replacing a configured wallet discards a key
    // that may be the only copy. An interactive user gets to say no; an agent
    // gets a typed refusal rather than a silent, unrecoverable overwrite.
    if (!c.options.force) {
      const replacing = wouldReplace(c.options)
      if (replacing) {
        const describes = replacing.detail
          ? `${replacing.source} (${replacing.detail})`
          : replacing.source
        if (agent) {
          return out.fail(
            'WALLET_ALREADY_CONFIGURED',
            `A wallet is already configured: ${describes}. ${replacing.consequence} Pass --force to proceed.`,
            {
              cta: {
                description: 'Replace it deliberately:',
                commands: [
                  {
                    command: 'wallet init',
                    options: replayOptions(c.options),
                    description: 'Replace the configured wallet',
                  },
                ],
              },
            }
          )
        }
        const confirmed = await p.confirm({
          message: `Replace the configured wallet (${describes})? ${replacing.consequence}`,
          initialValue: false,
        })
        if (p.isCancel(confirmed) || !confirmed) {
          p.cancel('Left the existing wallet in place.')
          return out.fail(
            'WALLET_ALREADY_CONFIGURED',
            'Cancelled — the configured wallet was left in place.'
          )
        }
      }
    }

    if (c.options.source) {
      config.set('source', c.options.source)
    }

    // --keyProject on its own re-scopes the reference already configured. Both
    // reference docs tell the reader to do exactly this, and describe it as
    // never blocked — which was true, but only because nothing consumed it:
    // no branch matched, so the command fell through to `already_configured`,
    // wrote nothing, and reported success. The caller then believed a scope was
    // pinned that never was, and every command kept resolving against the
    // provider's default project.
    if (c.options.keyProject !== undefined && !c.options.keyRef) {
      // Paired with a method that configures a different custody mode there is
      // nothing for a scope to apply to, and this branch runs before those
      // methods — so say so rather than either shadowing them or repeating the
      // silent-ignore this whole branch exists to remove.
      if (c.options.auto || c.options.privateKey || c.options.keystore) {
        return out.fail(
          'KEY_PROJECT_WITHOUT_KEY_REF',
          '--key-project scopes a key reference, and --auto, --private-key and --keystore all configure a wallet that uses none. Drop --key-project, or configure a reference with --key-ref instead.'
        )
      }
      const currentRef = config.get('keyRef')
      if (!currentRef) {
        return out.fail(
          'KEY_PROJECT_WITHOUT_KEY_REF',
          '--key-project scopes a key reference, and this wallet does not use one. Pass --key-ref <provider>:<reference> alongside it, or drop --key-project.',
          {
            cta: {
              description: 'Configure a reference and its scope together:',
              commands: keyRefCtaCommands().map((cmd) => ({
                ...cmd,
                options: { ...cmd.options, keyProject: c.options.keyProject },
              })),
            },
          }
        )
      }
      const badProject = c.options.keyProject
        ? unsafeRefReason(c.options.keyProject)
        : null
      if (badProject) {
        return out.fail(
          'INVALID_KEY_PROJECT',
          `Invalid key project: it ${badProject}.`
        )
      }

      out.step('Scoping key reference')
      // An empty value is how a scope is dropped deliberately — the same
      // convention the --keyRef branch below uses.
      if (c.options.keyProject) {
        config.set('keyRefProject', c.options.keyProject)
      } else {
        config.delete('keyRefProject')
      }
      const parsed = parseKeyRef(currentRef)
      const providerAvailable = parsed
        ? isProviderAvailable(parsed.provider)
        : false
      if (!agent) {
        out.success(
          c.options.keyProject
            ? `Key reference ${currentRef} is now scoped to project ${c.options.keyProject}.`
            : `Key reference ${currentRef} is no longer scoped to a project.`
        )
        p.outro("You're all set!")
      }
      return out.done({
        status: 'configured',
        method: 'keyRef',
        keyRef: currentRef,
        keyProject: config.get('keyRefProject'),
        providerAvailable,
      })
    }

    // Before --keystore and --privateKey so an explicit method always wins, and
    // deliberately allowed in agent mode: unlike a keystore there is no prompt,
    // so this is the one custody mode that works from MCP with no key at rest.
    if (c.options.keyRef) {
      const parsed = parseKeyRef(c.options.keyRef)
      if (!parsed) {
        // Redacted, and the likeliest cause named: --key-ref sits beside
        // --private-key in help and both take a 0x-ish string, so the value
        // that fails to parse here is often the key itself — which must not be
        // quoted back into an envelope bound for the agent's context and logs.
        const redacted = redactKeyLike(c.options.keyRef)
        const looksLikeKey = redacted !== c.options.keyRef
        return out.fail(
          'INVALID_KEY_REF',
          `Invalid key reference "${redacted}". Expected <provider>:<reference>, e.g. clawdi:FILECOIN_PRIVATE_KEY.${looksLikeKey ? ' That looks like a private key rather than a reference to one — to set a key directly, pass it to --private-key instead.' : ''}`
        )
      }
      if (!isKnownProvider(parsed.provider)) {
        return out.fail(
          'UNKNOWN_KEY_REF_PROVIDER',
          `Unknown key-reference provider "${parsed.provider}". Supported: ${providerNames().join(', ')}.`
        )
      }
      // Init is the only moment this is cheap to catch, and the file says so
      // about keystore paths a few lines up. Without it, a reference the
      // resolver will always refuse was stored anyway — `wallet init` reported
      // `configured` and cleared the previous wallet, and every command after
      // it failed with "re-run `foc-cli wallet init`", pointing back at the
      // command that had just accepted the value.
      const badRef = unsafeRefReason(parsed.ref)
      if (badRef) {
        return out.fail(
          'INVALID_KEY_REF',
          `Invalid key reference: it ${badRef}.`
        )
      }
      const badProject = c.options.keyProject
        ? unsafeRefReason(c.options.keyProject)
        : null
      if (badProject) {
        return out.fail(
          'INVALID_KEY_PROJECT',
          `Invalid key project: it ${badProject}.`
        )
      }
      // Validate the shape only, not that it resolves. Resolution needs the
      // provider to be installed and authenticated, which is a different
      // failure with a different fix — and init must stay usable while setting
      // a machine up in any order.
      out.step('Configuring key reference')
      const previousRef = config.get('keyRef')
      config.set('keyRef', c.options.keyRef)
      if (c.options.keyProject) {
        config.set('keyRefProject', c.options.keyProject)
      } else if (
        c.options.keyProject !== undefined ||
        previousRef !== c.options.keyRef
      ) {
        // Cleared only when it no longer applies: an explicit empty
        // --key-project, or a reference that actually changed, since a scope
        // belongs to the reference it was set for.
        //
        // Unconditional deletion made re-running the *same* reference silently
        // destructive — the force guard treats it as a no-op and never asks,
        // so `wallet init --key-ref clawdi:K` on a wallet pinned to a project
        // dropped the pin and re-resolved against the provider's default. That
        // is a different key, and therefore a different address signing, with
        // nothing on screen to say so.
        config.delete('keyRefProject')
      }
      // Clear the alternates: privateKeyFromConfig() prefers keyRef, so leaving
      // a stale key behind would be a key at rest that nothing reads.
      config.delete('privateKey')
      config.delete('keystore')
      // Configuring before installing the provider is legitimate — image
      // layers, provisioning scripts, any fixed-order setup. Nothing is at risk
      // until a command signs, so say so rather than refusing.
      const providerAvailable = isProviderAvailable(parsed.provider)
      if (!agent) {
        p.log.info(`Key reference: ${c.options.keyRef}`)
        if (!providerAvailable) {
          p.log.warn(
            `${parsed.provider} is not installed here yet — install it before running a command that signs.`
          )
        }
        p.outro("You're all set!")
      }
      return out.done({
        status: 'configured',
        method: 'keyRef',
        keyRef: c.options.keyRef,
        // What is configured, not what was passed — a scope carried over from
        // the previous run is still in effect and has to be visible, or the
        // caller reads "no project" off a wallet that is pinned to one.
        keyProject: config.get('keyRefProject'),
        providerAvailable,
      })
    }

    if (c.options.keystore) {
      // A keystore is unusable without a terminal: cast prompts for its
      // password at use time, so a caller that configures one from MCP or
      // automation locks itself out of every subsequent command. Reject at
      // init, where the mistake is cheap to correct.
      //
      // canPrompt, not isAgent, and for the same reason as the preflight in
      // client.ts: a piped or redirected stdout is not the absence of a
      // terminal, and refusing on it would block `wallet init --keystore ... |
      // tee setup.log` on a machine where the keystore works perfectly well.
      if (!canPrompt(c)) {
        return out.fail(
          'KEYSTORE_INTERACTIVE_ONLY',
          'Keystore mode prompts for its password on the terminal at use time, so it cannot work from MCP or automation. Configure a private-key wallet instead.',
          {
            cta: {
              description: 'Choose one:',
              commands: [
                {
                  command: 'wallet init',
                  options: { auto: true },
                  description: 'Generate random key',
                },
                {
                  command: 'wallet init',
                  options: { privateKey: '0x...' },
                  description: 'Set key directly',
                },
                ...keyRefCtaCommands(),
              ],
            },
          }
        )
      }
      // Expand ~ ourselves so '~/.foundry/keystores/foc' works even when the
      // shell didn't get a chance to (e.g. quoted paths).
      const keystorePath = expandHome(c.options.keystore)
      const problem = validateKeystoreFile(keystorePath)
      if (problem) return out.fail(problem.code, problem.message)
      out.step('Configuring keystore')
      config.set('keystore', keystorePath)
      config.delete('privateKey')
      clearKeyRef()
      if (!agent) p.outro("You're all set!")
      return out.done({
        status: 'configured',
        method: 'keystore',
        path: keystorePath,
      })
    }

    if (c.options.privateKey) {
      if (!/^0x[a-fA-F0-9]{64}$/.test(c.options.privateKey)) {
        return out.fail(
          'INVALID_KEY',
          'Invalid private key format. Expected 0x-prefixed 64-char hex.'
        )
      }
      out.step('Configuring private key')
      config.set('privateKey', c.options.privateKey)
      config.delete('keystore')
      clearKeyRef()
      if (!agent) p.outro("You're all set!")
      return out.done({ status: 'configured', method: 'manual' })
    }

    // Explicit methods run before the existing-config shortcut: --auto must
    // replace whatever is configured, exactly as the description promises.
    if (c.options.auto) {
      const privateKey = generatePrivateKey()
      config.set('privateKey', privateKey)
      // Clear the alternate credentials too — privateKeyFromConfig() prefers a
      // configured keyRef, then a keystore, either of which would silently win
      // over the new key.
      config.delete('keystore')
      clearKeyRef()
      if (!agent) {
        p.intro('Initializing Synapse CLI...')
        p.log.success(`Private key: ${privateKey}`)
        p.outro("You're all set!")
      }
      return out.done({
        status: 'configured',
        method: 'auto',
        source: config.get('source') ?? 'foc-cli',
      })
    }

    // A configured key reference counts as configured — it just holds a
    // pointer rather than a key, so there is nothing to print but the pointer,
    // which is safe to show.
    const existingRef = config.get('keyRef')
    if (existingRef) {
      if (!agent) {
        p.log.success(`Key reference: ${existingRef}`)
        p.log.info(`Config file: ${config.path}`)
        p.outro("You're all set!")
      }
      return out.done({
        status: 'already_configured',
        configPath: config.path,
        keyRef: existingRef,
        keyProject: config.get('keyRefProject'),
        source: config.get('source') ?? 'foc-cli',
      })
    }

    // A configured keystore counts as configured too. Without this branch it
    // was the one custody mode invisible here: bare `wallet init` fell past
    // every check to the interactive prompt below, which writes a private key
    // and deletes the keystore — replacing a wallet with no --force and no
    // confirmation, which is exactly what the guard at the top exists to stop.
    // (It cannot catch this one: with no explicit method there is nothing for
    // wouldReplace() to compare, so it correctly reports that nothing is being
    // replaced — and then the prompt replaced it anyway.)
    const existingKeystore = config.get('keystore')
    if (existingKeystore) {
      if (!agent) {
        p.log.success(`Keystore: ${existingKeystore}`)
        p.log.info(`Config file: ${config.path}`)
        p.outro("You're all set!")
      }
      return out.done({
        status: 'already_configured',
        configPath: config.path,
        path: existingKeystore,
        source: config.get('source') ?? 'foc-cli',
      })
    }

    const existingKey = config.get('privateKey')
    if (existingKey) {
      if (!agent) {
        p.log.success(`Private key: ${existingKey}`)
        p.log.info(`Config file: ${config.path}`)
        p.outro("You're all set!")
      }
      return out.done({
        status: 'already_configured',
        configPath: config.path,
        source: config.get('source') ?? 'foc-cli',
      })
    }

    // Agent mode: require explicit options. Keystore is deliberately absent
    // from this guidance — it cannot work from MCP/automation.
    if (agent) {
      return out.fail(
        'INIT_METHOD_REQUIRED',
        'Use --auto, --privateKey, or --keyRef for non-interactive init',
        {
          retryable: true,
          cta: {
            description: 'Choose one:',
            commands: [
              {
                command: 'wallet init',
                options: { auto: true },
                description: 'Generate random key',
              },
              {
                command: 'wallet init',
                options: { privateKey: '0x...' },
                description: 'Set key directly',
              },
              ...keyRefCtaCommands(),
            ],
          },
        }
      )
    }

    // Interactive mode for CLI humans
    p.intro('Initializing Synapse CLI...')
    const privateKeyInput = await p.text({
      message: 'Enter your private key',
      validate(value) {
        if (!value || !/^0x[a-fA-F0-9]{64}$/.test(value))
          return 'Invalid private key!'
      },
    })
    if (p.isCancel(privateKeyInput)) {
      p.cancel('Operation cancelled.')
      process.exit(1)
    }
    config.set('privateKey', privateKeyInput as string)
    config.delete('keystore')
    clearKeyRef()
    p.outro("You're all set!")
    return out.done({ status: 'configured', method: 'manual' })
  },
}
