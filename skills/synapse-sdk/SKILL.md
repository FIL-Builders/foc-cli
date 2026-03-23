---
name: synapse-sdk
description: Use when integrating, upgrading, debugging, or operating @filoz/synapse-sdk / @filoz/synapse-core for Filecoin Onchain Cloud storage, session keys, multi-copy uploads, dataset reuse, provider routing, or PDP-backed retrieval.
---

# synapse-sdk

Use this for current 2026 Synapse work. Treat pre-viem, pre-0.37, or
pre-`source` examples as migration material, not default guidance.

## Hard Rules

- Prefer current truth in this order:
  `references/core/source-ledger.md`
- Default to `Synapse.create({...})`.
- Use `new Synapse({ client, sessionClient? })` only when a wallet client
  already exists.
- Pass a deliberate `source`; stable non-empty string is default, `null` only
  when shared namespace reuse is intentional.
- Call `prepare()` before first upload, large upload, or storage-setting change.
- `upload()` is partial-success: returned result means at least one committed
  copy; `complete === true` means all requested copies succeeded.
- Dataset metadata is low-cardinality routing state. Piece metadata is
  object-specific state.
- Session keys must have synced expirations before client construction.
- PDP proves possession, not authorship; sign uploaded bytes when authenticity
  matters.

## Fast Path

1. Current versions, limits, chains, cost knobs:
   `references/core/facts.md`
2. Default upload/download and split flows:
   `references/use-cases/flows.md`
3. Delegated signing:
   `references/use-cases/session-keys.md`
4. Funding, partial copies, metadata surprises:
   `references/debugging/failures.md`
5. Namespace, dataset explosion, provenance pitfalls:
   `references/edge-cases/namespaces.md`

## References

- `references/core/facts.md`
- `references/core/source-ledger.md`
- `references/use-cases/flows.md`
- `references/use-cases/session-keys.md`
- `references/debugging/failures.md`
- `references/edge-cases/namespaces.md`
