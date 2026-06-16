---
name: foc-docs
description: Search and fetch Filecoin Onchain Cloud documentation with `npx foc-cli docs`. Use when the user wants to look up or understand FOC / Synapse SDK reference material — storage and payment guides, PDP concepts, session keys, React hooks, API signatures, or "how does X work" questions — rather than execute a storage operation. Reach for this whenever the user asks how something in FOC/Synapse works, needs an API signature or doc link, or is researching before building. Triggers on "foc docs", "filecoin cloud docs", "synapse docs", "how does ... work", "how to", "guide", "reference", "API". To actually run commands (upload, wallet, dataset, piece), use the foc-cli skill instead.
---

# foc-docs — Documentation Search

Fast, filtered access to **Filecoin Onchain Cloud** docs via `npx foc-cli docs`.

## How It Works

Builds a curated, depth-filtered index live from the docs site's `llms.txt` (dropping the bulk of deep API-reference entries), then ranks it against your `--prompt`. When the search narrows to 1-3 matches it **auto-fetches** the top result in the same call — so a good prompt usually answers the question in one round-trip instead of guessing URLs.

## Command

```bash
npx foc-cli docs [--prompt <text>] [--url <url>] [--maxDepth <n>]
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
npx foc-cli docs --prompt "upload files"       # auto-fetches Storage Operations
npx foc-cli docs --prompt "payments"           # auto-fetches Payment Operations
npx foc-cli docs --prompt "PDP"               # auto-fetches PDP Overview
```

**Fetch a specific page:**

```bash
npx foc-cli docs --url https://docs.filecoin.cloud/developer-guides/storage/storage-operations.md
npx foc-cli docs --url <url> --maxDepth 6      # full detail
npx foc-cli docs --url <url> --maxDepth 2      # high-level only
```

## Doc Map

Common entry points — handy shortcuts, not an exhaustive list. The docs evolve, so if a prompt below returns nothing, fall back to a plain `--prompt` search (the live index is the source of truth).

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

Available as `mcp__foc-cli__docs` with options: `prompt`, `url`, `maxDepth`, `debug`.

## Tips

- Start with `--prompt` — usually gets the answer in 1 call
- Use CTA suggestions in results to navigate related pages
- Re-fetch with `--maxDepth 6` for API reference details
