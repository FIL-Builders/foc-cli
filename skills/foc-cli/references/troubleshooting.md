# Troubleshooting: Error Codes, Causes, and Recovery

How foc-cli reports failures: every command returns a structured error envelope with a `code`, a human `message`, and sometimes `retryable: true` and a `cta` (suggested next commands). The `message` usually carries the underlying Synapse SDK / RPC error text — the patterns in the second table decode those. Re-run any failing command with `--debug` for a full stack trace.

**Retry semantics:** `retryable: true` means the same call may succeed if repeated (network/provider hiccups) — retry with backoff (e.g. 2s, 10s, 30s; give up after ~3 attempts). Errors without the flag are usually input, state, or funding problems: fix the cause instead of retrying. Never blind-retry fund-moving commands (`deposit`, `withdraw`, `upload`) — re-check state with `wallet balance` / `dataset list` first so a slow-but-successful transaction isn't repeated.

## First checks — the causes behind most failures

1. **No wallet configured** — message contains `Private key not found`. Run `wallet init` (see Setup in SKILL.md).
2. **Wrong chain** — datasets, pieces, and balances are per-chain. A dataset created on Calibration (default) does not exist with `--chain 314`, and vice versa. `*_NOT_FOUND` errors are frequently just a missing/wrong `--chain` flag.
3. **Not enough FIL (gas) or USDFC (storage)** — any transaction can fail on either. `wallet balance` shows both; `wallet costs` shows what an upload needs.
4. **Provider or RPC hiccup** — storage providers and public RPC endpoints have transient outages. These read as network-ish messages (timeouts, `HTTP 5xx`, `fetch failed`) and generally deserve one retry.

## Error codes by command area

| Code | Command(s) | Likely causes | Retry? |
|------|-----------|---------------|--------|
| `INIT_METHOD_REQUIRED` | `wallet init` (agent mode) | No init method given non-interactively | With `--auto` or `--privateKey` (keystore mode is interactive-only) |
| `KEYSTORE_INTERACTIVE_ONLY` | `wallet init --keystore` (agent mode) | Keystore mode cannot work under MCP/automation — `cast` prompts for the password on the terminal at use time | No — use `--auto` or `--privateKey` |
| `KEYSTORE_NOT_FOUND` | `wallet init --keystore` | Wrong path. Note: `cast wallet new` names files with a random UUID, not the name you expect (see keystore-setup.md) | No — fix the path |
| `KEYSTORE_INVALID` | `wallet init --keystore` | Path is a directory or other non-regular file, or the file is not an encrypted keystore (no `crypto` object / not JSON). Pass the keystore *file* itself | No — fix the path or create a keystore (keystore-setup.md) |
| `INVALID_KEY` | `wallet init --privateKey` | Not 0x-prefixed 64-char hex | No — fix the key format |
| `ADDRESS_NOT_ON_CHAIN` | `wallet balance` | Brand-new address with no onchain history yet — every balance is zero | No — fund the address first (`wallet fund` on testnet) |
| `BALANCE_FETCH_FAILED` | `wallet balance` | RPC hiccup; no wallet configured | Once, if message looks network-y |
| `FUND_FAILED` | `wallet fund` | Faucet rate-limit or temporarily empty (testnet-only command); RPC hiccup | Later — faucets throttle per-address |
| `DEPOSIT_FAILED` | `wallet deposit` | Insufficient USDFC in wallet; no FIL for gas; RPC/tx failure | Only after fixing funds |
| `WITHDRAW_FAILED` | `wallet withdraw` | Commonly: amount exceeds *available* (unlocked) funds — active payment rails lock part of the deposit (`wallet summary` shows it). Also gas or RPC failures — read the message | Only after checking `wallet summary` |
| `COSTS_FAILED`, `SUMMARY_FAILED` | `wallet costs` / `summary` | RPC hiccup; no wallet | Once |
| `UPLOAD_FAILED` | `upload`, `multi-upload` | Catch-all: see message patterns below — funding, provider health, file, or size problems | Depends on message |
| `NOT_A_FILE` | `upload` | Path is a directory or other non-regular file (checked before any onchain spend) | No — pass a regular file |
| `FILE_READ_FAILED` | `multi-upload` | One or more paths unreadable or not regular files (the command refuses partial batches) | No — fix the paths |
| `PRIMARY_STORE_FAILED` | `multi-upload` | Primary provider rejected/failed the piece POST | Yes — provider-side, often transient |
| `PULL_TO_SECONDARY_FAILED` | `multi-upload` | A secondary provider could not pull the piece from the primary | Yes — often transient |
| `COMMIT_TO_CONTEXTS_FAILED` | `multi-upload` | Onchain add-pieces transaction failed (gas, nonce, RPC) | Once — then check the explorer link |
| `INVALID_PIECE_CID` | `download` | Malformed CID (not a `baga…` piece CID) | No — fix the CID |
| `INTEGRITY_MISMATCH` | `download` | Bytes arrived but do NOT hash to the expected piece CID — the source served wrong/corrupt data | **No** — retrying the same source cannot help; follow the CTA (toggle `--withCDN` or pick a provider) and treat repeated mismatches as a provider problem worth reporting |
| `PROVIDER_NOT_FOUND` | `download --providerAddress` | The given provider address is not registered | No — pick from `provider list` |
| `FILE_EXISTS` | `download` | Output path already exists — downloads never overwrite by default | No — pass `--force` to overwrite, or a different `--out` |
| `WRITE_FAILED` | `download` | Piece downloaded and validated, but the local write failed (`--out` directory missing, permissions, disk full) | No — fix the output path; the retrieval itself succeeded |
| `DOWNLOAD_FAILED` | `download` | Transient retrieval failure: provider down, CDN miss, piece very recently uploaded, or piece lives on the other chain | Yes (flagged) — also re-check `--chain` |
| `DATASET_NOT_FOUND`, `NOT_FOUND` | `dataset details`, `piece list/remove` | Wrong id — or right id, wrong `--chain` | No — verify with `dataset list` on both chains |
| `PROVIDER_REQUIRED` | `dataset create` (agent mode) | Missing providerId argument | With a providerId from `provider list` |
| `DATASET_CREATE_FAILED` | `dataset create` | Funding (dataset creation starts a paid rail), gas, provider or RPC failure | Depends on message |
| `DATASET_TERMINATE_FAILED` | `dataset terminate` | Already terminated / termination pending; not the dataset owner; gas | No for state errors; once for RPC |
| `PIECE_REMOVE_FAILED` | `piece remove` | Wrong pieceId; deletion already scheduled; gas/RPC | Check `piece list` first |
| `DATASET_LIST_FAILED`, `PIECE_LIST_FAILED`, `DATASET_DETAILS_FAILED`, `PROVIDER_LIST_FAILED` | reads | RPC hiccup; no wallet configured | Once |
| `INVALID_DOCS_URL` | `docs --url` | URL not on `docs.filecoin.cloud` | No — use a docs URL/path |
| `FETCH_FAILED`, `DOCS_FETCH_FAILED` | `docs` | Network failure or docs page 404 | Yes (flagged) |
| `HTML_RESPONSE` | `docs --url` | Page has no markdown mirror (e.g. site root) | No — search with `--prompt` instead |

## Decoding the message: underlying error patterns

The generic `*_FAILED` codes carry the real cause in `message`. Patterns to match on:

| Message contains | Meaning | Fix |
|------------------|---------|-----|
| `Private key not found` | No wallet configured | `wallet init --auto` (or keystore) |
| `Failed to access keystore` | `cast` not installed (the message says so explicitly), wrong password (`Mac Mismatch` printed above the error), or no tty for the password prompt (keystore mode is interactive-only — it cannot work under MCP/CI) | Install Foundry / re-enter the password / use a private-key wallet for automation |
| `No reachable storage providers` | All approved providers failed their health check | Transient — the message itself says "retry shortly" |
| `Insufficient` (balance / available funds / allowance) | USDFC funding problem: wallet balance, unlocked payment-account funds, or operator allowance too low | `wallet balance` → `wallet costs` → `wallet deposit`; `needsFwssMaxApproval: true` in costs output means a one-time operator approval is still needed |
| `below minimum allowed size` / `exceeds maximum allowed size` | File outside the SDK's upload size bounds (the message states the exact byte limits) | Pad/split the file accordingly |
| `Invalid PieceCID` | The string is not a valid piece CID | Use the `pieceCid` from upload output or `piece list` |
| `HTTP 429` / rate limit | Faucet or provider throttling | Wait, then retry |
| `nonce` / `timeout` / `fetch failed` / `ECONNREFUSED` | RPC/network layer | Retry once with backoff; persistent → check RPC status |
| `already terminated` / `pending` | Dataset service state prevents the operation | Nothing to do — check `dataset details` |

## Escalation checklist

When an error survives one informed retry: capture the full output with `--debug`, note the chain (`--chain`), the command, and any transaction hash (failures after submission include a block-explorer link — check whether the tx actually landed before re-sending), then check `wallet summary` and `dataset list` to establish current state. For provider-side failures, `provider list` shows which providers are currently approved and performing.
