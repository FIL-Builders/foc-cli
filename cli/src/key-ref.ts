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
 * Find an executable on PATH.
 *
 * `execFileSync` does not apply PATHEXT on Windows, so an npm-installed helper
 * — which is `clawdi.cmd` there, not `clawdi` — fails with a bare ENOENT that
 * reads as "not installed" when it is. Probe the real filenames instead of
 * reaching for `shell: true`, which would put a config-supplied string through
 * a shell.
 */
function resolveBin(bin: string): string | null {
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
        if (statSync(candidate).isFile()) return candidate
      } catch {
        // Not here; keep looking.
      }
    }
  }
  return null
}

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

  const bin = resolveBin(provider.bin)
  if (!bin) {
    throw new Error(`Failed to resolve the wallet key: ${provider.install}`)
  }

  let output: string
  try {
    output = execFileSync(bin, provider.args(parsed.ref, project), {
      encoding: 'utf8',
      // The key arrives on stdout; let stderr through so the provider's own
      // diagnostics stay visible, and never inherit stdin — a helper that
      // decides to prompt would hang the CLI (and the MCP server) forever.
      stdio: ['ignore', 'pipe', 'inherit'],
    })
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      throw new Error(`Failed to resolve the wallet key: ${provider.install}`)
    }
    throw new Error(
      `Failed to resolve the wallet key from ${parsed.provider} (${parsed.ref}). ${provider.diagnose}`
    )
  }

  // Scrape rather than trust the whole of stdout: helpers add human framing
  // around the value, and the keystore path takes the same approach with cast.
  const found = output.match(/0x[a-fA-F0-9]{64}/)
  if (!found) {
    throw new Error(
      `${parsed.provider} resolved "${parsed.ref}" but it does not hold a private key (expected 0x + 64 hex). Check the reference points at the right field — the value is not shown here on purpose.`
    )
  }
  return found[0]
}
