---
name: foc-cli
description: Use when working with Filecoin Onchain Cloud, the foc-cli CLI, Synapse SDK, storing files on Filecoin, PDP datasets, USDFC payments, or any decentralized cloud storage task on Filecoin. Triggers on "foc", "filecoin cloud", "synapse", "warm storage", "PDP", "USDFC", "foc-cli", "upload", "store", "wallet", "deposit", "dataset", "piece", "provider".
---

# foc-cli — Filecoin Onchain Cloud CLI

Store, verify, and pay for data on Filecoin's programmable cloud.

> For documentation lookups, use the **foc-docs** skill instead.

## What is FOC?

FOC turns Filecoin into a **programmable cloud** with four layers:

| Layer | Component | Purpose |
|-------|-----------|---------|
| Storage | Warm Storage Service (FWSS) | Fast, retrievable, PDP-verified storage |
| Verification | Proof of Data Possession (PDP) | Cryptographic proof providers hold your data |
| Settlement | Filecoin Pay | Programmable onchain USDFC payments |
| Developer | Synapse SDK | TypeScript APIs for storage, payments, retrieval |

**Data model:** Files → **Pieces** (by CID) → grouped into **Data Sets** on PDP providers → funded by **Payment Rails** (continuous USDFC streams).

**Pricing:** $2.5/TiB/month/copy (min 2 copies), minimum 0.06 USDFC/month (~24 GiB).

## Setup

```bash
npx foc-cli wallet init --auto   # generate wallet (or --keystore <path>, --privateKey <key>)
```

Config: `~/Library/Preferences/foc-cli/config.json` (macOS). Keys: `privateKey`, `keystore`.

## Self-Documenting

Every command supports `-h` for full usage, args, options, and examples:

```bash
npx foc-cli --help             # all commands
npx foc-cli upload -h          # upload args/options/examples
npx foc-cli wallet deposit -h  # deposit args/options
```

**Always use `-h` first** to discover the exact interface before running a command.

## Global Options

All commands accept these — not repeated per-command below:

| Option | Default | Description |
|--------|---------|-------------|
| `--chain <id>` / `-c` | `314159` | `314159` = Calibration testnet, `314` = Mainnet |
| `--debug` | `false` | Verbose error logging with stack traces |
| `--format <fmt>` | `toon` | Output: `toon`, `json`, `yaml`, `md` |
| `--json` | | Shorthand for `--format json` |
| `-h` / `--help` | | Show help for any command |

## Commands

### Upload (recommended)

| Command | Description |
|---------|-------------|
| `upload <path> [--copies N] [--withCDN]` | Upload file. Auto-selects provider, creates dataset. Default 2 copies. |
| `multi-upload <paths> [--copies N] [--withCDN]` | Batch upload. Comma-separated paths. |

```bash
npx foc-cli upload ./file.pdf                     # simplest
npx foc-cli upload ./file.pdf --withCDN --copies 3
npx foc-cli multi-upload ./a.pdf,./b.pdf
```

### Wallet & Payments

| Command | Description |
|---------|-------------|
| `wallet init [--auto\|--keystore <path>\|--privateKey <key>]` | Initialize wallet |
| `wallet balance` | FIL/USDFC balances + payment account info |
| `wallet fund` | Testnet faucet (FIL + USDFC) |
| `wallet deposit <amount>` | Deposit USDFC into payment account |
| `wallet withdraw <amount>` | Withdraw USDFC from payment account |
| `wallet summary` | Account summary with funding timeline |
| `wallet costs --extraBytes N --extraRunway N` | Calculate upload costs + deposit needed |

### Dataset Management

| Command | Description |
|---------|-------------|
| `dataset list` | All datasets with provider, CDN status, state |
| `dataset details -d <id>` | Dataset metadata + all pieces |
| `dataset create <providerId> [--cdn]` | Create dataset with a provider from `provider list` |
| `dataset upload <path> <providerId> [--cdn]` | Create dataset + upload in one step |
| `dataset terminate <dataSetId>` | Stop PDP service for a dataset |

### Piece Management

| Command | Description |
|---------|-------------|
| `piece list <dataSetId>` | Pieces in dataset with CID + metadata |
| `piece remove <dataSetId> <pieceId>` | Remove piece from dataset |

### Provider Info

| Command | Description |
|---------|-------------|
| `provider list` | Approved PDP providers with location, pricing, performance |

## Workflows

### First-time setup (testnet)

```bash
npx foc-cli wallet init --auto
npx foc-cli wallet fund
npx foc-cli wallet deposit 1
npx foc-cli wallet balance
```

### Upload files

```bash
npx foc-cli upload ./myfile.pdf                          # auto everything
npx foc-cli upload ./myfile.pdf --withCDN                # with CDN
npx foc-cli multi-upload ./a.pdf,./b.pdf --copies 3      # batch, 3 copies
npx foc-cli wallet costs --extraBytes 1000000 --extraRunway 1  # check costs first
```

### Manage data

```bash
npx foc-cli dataset list
npx foc-cli dataset details -d 42
npx foc-cli piece list 42
npx foc-cli piece remove 42 7
npx foc-cli dataset terminate 42
```

### Agent / programmatic

```bash
npx foc-cli wallet balance --json
npx foc-cli dataset list --filter-output datasets.dataSetId
npx foc-cli upload --schema                # full command schema
```

## MCP Integration

```bash
npx foc-cli mcp add                    # auto-detect agent
npx foc-cli mcp add --agent claude-code
npx foc-cli --mcp                      # start MCP server (stdio)
```

Tools use underscores: `wallet_init`, `wallet_balance`, `dataset_list`, `upload`, etc.

## Architecture

- **Synapse SDK** — high-level storage + payment operations
- **Synapse Core** — low-level chain interactions
- **viem** — wallet/public clients for Filecoin
- **incur** — CLI framework with MCP, structured output, agent discovery
- Interactive prompts auto-skipped in agent/pipe mode
- All transactions show block explorer links and wait for confirmation

## References

- [FOC Docs](https://docs.filecoin.cloud) · [LLM-friendly index](https://docs.filecoin.cloud/llms.txt)
- [Synapse SDK](https://github.com/FilOzone/synapse-sdk)
- [Architecture](https://docs.filecoin.cloud/core-concepts/architecture/) · [PDP](https://docs.filecoin.cloud/core-concepts/pdp-overview/) · [Filecoin Pay](https://docs.filecoin.cloud/core-concepts/filecoin-pay-overview/)
