---
name: foc-platform
description: Use when reasoning about Filecoin Onchain Cloud architecture, PDP, Warm Storage Service, Filecoin Pay, Filecoin Beam, Filecoin Pin/IPFS indexing, storage economics, or durable-state anchoring patterns.
---

# foc-platform

Use this for product, protocol, and architecture decisions around Filecoin
Onchain Cloud. For SDK-level code and API usage, also use
`../synapse-sdk/SKILL.md`.

## Hard Rules

- Separate bytes, proofs, payments, and client orchestration.
- Treat Filecoin as a durable service plane, not a live message bus.
- PDP proves possession, not authorship, freshness, or semantic correctness.
- Keep author, uploader, payer, publisher, and helper roles explicit.
- Publish external pointers only after the upload result is final.
- Dataset reuse is economic state; accidental dataset creation costs money.
- Beam/CDN changes retrieval UX and egress economics, not storage correctness.
- IPFS indexing changes discoverability, not ownership.

## Fast Path

1. Product model, costs, and service boundaries:
   `references/core/architecture.md`
2. Official sources and freshness rules:
   `references/core/source-ledger.md`
3. Durable-state anchoring patterns:
   `references/use-cases/durable-state.md`
4. Public content, IPFS indexing, and CDN interplay:
   `references/use-cases/public-content.md`
5. Authority, economics, and topology bugs:
   `references/debugging/failure-modes.md`
6. Role-splitting edge cases:
   `references/edge-cases/authority.md`

## References

- `references/core/architecture.md`
- `references/core/source-ledger.md`
- `references/use-cases/durable-state.md`
- `references/use-cases/public-content.md`
- `references/debugging/failure-modes.md`
- `references/edge-cases/authority.md`
