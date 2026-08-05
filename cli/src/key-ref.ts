import { execFileSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { delimiter, join } from 'node:path'

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
 */
const SAFE_REF = /^[A-Za-z0-9 @_.:/-]+$/

export function providerNames(): string[] {
  return Object.keys(PROVIDERS)
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
 */
export function resolveKeyRef(keyRef: string, project?: string): string {
  const parsed = parseKeyRef(keyRef)
  if (!parsed) {
    throw new Error(
      `Malformed key reference in config: expected "<provider>:<reference>", e.g. clawdi:FILECOIN_PRIVATE_KEY. Re-run \`foc-cli wallet init --key-ref <provider>:<reference>\`.`
    )
  }
  const provider = PROVIDERS[parsed.provider]
  if (!provider) {
    throw new Error(
      `Unknown key-reference provider "${parsed.provider}". Supported: ${providerNames().join(', ')}.`
    )
  }

  for (const [what, value] of [
    ['reference', parsed.ref],
    ['project', project],
  ] as const) {
    if (value !== undefined && !SAFE_REF.test(value)) {
      throw new Error(
        `Malformed key ${what} in config: it contains characters that are not allowed in a ${what} (letters, digits, space, and @ _ . : / -). Re-run \`foc-cli wallet init --key-ref <provider>:<reference>\`.`
      )
    }
  }

  const bin = resolveBin(provider.bin)
  if (!bin) {
    throw new Error(`Failed to resolve the wallet key: ${provider.install}`)
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
      throw new Error(`Failed to resolve the wallet key: ${provider.install}`)
    }
    throw new Error(
      `Failed to resolve the wallet key from ${parsed.provider} (${parsed.ref}). ${provider.diagnose}`
    )
  }

  // Scrape rather than trust the whole of stdout: helpers add human framing
  // around the value, and the keystore path takes the same approach with cast.
  //
  // Bounded on both sides, because a loose match is worse than no match here:
  // every 32-byte value is a valid secp256k1 key, so the first 64 hex digits of
  // a longer blob would be accepted silently and sign as a completely different
  // address. Refusing an ambiguous output is the same reasoning — two candidates
  // mean the CLI would be guessing which one is the key.
  const found = [
    ...new Set(
      output.match(/(?<![a-fA-F0-9x])0x[a-fA-F0-9]{64}(?![a-fA-F0-9])/g) ?? []
    ),
  ]
  if (found.length === 0) {
    throw new Error(
      `${parsed.provider} resolved "${parsed.ref}" but it does not hold a private key (expected 0x + 64 hex, on its own rather than inside a longer value). Check the reference points at the right field — the value is not shown here on purpose.`
    )
  }
  if (found.length > 1) {
    throw new Error(
      `${parsed.provider} resolved "${parsed.ref}" to output containing ${found.length} different 0x + 64 hex values, so which one is the key is ambiguous. Point the reference at a field that holds only the key — the values are not shown here on purpose.`
    )
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
