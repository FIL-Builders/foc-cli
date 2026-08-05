# Key Injection (external secret managers)

`foc-cli` can hold a **reference** to a key kept in a secret manager instead of the key itself. The reference lives in config; the key is fetched at use time and never written to disk. This is the custody mode to use for agents, MCP, and CI.

## Identify what is configured before doing anything

Most of the time the answer is "already set up, run the command normally". Check first, don't re-wire:

```bash
npx foc-cli wallet balance --json    # `keySource` in the output says which mode is live
```

| `keySource` | What it means | What to do |
|---|---|---|
| `keyRef` | A reference to an external secret manager | Nothing. Run commands normally. |
| `keystore` | Foundry encrypted keystore | Nothing — but it prompts for a password on a terminal, so it cannot work under MCP/CI. See [keystore-setup.md](keystore-setup.md). |
| `privateKey` | Key stored in the config file | Nothing. Works everywhere; the key is at rest. |
| *command fails with* `WALLET_NOT_CONFIGURED` | No wallet configured | Set one up — see below. |

## Set it up once

```bash
npx foc-cli wallet init --keyRef <provider>:<reference>
```

From then on **every command works exactly as it does with a raw key or a keystore** — no wrapper, no prefix, no environment to prepare:

```bash
npx foc-cli wallet balance
npx foc-cli upload ./blob.json
npx foc-cli piece list 42        # <dataSetId> is required
```

The MCP server works too, with the ordinary registration — unlike keystore mode, nothing prompts.

Scope the reference to a specific project when the provider has more than one:

```bash
npx foc-cli wallet init --keyRef clawdi:FILECOIN_PRIVATE_KEY --keyProject engineering
```

Omit `--keyProject` to use the provider's own default. Setting any other wallet method (`--auto`, `--privateKey`, `--keystore`) clears the reference, and vice versa — only one custody mode is ever active.

A configured scope survives re-running the same reference without `--keyProject`; it is cleared only when the reference itself changes, since a scope belongs to the reference it was set for. To unpin deliberately, pass an empty `--keyProject ""` — an empty scope means *absent*, not malformed, and resolves against the provider's own default. The `keyProject` field in the result always reports the scope in effect, not the option that was passed.

**Replacing a configured wallet needs `--force`.** `wallet init` refuses rather than overwrite: on a terminal it asks, and in agent/MCP mode it fails with `WALLET_ALREADY_CONFIGURED` and a CTA repeating the command with `--force` appended. The refusal states what actually happens, which differs by mode — replacing a `privateKey` wallet destroys the only copy of that key, while a keystore file stays on disk and a vault key stays in the vault.

Two things are *not* replacements and are never blocked: re-running the same reference, and adding or changing `--keyProject` on a reference that is already configured (it re-scopes the same lookup). `--keyProject` on its own does that re-scoping without restating the reference; on a wallet that uses no reference it is refused with `KEY_PROJECT_WITHOUT_KEY_REF` rather than silently ignored.

A reference or scope that could never resolve — characters outside the allowed set, a leading `-` the provider's CLI would read as an option, or a value that is itself a private key rather than a reference to one — is refused by `wallet init` itself, before anything is written. Init is the only moment that mistake is cheap to catch.

Configuring a reference before installing the provider is allowed — provisioning often runs in a fixed order. `wallet init` returns `providerAvailable: false` in that case and warns; nothing is at risk until a command signs.

## Providers

| Provider | Reference form | Setup |
|---|---|---|
| `clawdi` | `clawdi:<vault key>` | [integrations/clawdi-vault.md](integrations/clawdi-vault.md) |

The provider list is closed on purpose: the executable is chosen by code and only the reference comes from config, so a tampered config cannot turn key resolution into arbitrary command execution. Adding a provider is a small change to `cli/src/key-ref.ts`.

## What this does and does not protect

**Does:** the key is never in the config file, never in shell history, never in `argv`, never in a repo, and never in an agent's context. It is fetched into memory for the one command that needs it and rotates in one place — the secret manager. Read-only commands (`docs`, `provider list`) never resolve it at all.

**Does not:** isolate the key from other processes running as the same OS user. Anything running as you can invoke the same provider and get the same value. Use a dedicated low-value wallet, stay on Calibration testnet by default, and treat mainnet as a deliberate act.

Each command that touches the wallet costs one resolver call. For a local helper that is negligible; for one that makes a network call it is a round trip per command — noticeable in a long MCP session. There is deliberately no cross-command cache, because a cache is a key at rest.

## When it fails

Errors name the fix and never echo what was resolved — a reference pointing at the wrong field must not print that field's contents.

Wallet-touching commands check the cheap things first — every custody mode, not just this one — so an unusable setup fails as a typed error before anything is resolved:

| Code | Meaning |
|---|---|
| `WALLET_NOT_CONFIGURED` | No wallet at all. The CTA lists the methods that would work here. |
| `MALFORMED_KEY_REF` | A reference is configured but is not `<provider>:<reference>`, or it (or `keyRefProject`) is a value the resolver refuses — characters outside the allowed set, a leading `-` the provider's CLI would read as one of its own options, or a value that is itself a private key rather than a reference to one. The CTA repeats the setup command with `--force` appended. The offending value is never echoed; key-like runs are redacted everywhere a reference is quoted. The usual cause is a private key passed to `--keyRef`. |
| `UNKNOWN_KEY_REF_PROVIDER` | The prefix parses but names no provider this CLI version supports — a typo, or a reference copied from a newer CLI. Permanent, so **not** retryable; the message lists the supported providers. |
| `KEY_REF_PROVIDER_MISSING` | A reference is configured, its provider is recognized, but the helper is not on this process's PATH. Marked `retryable`, and deliberately carries **no** command: the wallet is fine, and the fix (install the helper, or launch from a shell that sees it) is outside foc-cli. Do not "fix" it by re-initializing — that throws the working reference away. |
| `KEYSTORE_INTERACTIVE_ONLY` | A keystore wallet with no terminal to answer its password prompt on — MCP, or a session with no tty at all. A pipe or redirect is not that: `wallet balance --json \| jq` keeps working, because `cast` reads the password from `/dev/tty`. |
| `KEYSTORE_TOOL_MISSING` | A keystore wallet, but Foundry `cast` is not on this process's PATH. Retryable; the keystore file is untouched. |
| `WALLET_ALREADY_CONFIGURED` | `wallet init` would replace the configured wallet. Re-run with `--force`. |
| `INVALID_KEY_REF` / `INVALID_KEY_PROJECT` | From `wallet init` itself, when the value passed could never resolve. It is refused rather than stored, so the previous wallet is left alone. |
| `INVALID_KEY` | A private key that is not `0x` + 64 hex — either passed to `--privateKey`, or already sitting in config (hand-edited, truncated by a partial write, migrated from another tool). Caught by the guard rather than left to throw untyped from inside client construction. |
| `KEY_PROJECT_WITHOUT_KEY_REF` | `--keyProject` on a wallet that uses no key reference. There is nothing for a scope to apply to. |
| `CONFLICTING_INIT_METHODS` | Two or more of `--auto`, `--privateKey`, `--keystore`, `--keyRef` in one call. Only one custody mode can be active, and the command refuses rather than silently picking one — `--keyRef` used to win, so `--auto --keyRef …` minted no key and left the caller signing with the vault key. |

**Ordering:** `wallet init` judges the whole request before it writes anything — conflicting methods, an unusable value, a keystore that cannot work in this context — and only then applies the replacement guard. So an invalid value is reported on its own terms rather than as `WALLET_ALREADY_CONFIGURED`, you are never asked to add `--force` to a command that was going to be refused anyway, and a refused init leaves the config byte-for-byte as it found it (including `--source`).

Resolution failures happen later, at use time — when the key is actually fetched. They are typed too, so an agent gets a code and a `retryable` flag rather than an untyped `UNKNOWN`:

| Code | Cause → fix |
|---|---|
| `KEY_REF_PROVIDER_MISSING` | The provider's CLI is not installed, or not on the PATH of the process running foc-cli (a GUI-launched agent often has a shorter PATH than your shell). **Retryable.** |
| `KEY_REF_RESOLUTION_FAILED` | The provider ran and refused: not logged in, key missing, or wrong project scope. The message lists the checks for that provider. **Not** retryable — each cause needs a deliberate act, so retrying only burns the session. |
| `KEY_REF_TIMED_OUT` | The provider started but did not answer within 30s and was stopped — a hung network call, a captive portal, or a helper waiting on input it will never get (foc-cli gives it no stdin). **Retryable.** Without the bound this was not an error at all: the call is synchronous, so it froze the CLI and the whole MCP server indefinitely. |
| `KEY_REF_NOT_A_KEY` | The reference resolved, but the value is not `0x` + 64 hex standing on its own — it points at the wrong field, or at a field holding a longer blob the key is embedded in. A partial match is never accepted: any 32 bytes form a valid key, so a truncated one would sign as a different address instead of failing. |
| `KEY_REF_AMBIGUOUS` | The field holds more than one key-shaped value, so which one to use is ambiguous. Point the reference at a field holding only the key. |
| `MALFORMED_KEY_REF` / `UNKNOWN_KEY_REF_PROVIDER` | The same conditions the guard checks, reached at use time — normally the guard catches them first. |
| `KEYSTORE_TOOL_MISSING` | Foundry `cast` could not be launched from this process — gone from PATH between the guard and the decrypt, or present but not executable as a process (on Windows, a `cast.cmd` shim Node refuses to launch implicitly). **Retryable.** Distinguished from a wrong password on purpose: a launch failure used to be reported as "Mac Mismatch means the password was wrong" for a wallet that was never opened. |
| `KEYSTORE_DECRYPT_FAILED` | Wrong password ("Mac Mismatch"), or an invalid keystore file. |
| `KEYSTORE_TIMED_OUT` | `cast` ran but did not finish within 30s and was stopped — almost always the password prompt with nobody to answer it. **Retryable.** Keystore mode is interactive-only; use a private-key or key-reference wallet for MCP and automation. |
| `KEYSTORE_NOT_A_KEY` / `KEYSTORE_AMBIGUOUS` | `cast` succeeded but its output held no single key — the same two checks the reference path applies, for the same reason. |

The codes are shared between the guard and use time on purpose: the distinction is an implementation detail, and the fix is identical either way.
