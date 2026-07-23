import { existsSync, readFileSync, statSync } from 'node:fs'
import * as p from '@clack/prompts'
import { z } from 'incur'
import { generatePrivateKey } from 'viem/accounts'
import config from '../../config.ts'
import { commandOutput, OutputContext } from '../../output.ts'
import { expandHome, isAgent } from '../../utils.ts'

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

export const initCommand = {
  description:
    'Initialize wallet with a private key or keystore. An explicit method (--auto, --keystore, --privateKey) replaces any previously configured wallet; without one, an existing wallet is kept. Keystore mode prompts for its password on the terminal at use time, so it only works in interactive CLI sessions — agent mode rejects --keystore; use --auto or --privateKey.',
  mcp: {
    annotations: {
      title: 'Configure wallet (replaces existing config)',
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
    source: z
      .string()
      .optional()
      .describe(
        'Source tag reported to Synapse/Warm Storage for telemetry (default: foc-cli)'
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
      .enum(['auto', 'keystore', 'manual'])
      .optional()
      .describe('How the wallet was configured (absent on already_configured)'),
    path: z
      .string()
      .optional()
      .describe('Configured keystore path (method: keystore only)'),
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
  ],
  async run(c: any) {
    const out = new OutputContext(c)
    const agent = isAgent(c)

    if (c.options.source) {
      config.set('source', c.options.source)
    }

    if (c.options.keystore) {
      // A keystore is unusable from MCP/automation: cast prompts for its
      // password on the terminal at use time, so an agent that configures one
      // locks itself out of every subsequent command. Reject at init, where
      // the mistake is cheap to correct.
      if (agent) {
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
      if (!agent) p.outro("You're all set!")
      return out.done({ status: 'configured', method: 'manual' })
    }

    // Explicit methods run before the existing-config shortcut: --auto must
    // replace whatever is configured, exactly as the description promises.
    if (c.options.auto) {
      const privateKey = generatePrivateKey()
      config.set('privateKey', privateKey)
      // Clear the alternate credential too — privateKeyFromConfig() prefers a
      // configured keystore, which would silently win over the new key.
      config.delete('keystore')
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
        'Use --auto or --privateKey for non-interactive init',
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
    p.outro("You're all set!")
    return out.done({ status: 'configured', method: 'manual' })
  },
}
