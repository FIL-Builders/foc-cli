import { describe, expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  isKnownProvider,
  parseKeyRef,
  providerNames,
  resolveKeyRef,
} from '../src/key-ref.ts'

const KEY = `0x${'a'.repeat(64)}`

/**
 * Put a fake provider executable on PATH for the duration of one test. The
 * resolver shells out by design, so the only honest way to test it is to give
 * it something real to shell out to.
 */
function withFakeClawdi(script: string, run: () => void) {
  const dir = mkdtempSync(join(tmpdir(), 'foc-key-ref-'))
  const bin = join(dir, 'clawdi')
  writeFileSync(bin, `#!/usr/bin/env bash\n${script}\n`)
  chmodSync(bin, 0o755)
  const previous = process.env.PATH
  process.env.PATH = `${dir}:${previous}`
  try {
    run()
  } finally {
    process.env.PATH = previous
  }
}

describe('parseKeyRef', () => {
  test('splits provider from reference', () => {
    expect(parseKeyRef('clawdi:FILECOIN_PRIVATE_KEY')).toEqual({
      provider: 'clawdi',
      ref: 'FILECOIN_PRIVATE_KEY',
    })
  })

  test('splits on the FIRST colon only, so nested key paths survive', () => {
    // clawdi accepts `vault/KEY` and `vault/section/KEY`; a reference that
    // itself contains a colon must not be truncated.
    expect(parseKeyRef('clawdi:vault/section:odd/KEY')).toEqual({
      provider: 'clawdi',
      ref: 'vault/section:odd/KEY',
    })
  })

  test('rejects shapes that are not <provider>:<reference>', () => {
    expect(parseKeyRef('FILECOIN_PRIVATE_KEY')).toBeNull()
    expect(parseKeyRef(':FILECOIN_PRIVATE_KEY')).toBeNull()
    expect(parseKeyRef('clawdi:')).toBeNull()
    expect(parseKeyRef('')).toBeNull()
  })
})

describe('providers', () => {
  test('clawdi is known, arbitrary names are not', () => {
    expect(isKnownProvider('clawdi')).toBe(true)
    expect(isKnownProvider('rm')).toBe(false)
    expect(providerNames()).toContain('clawdi')
  })
})

describe('resolveKeyRef', () => {
  test('returns the key the provider prints', () => {
    withFakeClawdi(`echo "${KEY}"`, () => {
      expect(resolveKeyRef('clawdi:FILECOIN_PRIVATE_KEY')).toBe(KEY)
    })
  })

  test('scrapes the key out of human framing around it', () => {
    // Providers add prose; the keystore path scrapes cast's output the same way.
    withFakeClawdi(
      `echo "Resolved FILECOIN_PRIVATE_KEY -> ${KEY} (project: x)"`,
      () => {
        expect(resolveKeyRef('clawdi:FILECOIN_PRIVATE_KEY')).toBe(KEY)
      }
    )
  })

  test('passes --project through only when one is configured', () => {
    // The provider refuses the flag rather than ignoring it: a script that
    // exits 0 whatever argv it gets cannot tell "no --project was sent" from
    // "one was", so the negative half of this test would assert nothing.
    withFakeClawdi(
      `[[ "$*" == *"--project"* ]] && exit 3\necho "${KEY}"`,
      () => {
        // No project: the provider picks its own default, so no flag is sent.
        expect(resolveKeyRef('clawdi:FILECOIN_PRIVATE_KEY')).toBe(KEY)
      }
    )
    withFakeClawdi(
      `[[ "$*" == *"--project engineering"* ]] || exit 3\necho "${KEY}"`,
      () => {
        expect(
          resolveKeyRef('clawdi:FILECOIN_PRIVATE_KEY', 'engineering')
        ).toBe(KEY)
      }
    )
  })

  test('a longer hex value is refused, not truncated into a different key', () => {
    // The dangerous case: every 32-byte value is a valid secp256k1 key, so a
    // regex that took the first 64 hex digits of a 128-hex blob would return a
    // perfectly usable key for a completely different address — and the CLI
    // would sign with it rather than fail.
    const blob = `0x${'a'.repeat(128)}`
    withFakeClawdi(`echo "${blob}"`, () => {
      expect(() => resolveKeyRef('clawdi:PAIR')).toThrow(
        /does not hold a private key/
      )
    })
  })

  test('a key-shaped value inside a longer token is not mistaken for the key', () => {
    withFakeClawdi(`echo "trace=deadbeef${KEY.slice(2)}"`, () => {
      expect(() => resolveKeyRef('clawdi:WRONG_FIELD')).toThrow(
        /does not hold a private key/
      )
    })
  })

  test('output with two different keys is refused rather than guessed at', () => {
    const other = `0x${'b'.repeat(64)}`
    withFakeClawdi(`echo "${KEY}"\necho "${other}"`, () => {
      try {
        resolveKeyRef('clawdi:AMBIGUOUS')
        throw new Error('expected a throw')
      } catch (error) {
        const message = (error as Error).message
        expect(message).toContain('ambiguous')
        // Same rule as every other failure here: name the problem, never the
        // values that caused it.
        expect(message).not.toContain(KEY)
        expect(message).not.toContain(other)
      }
    })
  })

  test('the same key repeated in framing is still just one key', () => {
    withFakeClawdi(`echo "${KEY} -> ${KEY}"`, () => {
      expect(resolveKeyRef('clawdi:FILECOIN_PRIVATE_KEY')).toBe(KEY)
    })
  })

  test('a reference with shell metacharacters is rejected before anything runs', () => {
    // On Windows an npm-installed helper is a .cmd and can only be launched
    // through cmd.exe, so these values would reach a shell. The allowlist is
    // what keeps a tampered config from becoming command execution.
    const canary = join(mkdtempSync(join(tmpdir(), 'foc-canary-')), 'ran')
    withFakeClawdi(`echo "${KEY}"`, () => {
      for (const bad of [
        `KEY" & touch "${canary}`,
        'KEY$(id)',
        'KEY`id`',
        'KEY%PATH%',
        'KEY|id',
        'KEY\nid',
      ]) {
        expect(() => resolveKeyRef(`clawdi:${bad}`)).toThrow(
          /Malformed key reference in config/
        )
      }
      expect(() =>
        resolveKeyRef('clawdi:FILECOIN_PRIVATE_KEY', 'proj & id')
      ).toThrow(/Malformed key project in config/)
    })
    expect(existsSync(canary)).toBe(false)
  })

  test('nested reference paths survive the allowlist', () => {
    // The shapes clawdi actually writes must not be collateral damage.
    for (const ref of [
      'FILECOIN_PRIVATE_KEY',
      'vault/FILECOIN_PRIVATE_KEY',
      'vault/section:odd/KEY',
    ]) {
      withFakeClawdi(`echo "${KEY}"`, () => {
        expect(resolveKeyRef(`clawdi:${ref}`)).toBe(KEY)
      })
    }
  })

  test('a provider that resolves something that is not a key fails without echoing it', () => {
    const secret = 'hunter2-not-a-private-key'
    withFakeClawdi(`echo "${secret}"`, () => {
      try {
        resolveKeyRef('clawdi:WRONG_FIELD')
        throw new Error('expected a throw')
      } catch (error) {
        const message = (error as Error).message
        expect(message).toContain('does not hold a private key')
        // The whole point: a wrong reference must not leak what it did resolve.
        expect(message).not.toContain(secret)
      }
    })
  })

  test('a failing provider reports how to diagnose it, not the raw exit', () => {
    withFakeClawdi('exit 1', () => {
      expect(() => resolveKeyRef('clawdi:FILECOIN_PRIVATE_KEY')).toThrow(
        /Failed to resolve the wallet key from clawdi/
      )
    })
  })

  test('a missing provider binary says how to install it', () => {
    const previous = process.env.PATH
    process.env.PATH = mkdtempSync(join(tmpdir(), 'foc-empty-path-'))
    try {
      expect(() => resolveKeyRef('clawdi:FILECOIN_PRIVATE_KEY')).toThrow(
        /not on PATH/
      )
    } finally {
      process.env.PATH = previous
    }
  })

  test('an unknown provider is rejected before anything is executed', () => {
    expect(() => resolveKeyRef('definitely-not-a-provider:KEY')).toThrow(
      /Unknown key-reference provider/
    )
  })

  test('a malformed reference names the expected shape', () => {
    expect(() => resolveKeyRef('FILECOIN_PRIVATE_KEY')).toThrow(
      /<provider>:<reference>/
    )
  })

  test('a directory named like the binary is not mistaken for it', () => {
    // resolveBin stats candidates; without that a directory on PATH called
    // `clawdi` would be "found" and fail later with a confusing EACCES.
    const dir = mkdtempSync(join(tmpdir(), 'foc-dir-path-'))
    mkdirSync(join(dir, 'clawdi'))
    const previous = process.env.PATH
    process.env.PATH = dir
    try {
      expect(() => resolveKeyRef('clawdi:FILECOIN_PRIVATE_KEY')).toThrow(
        /not on PATH/
      )
    } finally {
      process.env.PATH = previous
    }
  })
})
