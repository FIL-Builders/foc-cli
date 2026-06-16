import { existsSync } from 'node:fs'
import * as p from '@clack/prompts'
import { z } from 'incur'
import { generatePrivateKey } from 'viem/accounts'
import config from '../../config.ts'
import { OutputContext } from '../../output.ts'
import { isAgent } from '../../utils.ts'

export const initCommand = {
  description: 'Initialize wallet with a private key or keystore',
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
      if (existsSync(c.options.keystore)) {
        out.step('Configuring keystore')
        config.set('keystore', c.options.keystore)
        config.delete('privateKey')
        if (!agent) p.outro("You're all set!")
        return out.done({
          status: 'configured',
          method: 'keystore',
          path: c.options.keystore,
        })
      }
      return out.fail(
        'KEYSTORE_NOT_FOUND',
        `Keystore file not found: ${c.options.keystore}`
      )
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
