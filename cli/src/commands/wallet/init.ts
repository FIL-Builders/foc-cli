import { existsSync, readFileSync, statSync } from 'node:fs'
import * as p from '@clack/prompts'
import { z } from 'incur'
import { generatePrivateKey } from 'viem/accounts'
import config from '../../config.ts'
import { OutputContext } from '../../output.ts'
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
  if (statSync(path).isDirectory()) {
    return {
      code: 'KEYSTORE_INVALID',
      message: `${path} is a directory, not a keystore file. cast wallet new/import writes a file named by a random UUID inside that directory — pass the file's full path.`,
    }
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || !('crypto' in parsed)) {
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
    'Initialize wallet with a private key or keystore. Replaces any previously configured wallet. Keystore mode prompts for its password on the terminal at use time, so it only works in interactive CLI sessions — for MCP or automation, configure a private key (--auto or --privateKey).',
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
      .describe('Path to a Foundry keystore file (requires foundry)'),
    privateKey: z.string().optional().describe('Private key (0x-prefixed hex)'),
    source: z
      .string()
      .optional()
      .describe(
        'Source tag reported to Synapse/Warm Storage for telemetry (default: foc-cli)'
      ),
  }),
  alias: { auto: 'a' },
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
      // Expand ~ ourselves: MCP/agent invocations have no shell to do it, so
      // '~/.foundry/keystores/foc' would otherwise "not exist".
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

    if (c.options.auto) {
      const privateKey = generatePrivateKey()
      config.set('privateKey', privateKey)
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

    // Agent mode: require explicit options
    if (agent) {
      return out.fail(
        'INIT_METHOD_REQUIRED',
        'Use --auto, --keystore, or --privateKey for non-interactive init',
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
                options: { keystore: '<path>' },
                description: 'Use Foundry keystore',
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
