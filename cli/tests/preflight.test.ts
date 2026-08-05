import { beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The wallet preflight, against the real key-ref module.
 *
 * Command tests stub this guard out so they can exercise one command at a time
 * — which means its own behaviour is only ever covered here. The two things it
 * decides are both consequential and both easy to get subtly wrong: which
 * failure code a broken setup gets, and what a caller is told to run about it.
 * A wrong answer to the second is worse than no answer, because agents follow
 * calls to action literally.
 *
 * Nothing about PATH is mocked. The guard's whole job is to report what this
 * process can actually reach, so the tests give it a real PATH to look at.
 */

const configValues: Record<string, string | undefined> = {}
mock.module('../src/config.ts', () => ({
  default: {
    path: '/tmp/foc-cli-preflight-config.json',
    get: (key: string) => configValues[key],
    set: () => {},
    delete: () => {},
  },
}))

// The real isAgent() ORs in !process.stdout.isTTY, and the real canPrompt()
// requires a TTY on some descriptor — under the test runner neither holds, so
// every context would count as agent mode with no terminal, and the two
// keystore branches below would be indistinguishable.
const realUtils = await import('../src/utils.ts')
// Captured before the mock installs: mock.module mutates the live namespace
// object, so reading realUtils.canPrompt afterwards returns the stub and the
// block at the bottom of this file would be testing itself.
const realIsAgent = realUtils.isAgent
const realCanPrompt = realUtils.canPrompt
mock.module('../src/utils.ts', () => ({
  ...realUtils,
  isAgent: (c: { agent?: boolean }) => c.agent === true,
  canPrompt: (c: { agent?: boolean }) => c.agent !== true,
}))

const { requireWallet, walletPreflight } = await import('../src/client.ts')
const { OutputContext } = await import('../src/output.ts')

/** A PATH holding exactly the named executables, and nothing else. */
function withBins(names: string[], run: () => void) {
  const dir = mkdtempSync(join(tmpdir(), 'foc-preflight-bin-'))
  for (const name of names) {
    const bin = join(dir, name)
    writeFileSync(bin, '#!/usr/bin/env bash\nexit 0\n')
    chmodSync(bin, 0o755)
  }
  const previous = process.env.PATH
  process.env.PATH = dir
  try {
    run()
  } finally {
    process.env.PATH = previous
  }
}

beforeEach(() => {
  for (const key of Object.keys(configValues)) delete configValues[key]
})

describe('walletPreflight — no wallet', () => {
  test('reports WALLET_NOT_CONFIGURED with a way out', () => {
    withBins([], () => {
      const problem = walletPreflight({ agent: true })
      expect(problem?.code).toBe('WALLET_NOT_CONFIGURED')
      expect(problem?.cta.commands).toEqual([
        {
          command: 'wallet init',
          options: { auto: true },
          description: 'Generate a random key (testnet)',
        },
      ])
    })
  })

  test('offers a key reference only when its provider is installed here', () => {
    withBins(['clawdi'], () => {
      const problem = walletPreflight({ agent: true })
      expect(problem?.cta.commands).toContainEqual({
        command: 'wallet init',
        options: { keyRef: 'clawdi:FILECOIN_PRIVATE_KEY' },
        description: 'Use a key held in clawdi (nothing at rest)',
      })
    })
  })
})

describe('walletPreflight — key reference', () => {
  test('passes when the provider is reachable', () => {
    configValues.keyRef = 'clawdi:FILECOIN_PRIVATE_KEY'
    withBins(['clawdi'], () => {
      expect(walletPreflight({ agent: true })).toBeNull()
    })
  })

  test('a reference with no provider prefix is typed, not left to throw later', () => {
    // Without this branch the config reaches resolveKeyRef, which throws from
    // outside most commands' try block and surfaces as an untyped UNKNOWN.
    configValues.keyRef = 'FILECOIN_PRIVATE_KEY'
    withBins(['clawdi'], () => {
      const problem = walletPreflight({ agent: true })
      expect(problem?.code).toBe('MALFORMED_KEY_REF')
      // A wallet is configured, so every suggested fix has to carry --force or
      // it will bounce off WALLET_ALREADY_CONFIGURED.
      for (const cmd of problem?.cta.commands ?? []) {
        expect(cmd.options.force).toBe(true)
      }
    })
  })

  test('a missing provider is retryable and suggests nothing destructive', () => {
    // The regression this exists for: the only actionable command used to be
    // `wallet init --auto --force`, so an agent hitting a PATH gap — the most
    // common symptom of running under MCP — would replace a funded, vault
    // backed wallet with a throwaway testnet key and call it a fix.
    configValues.keyRef = 'clawdi:FILECOIN_PRIVATE_KEY'
    withBins([], () => {
      const problem = walletPreflight({ agent: true })
      expect(problem?.code).toBe('KEY_REF_PROVIDER_MISSING')
      expect(problem?.retryable).toBe(true)
      expect(problem?.cta).toBeUndefined()
      expect(problem?.message).not.toContain('--force')
      // It has to say how to actually fix it, since it offers no command.
      expect(problem?.message).toContain('npm install -g clawdi')
      expect(problem?.message).toContain('PATH')
    })
  })

  test('an unknown provider is permanent, not a retryable PATH gap', () => {
    // isProviderAvailable() answers false for "does not exist" and "not
    // installed" alike, so without a separate check a typo'd prefix — or one
    // copied from a newer CLI — was reported as KEY_REF_PROVIDER_MISSING with
    // retryable: true, and an agent retried a permanent misconfiguration
    // forever against an install hint that did not exist.
    configValues.keyRef = 'vault:FILECOIN_PRIVATE_KEY'
    withBins(['clawdi'], () => {
      const problem = walletPreflight({ agent: true })
      expect(problem?.code).toBe('UNKNOWN_KEY_REF_PROVIDER')
      expect(problem?.retryable).toBeUndefined()
      expect(problem?.message).toContain('clawdi')
      for (const cmd of problem?.cta.commands ?? []) {
        expect(cmd.options.force).toBe(true)
      }
    })
  })

  test('a malformed reference is not echoed back when it looks like a key', () => {
    // The likely cause of a reference with no provider prefix is a private key
    // passed to --key-ref, and this message lands in the MCP result and the
    // agent's context.
    configValues.keyRef = `0x${'a'.repeat(64)}`
    withBins(['clawdi'], () => {
      const problem = walletPreflight({ agent: true })
      expect(problem?.code).toBe('MALFORMED_KEY_REF')
      expect(problem?.message).not.toContain('a'.repeat(32))
    })
  })

  test('takes precedence over the other modes, matching key resolution order', () => {
    configValues.keyRef = 'clawdi:FILECOIN_PRIVATE_KEY'
    configValues.keystore = '/tmp/keystore'
    configValues.privateKey = `0x${'a'.repeat(64)}`
    withBins([], () => {
      expect(walletPreflight({ agent: true })?.code).toBe(
        'KEY_REF_PROVIDER_MISSING'
      )
    })
  })
})

describe('walletPreflight — keystore', () => {
  test('is rejected under an agent, where its password prompt is unanswerable', () => {
    configValues.keystore = '/tmp/keystore'
    withBins(['cast'], () => {
      const problem = walletPreflight({ agent: true })
      expect(problem?.code).toBe('KEYSTORE_INTERACTIVE_ONLY')
      // Every alternative replaces a configured wallet, so all need --force.
      for (const cmd of problem?.cta.commands ?? []) {
        expect(cmd.options.force).toBe(true)
      }
    })
  })

  test('reports missing Foundry as retryable rather than dying inside cast', () => {
    configValues.keystore = '/tmp/keystore'
    withBins([], () => {
      const problem = walletPreflight({ agent: false })
      expect(problem?.code).toBe('KEYSTORE_TOOL_MISSING')
      expect(problem?.retryable).toBe(true)
    })
  })

  test('passes on a terminal with cast installed', () => {
    configValues.keystore = '/tmp/keystore'
    withBins(['cast'], () => {
      expect(walletPreflight({ agent: false })).toBeNull()
    })
  })
})

describe('walletPreflight — stored private key', () => {
  test('passes, and needs no external tool at all', () => {
    configValues.privateKey = `0x${'a'.repeat(64)}`
    withBins([], () => {
      expect(walletPreflight({ agent: true })).toBeNull()
      expect(walletPreflight({ agent: false })).toBeNull()
    })
  })
})

describe('requireWallet', () => {
  test('renders a problem through the command error envelope', () => {
    const c = { agent: true, error: (envelope: any) => envelope }
    withBins([], () => {
      const result: any = requireWallet(c, new OutputContext(c))
      expect(result.code).toBe('WALLET_NOT_CONFIGURED')
      expect(result.cta).toBeDefined()
    })
  })

  test('returns null when the wallet is usable, so commands fall through', () => {
    configValues.privateKey = `0x${'a'.repeat(64)}`
    const c = { agent: true, error: (envelope: any) => envelope }
    withBins([], () => {
      expect(requireWallet(c, new OutputContext(c))).toBeNull()
    })
  })

  test('carries retryable through, so a PATH gap is not read as permanent', () => {
    configValues.keyRef = 'clawdi:FILECOIN_PRIVATE_KEY'
    const c = { agent: true, error: (envelope: any) => envelope }
    withBins([], () => {
      const result: any = requireWallet(c, new OutputContext(c))
      expect(result.retryable).toBe(true)
    })
  })
})

describe('canPrompt — the terminal probe behind keystore mode', () => {
  /**
   * The real function, not the mock above: this is the distinction the mock
   * exists to preserve, so it has to be checked somewhere.
   *
   * Keystore mode was gated on isAgent(), which is true whenever stdout is not
   * a TTY — so `foc-cli wallet balance --json | jq` and `wallet costs >
   * costs.json` began refusing with KEYSTORE_INTERACTIVE_ONLY on installs where
   * they had always worked. cast reads the password from /dev/tty; a pipe on
   * stdout takes nothing away from it.
   */
  const streams = {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  }
  const names = ['stdin', 'stdout', 'stderr'] as const

  function withTTYs(
    ttys: Record<(typeof names)[number], boolean>,
    run: () => void
  ) {
    const saved: Record<string, unknown> = {}
    for (const name of names) {
      saved[name] = streams[name].isTTY
      Object.defineProperty(streams[name], 'isTTY', {
        value: ttys[name],
        configurable: true,
      })
    }
    try {
      run()
    } finally {
      for (const name of names) {
        Object.defineProperty(streams[name], 'isTTY', {
          value: saved[name],
          configurable: true,
        })
      }
    }
  }

  test('a pipe on stdout is not the absence of a terminal', () => {
    withTTYs({ stdin: true, stdout: false, stderr: true }, () => {
      // Both readings are correct — they are answers to different questions.
      expect(realIsAgent({})).toBe(true)
      expect(realCanPrompt({})).toBe(true)
    })
  })

  test('no terminal on any descriptor means nothing can prompt', () => {
    withTTYs({ stdin: false, stdout: false, stderr: false }, () => {
      expect(realCanPrompt({})).toBe(false)
    })
  })

  test('an explicit agent context can never prompt, terminal or not', () => {
    withTTYs({ stdin: true, stdout: true, stderr: true }, () => {
      expect(realCanPrompt({ agent: true })).toBe(false)
    })
  })
})

describe('every signing command is guarded', () => {
  /**
   * The guard used to be five lines pasted into each command, which made it a
   * convention: a new command that simply forgot it compiled, passed review,
   * and failed at the wrong layer with an untyped error. This asserts the rule
   * structurally instead — if you build a signing client, you call the guard
   * first — so the next command cannot quietly opt out.
   */
  const commandFiles = readdirSync(
    new URL('../src/commands', import.meta.url),
    {
      recursive: true,
      withFileTypes: true,
    }
  )
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name))

  const signingCommands = commandFiles.filter((file) =>
    /\b(privateKeyClient|synapseClient)\(/.test(readFileSync(file, 'utf8'))
  )

  test('there are signing commands to check', () => {
    // Guards the guard: a rename that broke the detection above would
    // otherwise leave this whole block passing over an empty list.
    expect(signingCommands.length).toBeGreaterThan(10)
  })

  test.each(signingCommands)('%s calls requireWallet first', (file) => {
    const source = readFileSync(file, 'utf8')
    const guard = source.indexOf('requireWallet(c, out)')
    const client = source.search(/\b(privateKeyClient|synapseClient)\(/)
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(client)
  })
})
