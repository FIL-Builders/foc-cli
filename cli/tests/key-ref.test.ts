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
import { Errors } from 'incur'
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

  test('a reference or project starting with "-" is rejected as an option, not passed as one', () => {
    // Not command execution, but it breaks the same promise by another route:
    // `clawdi:--project` reaches argv as `clawdi vault resolve --project`, so
    // config would be steering the helper's own flag parsing rather than
    // naming a secret. Every other position of "-" stays legal.
    withFakeClawdi(`echo "${KEY}"`, () => {
      for (const bad of ['--project', '-x', '--help']) {
        expect(() => resolveKeyRef(`clawdi:${bad}`)).toThrow(
          /Malformed key reference in config/
        )
      }
      expect(() =>
        resolveKeyRef('clawdi:FILECOIN_PRIVATE_KEY', '--project')
      ).toThrow(/Malformed key project in config/)
      // A dash inside the value is ordinary and must keep working.
      expect(resolveKeyRef('clawdi:FILECOIN-PRIVATE-KEY')).toBe(KEY)
    })
  })

  test('a reference that is itself a private key is refused, and never echoed', () => {
    // The documented --private-key/--key-ref mix-up with the provider prefix
    // included — e.g. a doc placeholder `clawdi:<reference>` filled in with
    // the key. Hex passes SAFE_REF, so without its own rule the key was
    // stored, sent to the provider as a lookup name, and echoed verbatim into
    // the use-time error envelope.
    withFakeClawdi(`echo "${KEY}"`, () => {
      for (const bad of [KEY, KEY.slice(2)]) {
        try {
          resolveKeyRef(`clawdi:${bad}`)
          throw new Error('expected a throw')
        } catch (error) {
          const message = (error as Error).message
          expect(message).toContain('private key rather than a reference')
          expect(message).not.toContain('a'.repeat(32))
        }
      }
    })
  })

  test('a key-like run embedded in a longer reference is redacted from failures', () => {
    // `vault/0x<64 hex>` is not exactly a key, so validation lets it through —
    // but whatever hex run it carries must still not ride into the envelope.
    const run = 'c'.repeat(64)
    withFakeClawdi('exit 1', () => {
      try {
        resolveKeyRef(`clawdi:vault/0x${run}`)
        throw new Error('expected a throw')
      } catch (error) {
        expect((error as Error).message).not.toContain('c'.repeat(32))
      }
    })
    withFakeClawdi('echo "not-a-key"', () => {
      try {
        resolveKeyRef(`clawdi:vault/0x${run}`)
        throw new Error('expected a throw')
      } catch (error) {
        expect((error as Error).message).not.toContain('c'.repeat(32))
      }
    })
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

/**
 * Every failure here is typed.
 *
 * This function runs at *use* time, from inside the client construction that
 * every signing command performs before its try block — so a plain Error
 * reached incur's top-level handler and rendered as `{ code: 'UNKNOWN' }` with
 * no code and no retryable flag. That is the shape an agent sees for the most
 * common failure a vault-backed wallet has: installed but not logged in.
 *
 * Moving the construction inside each command's try would not have fixed it.
 * Those catches end in `out.fail('UPLOAD_FAILED', ...)` and friends, so a key
 * that could not be fetched would have been reported as an upload that failed
 * — typed, and wrong. Typing the throw is what fixes every command at once.
 */
describe('resolveKeyRef error taxonomy', () => {
  function thrownBy(run: () => void): Errors.IncurError {
    try {
      run()
    } catch (error) {
      expect(error).toBeInstanceOf(Errors.IncurError)
      return error as Errors.IncurError
    }
    throw new Error('expected a throw')
  }

  test('a reference with no provider prefix is MALFORMED_KEY_REF', () => {
    expect(thrownBy(() => resolveKeyRef('FILECOIN_PRIVATE_KEY')).code).toBe(
      'MALFORMED_KEY_REF'
    )
  })

  test('an unrecognized provider is UNKNOWN_KEY_REF_PROVIDER', () => {
    expect(thrownBy(() => resolveKeyRef('vault:KEY')).code).toBe(
      'UNKNOWN_KEY_REF_PROVIDER'
    )
  })

  test('a provider that ran and refused is not retryable', () => {
    // The distinction that matters to an agent: this needs a deliberate act
    // (log in, attach the vault, fix the reference), so retrying is waste.
    withFakeClawdi('exit 1', () => {
      const error = thrownBy(() => resolveKeyRef('clawdi:FILECOIN_PRIVATE_KEY'))
      expect(error.code).toBe('KEY_REF_RESOLUTION_FAILED')
      expect(error.retryable).toBe(false)
    })
  })

  test('a provider that is not installed is retryable', () => {
    // Whereas a PATH gap usually is transient — the wallet is intact.
    const previous = process.env.PATH
    process.env.PATH = mkdtempSync(join(tmpdir(), 'foc-empty-path-'))
    try {
      const error = thrownBy(() => resolveKeyRef('clawdi:FILECOIN_PRIVATE_KEY'))
      expect(error.code).toBe('KEY_REF_PROVIDER_MISSING')
      expect(error.retryable).toBe(true)
    } finally {
      process.env.PATH = previous
    }
  })

  test('a reference that is itself a key is MALFORMED_KEY_REF', () => {
    expect(thrownBy(() => resolveKeyRef(`clawdi:${KEY}`)).code).toBe(
      'MALFORMED_KEY_REF'
    )
  })

  test('a reference pointing at the wrong field is KEY_REF_NOT_A_KEY', () => {
    withFakeClawdi('echo "not-a-key"', () => {
      expect(thrownBy(() => resolveKeyRef('clawdi:WRONG')).code).toBe(
        'KEY_REF_NOT_A_KEY'
      )
    })
  })

  test('two candidate keys are KEY_REF_AMBIGUOUS rather than a guess', () => {
    withFakeClawdi(`echo "${KEY} 0x${'b'.repeat(64)}"`, () => {
      expect(thrownBy(() => resolveKeyRef('clawdi:BOTH')).code).toBe(
        'KEY_REF_AMBIGUOUS'
      )
    })
  })
})
