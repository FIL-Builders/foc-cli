---
name: foc-docs
description: Search and fetch Filecoin Onchain Cloud documentation. Use when looking up Synapse SDK APIs, storage guides, payment operations, PDP concepts, or any FOC reference material. Triggers on "docs", "documentation", "how to", "guide", "reference", "API", "Synapse SDK docs".
---

# foc-docs — Documentation Search

Fast, filtered access to **Filecoin Onchain Cloud** docs via `npx foc-skill docs`.

## How It Works

Searches a curated index of ~28 doc pages (from 1300+ raw entries). When your search narrows to 1-3 matches, it **auto-fetches** the top result in a single call.

## Command

```bash
npx foc-skill docs [--prompt <text>] [--url <url>] [--maxDepth <n>]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--prompt` | `string` | | Search the docs index. Auto-fetches if 1-3 matches. |
| `--url` | `string` | | Fetch a specific doc page URL |
| `--maxDepth` | `number` | `4` | Header depth: `6` = full detail, `2` = overview only |
| `--debug` | `boolean` | | Debug mode |

### Output

| Field | Type | Description |
|-------|------|-------------|
| `source` | `string` | URL of fetched content |
| `content` | `string` | Filtered markdown |
| `matchedEntries` | `array` | Matched entries (title, url, description, section) |

## Usage

**Search first** (recommended) — then drill into specific pages:

```bash
npx foc-skill docs --prompt "upload files"       # auto-fetches Storage Operations
npx foc-skill docs --prompt "payments"           # auto-fetches Payment Operations
npx foc-skill docs --prompt "PDP"               # auto-fetches PDP Overview
```

**Fetch a specific page:**

```bash
npx foc-skill docs --url https://docs.filecoin.cloud/developer-guides/storage/storage-operations.md
npx foc-skill docs --url <url> --maxDepth 6      # full detail
npx foc-skill docs --url <url> --maxDepth 2      # high-level only
```

## Doc Map

| Topic | Prompt | URL (relative to `docs.filecoin.cloud/developer-guides/`) |
|-------|--------|-----------------------------------------------------------|
| Upload files | `"upload"` | `storage/storage-operations.md` |
| Split upload | `"split operations"` | `storage/storage-context.md` |
| Storage costs | `"costs"` | `storage/storage-costs.md` |
| Payments | `"payments"` | `payments/payment-operations.md` |
| Payment rails | `"rails"` | `payments/rails-settlement.md` |
| Session keys | `"session keys"` | `session-keys.md` |
| Quick start | `"getting started"` | `getting-started.md` |
| Architecture | `"architecture"` | `core-concepts/architecture.md` |
| PDP proofs | `"PDP"` | `core-concepts/pdp-overview.md` |
| React hooks | `"react"` | `react-integration.md` |
| Synapse Core | `"synapse core"` | `synapse-core.md` |
| Devnet | `"devnet"` | `devnet.md` |

## MCP Tool

Available as `mcp__foc-skill__docs` with options: `prompt`, `url`, `maxDepth`, `debug`.

## Tips

- Start with `--prompt` — usually gets the answer in 1 call
- Use CTA suggestions in results to navigate related pages
- Re-fetch with `--maxDepth 6` for API reference details
