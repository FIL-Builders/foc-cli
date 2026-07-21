<h1 align="center">foc-cli</h1>

<p align="center">
  Store files on Filecoin. From your terminal. Or your AI agent.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/foc-cli"><img src="https://img.shields.io/npm/v/foc-cli?color=0090ff&label=npm" alt="npm version"/></a>
  <a href="https://www.npmjs.com/package/foc-cli"><img src="https://img.shields.io/node/v/foc-cli?color=339933&label=node" alt="node version"/></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0%20OR%20MIT-blue" alt="license"/></a>
</p>

<p align="center">
  <a href="https://docs.filecoin.cloud">Docs</a> &nbsp;&bull;&nbsp;
  <a href="https://skills.sh">Skills.sh</a> &nbsp;&bull;&nbsp;
  <a href="https://clawhub.ai">ClawHub</a> &nbsp;&bull;&nbsp;
  <a href="https://github.com/FIL-Builders/foc-cli">GitHub</a>
</p>

---

**foc-cli** is a command-line interface and AI agent skill for [Filecoin Onchain Cloud](https://docs.filecoin.cloud) (FOC) — decentralized warm storage on Filecoin with cryptographic proof your data is held (PDP), paid in USDFC stablecoin. Upload, download (with built-in cryptographic verification), and pay for storage from a terminal, a script, or an agent via MCP.

## Quick Start

```bash
npx foc-cli wallet init --auto        # 1. Create a wallet
npx foc-cli wallet fund               # 2. Get testnet tokens
npx foc-cli wallet costs --extraBytes 1000000 --extraRunway 1   # 3. Estimate cost
npx foc-cli wallet deposit 1          # 4. Deposit 1 USDFC for storage
npx foc-cli upload ./myfile.pdf       # 5. Upload a file
npx foc-cli download <pieceCid>       # 6. Prove it's retrievable (pieceCid from upload output)
```

A successful `download` is cryptographic proof your file is stored and intact — the SDK validates the bytes against the piece CID.

## Install

```bash
npm install -g foc-cli                    # CLI
npx skills add FIL-Builders/foc-cli       # Agent skills via skills.sh (Claude Code, Cursor, Copilot, 20+ tools)
clawhub install foc-cli && clawhub install foc-docs   # Agent skills via ClawHub (OpenClaw)
npx foc-cli mcp add                       # MCP server (auto-detects your agent)
```

## Commands

Every command supports `-h` for usage and `--schema --format json` for its JSON Schema. Flags are camelCase as documented (`--withCDN`); help shows kebab-case equivalents — both work. Boolean flags are presence-only switches (use `--flag=false` for an explicit value).

| Group | Commands | Notes |
|-------|----------|-------|
| Upload | `upload <path>` · `multi-upload <a,b>` | Auto provider/dataset. `--copies N`, `--withCDN` |
| Download | `download <pieceCid> [--out <path>]` | Bytes validated against the CID — retrieval is the verification |
| Wallet | `wallet init` · `balance` · `fund` · `deposit` · `withdraw` · `summary` · `costs` | `fund` = testnet faucet. `costs` = live pricing (source of truth) |
| Datasets | `dataset list` · `details` · `create` · `terminate` | `details` paginates pieces with next-page + fetch-all CTAs |
| Pieces | `piece list <id>` · `piece remove <id> <pieceId>` | Paginated with next-page + fetch-all CTAs |
| Providers | `provider list` | Approved PDP providers with location, pricing, performance |
| Docs | `docs --prompt "upload"` · `docs --url developer-guides/synapse.md` | Searches/fetches `docs.filecoin.cloud` only |

**Global options:** `--chain <id>` (`314159` testnet default, `314` mainnet) · `--format toon|json|yaml|md` · `--json` · `--debug`

## Wallet & Keys

`wallet init --auto` for quick start, testnet, and automation. Use an encrypted [Foundry keystore](skills/foc-cli/references/keystore-setup.md) (`--keystore <path>`) when the wallet will hold real funds. A `--privateKey` flag exists for non-interactive setups — avoid it: raw keys in arguments leak into shell history and logs. Keep a dedicated wallet holding only what foc-cli needs.

## Chains & Funding

All commands default to **Calibration testnet**; add `--chain 314` for mainnet. Testnet tokens are one command (`wallet fund`). Mainnet needs real FIL for gas and USDFC for storage — see the [funding guide](skills/foc-cli/references/mainnet-funding.md).

**Pricing:** billed per copy per month by size (default 2 copies) plus a flat per-data-set monthly fee. `wallet costs` is the source of truth.

## Agent Skills

| Skill | Purpose |
|-------|---------|
| [**foc-cli**](skills/foc-cli/SKILL.md) | Operations — setup, upload, download, wallets, datasets, pieces, providers |
| [**foc-docs**](skills/foc-docs/SKILL.md) | Documentation — search guides, SDK refs, concept explainers |

Built with [incur](https://github.com/wevm/incur) for first-class agent support:

- **MCP server** — every command as an MCP tool (`npx foc-cli --mcp`)
- **Structured output** — `--json`, `--format yaml`, `--filter-output`
- **Introspection** — `--schema` per command, `--llms` manifest
- **TTY-aware** — interactive prompts for humans, structured output for agents
- **Source tag** — `wallet init --source my-app` sets the attribution tag reported to Synapse (default `foc-cli`)

## How FOC Works

| Layer | What it does |
|-------|-------------|
| **Storage** | Warm, retrievable files via FWSS (Filecoin Warm Storage Service) |
| **Verification** | PDP — cryptographic proof providers hold your data |
| **Settlement** | Filecoin Pay — continuous USDFC payment streams to providers |
| **Developer** | Synapse SDK + this CLI |

## References

[FOC Documentation](https://docs.filecoin.cloud) · [LLM-friendly docs](https://docs.filecoin.cloud/llms.txt) · [Synapse SDK](https://github.com/FilOzone/synapse-sdk) · [PDP Overview](https://docs.filecoin.cloud/core-concepts/pdp-overview/) · [Filecoin Pay](https://docs.filecoin.cloud/core-concepts/filecoin-pay-overview/)

## License

Apache-2.0 OR MIT
