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
npx foc-cli piece list
```

The MCP server works too, with the ordinary registration — unlike keystore mode, nothing prompts.

Scope the reference to a specific project when the provider has more than one:

```bash
npx foc-cli wallet init --keyRef clawdi:FILECOIN_PRIVATE_KEY --keyProject engineering
```

Omit `--keyProject` to use the provider's own default. Setting any other wallet method (`--auto`, `--privateKey`, `--keystore`) clears the reference, and vice versa — only one custody mode is ever active.

**Replacing a configured wallet needs `--force`.** `wallet init` refuses rather than overwrite: on a terminal it asks, and in agent/MCP mode it fails with `WALLET_ALREADY_CONFIGURED` and a CTA repeating the command with `force: true`. The refusal states what actually happens, which differs by mode — replacing a `privateKey` wallet destroys the only copy of that key, while a keystore file stays on disk and a vault key stays in the vault.

Two things are *not* replacements and are never blocked: re-running the same reference, and adding or changing `--keyProject` on a reference that is already configured (it re-scopes the same lookup).

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
| `MALFORMED_KEY_REF` | A reference is configured but is not `<provider>:<reference>`. The CTA repeats the setup command with `force: true`. |
| `KEY_REF_PROVIDER_MISSING` | A reference is configured but its provider is not on this process's PATH. Marked `retryable`, and deliberately carries **no** command: the wallet is fine, and the fix (install the helper, or launch from a shell that sees it) is outside foc-cli. Do not "fix" it by re-initializing — that throws the working reference away. |
| `KEYSTORE_INTERACTIVE_ONLY` | A keystore wallet under MCP/automation, where its password prompt can never be answered. |
| `KEYSTORE_TOOL_MISSING` | A keystore wallet, but Foundry `cast` is not on this process's PATH. Retryable; the keystore file is untouched. |
| `WALLET_ALREADY_CONFIGURED` | `wallet init` would replace the configured wallet. Re-run with `--force`. |

Resolution failures happen later, at use time:

| Message | Cause → fix |
|---|---|
| `... is not on PATH` | The provider's CLI is not installed, or not on the PATH of the process running foc-cli (a GUI-launched agent often has a shorter PATH than your shell). |
| `Failed to resolve the wallet key from <provider>` | The provider ran and refused: not logged in, key missing, or wrong project scope. The message lists the checks for that provider. |
| `... does not hold a private key` | The reference resolved, but the value is not `0x` + 64 hex standing on its own — it points at the wrong field, or at a field holding a longer blob the key is embedded in. A partial match is never accepted: any 32 bytes form a valid key, so a truncated one would sign as a different address instead of failing. |
| `... to output containing N different 0x + 64 hex values` | The field holds more than one key-shaped value, so which one to use is ambiguous. Point the reference at a field holding only the key. |
| `Malformed key reference in config` | Not `<provider>:<reference>`. Normally caught earlier as `MALFORMED_KEY_REF`. |
| `Malformed key reference/project in config` | The reference or `--keyProject` contains characters outside `A-Za-z0-9`, space, and `@ _ . : / -`. Everything here reaches a child process's argv — and on Windows, a shell — so the set is restricted on purpose. |
| `Unknown key-reference provider` | Typo, or a provider this CLI version does not support. |
