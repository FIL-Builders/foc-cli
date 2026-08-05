import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { Errors } from 'incur'

/**
 * Resolving a wallet key held by an external secret manager.
 *
 * This is the same shape as the keystore path in `client.ts`: config names an
 * external source, and the key is fetched at use time by running a helper that
 * prints it on stdout. Nothing is stored — the config holds only a reference,
 * which is safe to display, commit to a runbook, or paste into a ticket.
 *
 * Providers are a closed set on purpose. The binary is chosen by code and only
 * the reference comes from config, so a tampered config cannot turn this into
 * arbitrary command execution — the property the keystore path already has,
 * and the reason there is no general "run this command to get my key" field.
 */

type Provider = {
  /** Executable to run. Resolved against PATH, with Windows extensions. */
  bin: string
  /** Argv for the lookup, given the reference and its optional scope. */
  args: (ref: string, project?: string) => string[]
  /** Shown when the executable is missing. */
  install: string
  /** Shown when the executable runs but fails. */
  diagnose: string
}

const PROVIDERS: Record<string, Provider> = {
  clawdi: {
    bin: 'clawdi',
    args: (ref, project) => [
      'vault',
      'resolve',
      ref,
      ...(project ? ['--project', project] : []),
    ],
    install:
      'the `clawdi` CLI is not on PATH. Install it (npm install -g clawdi) and run `clawdi auth login`.',
    diagnose:
      'Common causes: not logged in (`clawdi auth status --json` — read the `authenticated` field, the exit code is 0 either way), the key does not exist in the vault, or the vault is not attached to this project (`clawdi vault attach default --project <project>`). References are per-project: one copied from another machine resolves against the wrong project or not at all.',
  },
}

/**
 * Characters a reference (or its project scope) may contain.
 *
 * Everything here reaches a child process's argv, and on Windows an
 * npm-installed helper is a `.cmd` that can only be launched through `cmd.exe`
 * — so on that platform the values pass through a shell. Restricting them to
 * this set is what keeps the promise made at the top of this file: a tampered
 * config cannot turn key resolution into arbitrary command execution. The set
 * covers every reference shape the providers actually accept (`KEY`,
 * `vault/KEY`, `vault/section:odd/KEY`) and excludes every cmd metacharacter.
 *
 * A leading `-` is excluded separately, and for a different reason: it is a
 * perfectly ordinary character in the middle of a reference, but at the front
 * it stops being data. `clawdi:--project` spreads into argv as `clawdi vault
 * resolve --project`, so the value steers the helper's own option parsing
 * instead of naming a secret — which breaks the same promise by a route that
 * has nothing to do with shell metacharacters. Not arbitrary execution, but
 * config controlling the helper's flags is more than "only the reference comes
 * from config" allows.
 */
const SAFE_REF = /^[A-Za-z0-9 @_.:/][A-Za-z0-9 @_.:/-]*$/

/**
 * Why this reference or project scope cannot be used — as a clause completing
 * "it …" — or null if the value is fine.
 *
 * A fragment rather than a whole sentence because the callers frame it
 * differently and both framings are right: `wallet init` is describing an
 * option the caller just typed, and `resolveKeyRef` a value already sitting in
 * the config file.
 *
 * Exported so init can refuse at the moment the mistake is cheap to correct.
 * Without that it stored anything shaped like `<provider>:<ref>`, reported
 * `configured`, cleared the previous wallet — and every later command failed
 * with "re-run `foc-cli wallet init`", sending the user back to the command
 * that had just accepted the value.
 */
export function unsafeRefReason(value: string): string | null {
  if (value.startsWith('-')) {
    return `cannot start with "-", which the provider's own CLI would read as an option rather than as a value`
  }
  if (!SAFE_REF.test(value)) {
    return 'may only contain letters, digits, space, and @ _ . : / - — every character here is passed to another program, so the set is restricted on purpose'
  }
  return null
}

export function providerNames(): string[] {
  return Object.keys(PROVIDERS)
}

/**
 * Distinct 0x + 64 hex values in a helper's output.
 *
 * Bounded on both sides, because a loose match is worse than no match here:
 * every 32-byte value is a valid secp256k1 key, so the first 64 hex digits of a
 * longer blob would be accepted silently and sign as a completely different
 * address. Deduplicated so a helper that echoes the value twice does not read
 * as ambiguous, and returned as a list rather than a verdict so both callers —
 * the providers below and the `cast` keystore path in client.ts, which scrape
 * output of exactly the same shape — can refuse an ambiguous result in their
 * own words. One matcher, because two copies is how one of them stays loose.
 */
export function findPrivateKeys(output: string): string[] {
  return [
    ...new Set(
      output.match(/(?<![a-fA-F0-9x])0x[a-fA-F0-9]{64}(?![a-fA-F0-9])/g) ?? []
    ),
  ]
}

/**
 * A caller-supplied value, made safe to quote back in an error message.
 *
 * Diagnostics that echo what was passed have to assume the wrong thing was
 * passed — and `--key-ref 0x<64 hex>` is the plausible mix-up, since it sits
 * beside `--private-key` in help and both take a 0x-ish string. An error
 * envelope travels into the MCP result, the agent's context and every log
 * downstream, so that one mistake must not be repeated back verbatim.
 *
 * Matches more loosely than `findPrivateKeys` on purpose: a key that was
 * mistyped, truncated or pasted without its prefix is still a secret, and
 * nothing legitimate on this path is a 32-character run of pure hex.
 */
export function redactKeyLike(value: string): string {
  return value.replace(/(?:0x)?[a-fA-F0-9]{32,}/g, '<redacted>')
}

/**
 * Split `<provider>:<ref>`. The reference may itself contain colons (clawdi
 * accepts `vault/KEY` and `vault/section/KEY`), so only the first one splits.
 */
export function parseKeyRef(
  value: string
): { provider: string; ref: string } | null {
  const at = value.indexOf(':')
  if (at <= 0) return null
  const provider = value.slice(0, at).trim()
  const ref = value.slice(at + 1).trim()
  if (!provider || !ref) return null
  return { provider, ref }
}

export function isKnownProvider(name: string): boolean {
  return Object.hasOwn(PROVIDERS, name)
}

/**
 * Is this provider's helper actually on PATH? A filesystem probe — no process
 * is started, nothing is authenticated, no network is touched — so it is cheap
 * enough to call before offering a provider as an option.
 */
export function isProviderAvailable(name: string): boolean {
  const provider = PROVIDERS[name]
  return provider ? resolveBin(provider.bin) !== null : false
}

/**
 * How to install a provider's helper. Exported so the preflight can say what to
 * do about a missing one without restating it — the wording lives with the
 * provider definition, which is the only place that knows how it is shipped.
 */
export function providerInstallHint(name: string): string | null {
  return PROVIDERS[name]?.install ?? null
}

/**
 * The same PATH probe the providers use, for the other external tool the CLI
 * shells out to (Foundry's `cast`, behind keystore mode). Here so both custody
 * modes answer "is the tool I need actually reachable from this process?" the
 * same way, and share the cache below.
 */
export function isOnPath(bin: string): boolean {
  return resolveBin(bin) !== null
}

/**
 * Providers whose helper is installed here. Used to decide what to *suggest*:
 * a call to action naming a tool the user does not have is a dead end, so the
 * CLI only ever offers what would work on this machine. The reference docs
 * still describe every provider, installed or not.
 */
export function availableProviders(): string[] {
  return providerNames().filter(isProviderAvailable)
}

/**
 * `wallet init --key-ref` entries for a call to action, one per provider that
 * is actually installed here — suggesting a tool the machine does not have is a
 * dead end. Defined once, next to `availableProviders()`, because every surface
 * that offers key-reference setup must offer it in the same words: two copies
 * of this drift, and the same error then answers the same question differently
 * depending on which command produced it.
 */
export function keyRefCtaCommands() {
  return availableProviders().map((provider) => ({
    command: 'wallet init',
    options: { keyRef: `${provider}:FILECOIN_PRIVATE_KEY` },
    description: `Use a key held in ${provider} (nothing at rest)`,
  }))
}

/**
 * Find an executable on PATH.
 *
 * `execFileSync` does not apply PATHEXT on Windows, so an npm-installed helper
 * — which is `clawdi.cmd` there, not `clawdi` — fails with a bare ENOENT that
 * reads as "not installed" when it is. Probe the real filenames instead of
 * reaching for `shell: true`, which would put a config-supplied string through
 * a shell.
 */
function resolveBin(bin: string): string | null {
  const cacheKey = `${bin}\u0000${process.env.PATH ?? ''}`
  const cached = binCache.get(cacheKey)
  if (cached !== undefined) return cached

  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .filter(Boolean)
      : ['']
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = join(dir, bin + ext)
      try {
        // Stat rather than trust the name: a directory called `clawdi` on PATH
        // would otherwise be "found" and then fail with a confusing EACCES.
        if (statSync(candidate).isFile()) {
          binCache.set(cacheKey, candidate)
          return candidate
        }
      } catch {
        // Not here; keep looking.
      }
    }
  }
  return null
}

/**
 * Found binaries only, keyed on the PATH they were found under.
 *
 * Every signing command probes twice — once in the preflight to decide whether
 * the provider is usable, once again when it actually resolves the key — and
 * each probe is a stat per PATH entry per extension (on Windows, four times the
 * entries). Misses are deliberately not cached: a long-lived MCP process must
 * still pick up a provider installed mid-session, and a miss is the one case
 * where the scan is about to be reported to the user anyway.
 */
const binCache = new Map<string, string>()

/**
 * Fetch the key named by `keyRef`. Returns a 0x-prefixed private key.
 *
 * Every failure message below is written to be actionable without ever echoing
 * what came back — a resolver that fails part-way can return anything, and the
 * one thing it must never do is print it.
 *
 * They are also all `IncurError`, which is what makes them useful to an agent.
 * This function runs at *use* time, from inside the client construction that
 * every signing command performs before its try block — so a plain Error here
 * reached incur's top-level handler and rendered as `{ code: 'UNKNOWN' }` with
 * no code and no `retryable`, which is the single most common failure an agent
 * sees from a vault-backed wallet (not logged in, vault not attached, wrong
 * field). Typing it at the throw fixes every path at once, including commands
 * that do not exist yet.
 *
 * Moving the construction inside each command's try would *not* have fixed it:
 * those catches end in `out.fail('UPLOAD_FAILED', ...)` and friends, so a key
 * that could not be fetched would be reported as an upload that failed.
 *
 * Codes match the ones `walletPreflight` emits for the same conditions. The
 * distinction between "caught early by the guard" and "discovered at use time"
 * is an implementation detail, and the caller's fix is identical either way.
 */
export function resolveKeyRef(keyRef: string, project?: string): string {
  const parsed = parseKeyRef(keyRef)
  if (!parsed) {
    throw new Errors.IncurError({
      code: 'MALFORMED_KEY_REF',
      message: `Malformed key reference in config: expected "<provider>:<reference>", e.g. clawdi:FILECOIN_PRIVATE_KEY.`,
      hint: 'Re-run `foc-cli wallet init --key-ref <provider>:<reference> --force`.',
    })
  }
  const provider = PROVIDERS[parsed.provider]
  if (!provider) {
    throw new Errors.IncurError({
      code: 'UNKNOWN_KEY_REF_PROVIDER',
      message: `Unknown key-reference provider "${parsed.provider}". Supported: ${providerNames().join(', ')}.`,
      hint: 'Re-run `foc-cli wallet init --key-ref <provider>:<reference> --force`.',
    })
  }

  for (const [what, value] of [
    ['reference', parsed.ref],
    ['project', project],
  ] as const) {
    const reason = value === undefined ? null : unsafeRefReason(value)
    if (reason) {
      throw new Errors.IncurError({
        code: 'MALFORMED_KEY_REF',
        message: `Malformed key ${what} in config: it ${reason}.`,
        hint: 'Re-run `foc-cli wallet init --key-ref <provider>:<reference> --force`.',
      })
    }
  }

  const bin = resolveBin(provider.bin)
  if (!bin) {
    throw new Errors.IncurError({
      code: 'KEY_REF_PROVIDER_MISSING',
      // Retryable for the same reason the preflight says so: the wallet is
      // intact and a PATH gap is usually transient, especially under an agent.
      retryable: true,
      message: `Failed to resolve the wallet key: ${provider.install}`,
    })
  }

  let output: string
  try {
    output = execProvider(bin, provider.args(parsed.ref, project))
  } catch (error) {
    // ENOENT: the binary vanished between the probe and here. EINVAL/ENOEXEC:
    // it exists but cannot be launched as a process at all. Neither means the
    // provider ran and refused, so neither should be handed the "not logged
    // in / wrong project" diagnosis below — that reads as a vault problem when
    // it is an installation problem.
    const code = (error as { code?: string }).code
    if (code === 'ENOENT' || code === 'EINVAL' || code === 'ENOEXEC') {
      throw new Errors.IncurError({
        code: 'KEY_REF_PROVIDER_MISSING',
        retryable: true,
        message: `Failed to resolve the wallet key: ${provider.install}`,
      })
    }
    // Not retryable: the provider ran and said no. Every cause below needs a
    // deliberate act (log in, attach the vault, fix the reference), and an
    // agent that retries instead of acting just burns the session.
    throw new Errors.IncurError({
      code: 'KEY_REF_RESOLUTION_FAILED',
      message: `Failed to resolve the wallet key from ${parsed.provider} (${parsed.ref}). ${provider.diagnose}`,
    })
  }

  // Scrape rather than trust the whole of stdout: helpers add human framing
  // around the value, and the keystore path takes the same approach with cast.
  // Refusing an ambiguous output is the same reasoning as the bounded match in
  // findPrivateKeys — two candidates mean the CLI would be guessing which one
  // is the key.
  const found = findPrivateKeys(output)
  if (found.length === 0) {
    throw new Errors.IncurError({
      code: 'KEY_REF_NOT_A_KEY',
      message: `${parsed.provider} resolved "${parsed.ref}" but it does not hold a private key (expected 0x + 64 hex, on its own rather than inside a longer value). Check the reference points at the right field — the value is not shown here on purpose.`,
    })
  }
  if (found.length > 1) {
    throw new Errors.IncurError({
      code: 'KEY_REF_AMBIGUOUS',
      message: `${parsed.provider} resolved "${parsed.ref}" to output containing ${found.length} different 0x + 64 hex values, so which one is the key is ambiguous. Point the reference at a field that holds only the key — the values are not shown here on purpose.`,
    })
  }
  return found[0]
}

/**
 * Run the provider's helper and return its stdout.
 *
 * On Windows an npm-installed helper is `clawdi.cmd`, and a `.cmd` is a script
 * rather than an executable: `CreateProcess` cannot launch it, and Node has
 * refused to do so implicitly since the fix for CVE-2024-27980. Without this it
 * fails with EINVAL — which, read as "the provider refused", produced a
 * confident diagnosis about vault login for what is really a launch failure.
 * Batch files therefore go through `cmd.exe`, with every argument quoted; the
 * SAFE_REF check above is what makes that safe, since the only argument not
 * fixed by this file has already been restricted to characters cmd treats
 * literally inside quotes.
 */
function execProvider(bin: string, args: string[]): string {
  const batch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)
  return execFileSync(
    batch ? `"${bin}"` : bin,
    batch ? args.map((arg) => `"${arg}"`) : args,
    {
      encoding: 'utf8',
      // The key arrives on stdout; let stderr through so the provider's own
      // diagnostics stay visible, and never inherit stdin — a helper that
      // decides to prompt would hang the CLI (and the MCP server) forever.
      stdio: ['ignore', 'pipe', 'inherit'],
      shell: batch,
    }
  )
}
