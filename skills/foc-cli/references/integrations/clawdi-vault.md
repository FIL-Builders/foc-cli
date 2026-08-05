# Clawdi vault

Hold the wallet key in a [Clawdi](https://clawdi.ai) vault and give `foc-cli` only a reference to it. See [../key-injection.md](../key-injection.md) for the general mechanism; this covers the Clawdi-specific parts.

## Setup

```bash
# 1. Once per account, by a human — never an agent. --prompt reads with no echo
#    and no shell history. Use a DEDICATED low-value wallet, not a main one.
clawdi vault set FILECOIN_PRIVATE_KEY --prompt

# 2. Make the vault available to the project this machine resolves against
#    (safe to re-run; "already available" is fine):
clawdi vault attach default --project <project>

# 3. Point foc-cli at it:
npx foc-cli wallet init --keyRef clawdi:FILECOIN_PRIVATE_KEY
```

That is the whole setup. Every command afterwards is ordinary `foc-cli` usage.

## Verify without exposing anything

```bash
clawdi vault resolve FILECOIN_PRIVATE_KEY --dry-run   # confirms it resolves, prints no value
npx foc-cli wallet balance --json                      # keySource: "keyRef", plus the address it derived
```

The address is the real proof: it is derived from whatever key actually signed. If it matches the wallet you funded, the chain works end to end.

## Project scope is the thing that bites

References resolve **per project**. `clawdi vault resolve` uses your default-write project unless told otherwise, so a setup that works on one machine can silently resolve elsewhere — or not at all — on another.

```bash
clawdi vault list --json          # see which projects hold the key
npx foc-cli wallet init --keyRef clawdi:FILECOIN_PRIVATE_KEY --keyProject engineering
```

Pin `--keyProject` whenever the account has more than one project. Adding or changing it on a reference that is already configured is not a replacement — it re-scopes the same lookup — so it needs no `--force`. Never copy a config between machines expecting the reference to mean the same thing.

Once pinned it stays pinned: re-running the same reference without `--keyProject` keeps the scope, and only a change of reference clears it. This matters because an unpinned lookup silently falls back to the account's default project, which can hold a *different* key — and therefore sign from a different address — with nothing on screen to say so. Pass `--keyProject ""` to unpin on purpose.

Nested key paths work as Clawdi writes them — `clawdi:vault/FILECOIN_PRIVATE_KEY`, `clawdi:vault/section/FILECOIN_PRIVATE_KEY`. Only the first colon separates the provider from the reference.

## Rotation

```bash
clawdi vault set FILECOIN_PRIVATE_KEY --prompt   # rotate in place
```

Nothing in foc-cli changes — the reference still points at the same field, and the next command picks up the new value. Long-lived processes that already hold a resolved key in memory (an MCP server mid-session) need a restart.

```bash
clawdi vault rm FILECOIN_PRIVATE_KEY             # remove, account-wide
```

## Troubleshooting

| Symptom | Cause → fix |
|---|---|
| `the clawdi CLI is not on PATH` | Not installed (`npm install -g clawdi`), or the agent process has a shorter PATH than your shell. |
| `Failed to resolve the wallet key from clawdi` | Not authenticated — check with `clawdi auth status --json` and read the `authenticated` **field**, since the exit code is 0 either way. Or the vault is not attached to the project being resolved against (`clawdi vault attach default --project <project>`). |
| `does not hold a private key` | The reference resolved to something that is not `0x` + 64 hex — wrong field name. |
| Works in your shell, fails under an agent or MCP | Different PATH or a different default project for that process. Surfaces as `KEY_REF_PROVIDER_MISSING` (retryable). Start the process from a shell that resolves `clawdi`, and pin `--keyProject`. Do **not** run `wallet init --auto --force` — that replaces the vault-backed wallet with a throwaway testnet key and does not fix the PATH. |
| Everything fails on Windows despite `clawdi` being installed | `npm install -g clawdi` writes `clawdi.cmd`, a script rather than an executable, so it has to be launched through `cmd.exe`. Handled — but if you are on a build that predates this, the symptom is the "not logged in / wrong project" diagnosis appearing for a login that is perfectly fine. |

## Safety

Calibration testnet (314159) is the default. Mainnet (`--chain 314`) and any fund-moving operation need explicit human confirmation and should never be chained autonomously. Never pass `--privateKey` in argv — it is visible in `ps` for the lifetime of the process. The `clawdi://`-style reference is safe to display; the value it resolves to never is.
