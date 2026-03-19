<p align="center">
  <strong>foc-skill</strong>
  <br/>
  Store files on Filecoin. From your terminal. Or your AI agent.
</p>

<p align="center">
  <a href="https://docs.filecoin.cloud">Docs</a> &nbsp;&bull;&nbsp;
  <a href="https://skills.sh">Skills.sh</a> &nbsp;&bull;&nbsp;
  <a href="https://github.com/FIL-Builders/foc-skill">GitHub</a>
</p>

---

**foc-skill** is a CLI and AI agent skill for [Filecoin Onchain Cloud](https://docs.filecoin.cloud) (FOC) — decentralized warm storage with cryptographic proof your data is held, paid with USDFC stablecoin on Filecoin.

**Why FOC?** Traditional cloud storage requires trusting a provider. FOC gives you onchain verification (PDP proofs), programmable payments, and redundant copies across independent storage providers — all through a simple CLI or AI agent skill.

## Install

**As a CLI:**

```bash
npm install -g foc-skill
```

**As an AI Agent Skill** via [skills.sh](https://skills.sh) — works with Claude Code, Cursor, Copilot, Codex, Windsurf, and 20+ AI tools:

```bash
# Install all skills (CLI + docs)
npx skills add FIL-Builders/foc-skill

# Or install individually
npx skills add FIL-Builders/foc-skill --skill foc-skill  # CLI & operations
npx skills add FIL-Builders/foc-skill --skill foc-docs   # Documentation search
```

**As an MCP server** for direct tool access:

```bash
npx foc-skill mcp add                       # Auto-detect your agent
npx foc-skill mcp add --agent claude-code   # Specific agent
```

## Quick Start

```bash
npx foc-skill wallet init --auto        # 1. Create a wallet
npx foc-skill wallet fund               # 2. Get testnet tokens
npx foc-skill wallet deposit 1          # 3. Deposit 1 USDFC for storage
npx foc-skill upload ./myfile.pdf       # 4. Upload a file
```

That's it. Your file is now stored on Filecoin with PDP verification and redundant copies.

## Skills

This package ships two focused skills for AI agents:

| Skill | Purpose | When to use |
|-------|---------|-------------|
| **foc-skill** | CLI & Operations | Setup, upload, wallets, datasets, pieces, providers — everything operational. |
| **foc-docs** | Documentation | Search guides, SDK refs, concept explainers. |

## Commands

Every command supports `-h` for full usage details.

### Upload

```bash
npx foc-skill upload <path>                        # Upload with auto provider/dataset
npx foc-skill upload <path> --withCDN --copies 3   # CDN + 3 redundant copies
npx foc-skill multi-upload ./a.pdf,./b.pdf         # Batch upload
```

### Wallet

```bash
npx foc-skill wallet init [--auto|--keystore <path>|--privateKey <key>]
npx foc-skill wallet balance             # Check FIL & USDFC balances
npx foc-skill wallet fund                # Testnet faucet
npx foc-skill wallet deposit <amount>    # Deposit USDFC for storage
npx foc-skill wallet withdraw <amount>   # Withdraw USDFC
npx foc-skill wallet summary             # Funding timeline & rates
npx foc-skill wallet costs --extraBytes <n> --extraRunway <months>
```

### Datasets

```bash
npx foc-skill dataset list                          # List all datasets
npx foc-skill dataset details -d <id>               # Metadata + pieces
npx foc-skill dataset create [providerId] [--cdn]   # Create dataset
npx foc-skill dataset upload <path> <providerId>    # Create + upload
npx foc-skill dataset terminate <dataSetId>         # Terminate dataset
```

### Pieces & Providers

```bash
npx foc-skill piece list <dataSetId>                # List pieces in dataset
npx foc-skill piece remove <dataSetId> <pieceId>    # Remove piece
npx foc-skill provider list                         # Approved PDP providers
```

### Docs

```bash
npx foc-skill docs                                  # Browse docs index
npx foc-skill docs --prompt "upload files"          # Search by topic
npx foc-skill docs --url <url>                      # Fetch specific page
```

### Global Options

| Option | Default | Description |
|--------|---------|-------------|
| `--chain <id>` / `-c` | `314159` | Chain ID (`314159` = testnet, `314` = mainnet) |
| `--debug` | `false` | Verbose error logging |
| `--format <fmt>` | `toon` | Output format: `toon`, `json`, `yaml`, `md` |
| `--json` | | Shorthand for `--format json` |

## How FOC Works

FOC transforms Filecoin into a **programmable cloud storage layer**:

| Layer | What it does |
|-------|-------------|
| **Storage** | Warm, retrievable files via FWSS (Filecoin Warm Storage Service) |
| **Verification** | PDP (Proof of Data Possession) — cryptographic proof providers hold your data |
| **Settlement** | Filecoin Pay — continuous USDFC payment streams to providers |
| **Developer** | Synapse SDK + this CLI — TypeScript APIs for storage, payments, retrieval |

**Pricing:** $2.5/TiB/month per copy (minimum 2 copies). Minimum spend: 0.06 USDFC/month (~24 GiB).

## Agent Features

Built with [incur](https://github.com/wevm/incur) for first-class AI agent support:

- **MCP Server** — all commands as MCP tools (`npx foc-skill --mcp`)
- **Structured Output** — `--json`, `--format yaml`, `--token-count`
- **Schema Introspection** — `npx foc-skill <cmd> --schema` for JSON Schema
- **LLM Manifest** — `npx foc-skill --llms` for machine-readable docs
- **TTY Awareness** — interactive prompts for humans, structured output for agents

## Mainnet

All commands default to **Calibration testnet**. Add `--chain 314` for mainnet:

```bash
npx foc-skill upload ./data.bin --chain 314
```

## References

- [FOC Documentation](https://docs.filecoin.cloud)
- [LLM-friendly docs](https://docs.filecoin.cloud/llms.txt)
- [Synapse SDK](https://github.com/FilOzone/synapse-sdk)
- [PDP Overview](https://docs.filecoin.cloud/core-concepts/pdp-overview/)
- [Filecoin Pay](https://docs.filecoin.cloud/core-concepts/filecoin-pay-overview/)

## License

Apache-2.0 OR MIT
