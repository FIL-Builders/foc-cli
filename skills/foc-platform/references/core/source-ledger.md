---
description: Official source order and freshness notes for Filecoin Onchain Cloud.
---

# Source Ledger

Verified `2026-03-23`.

## Primary Sources

- docs:
  - `https://docs.filecoin.cloud/`
  - `https://docs.filecoin.cloud/core-concepts/architecture/`
  - `https://docs.filecoin.cloud/core-concepts/pdp-overview/`
  - `https://docs.filecoin.cloud/core-concepts/fwss-overview/`
  - `https://docs.filecoin.cloud/core-concepts/filecoin-pay-overview/`
  - `https://docs.filecoin.cloud/developer-guides/storage/storage-costs/`
- SDK / contracts / examples:
  - `https://github.com/FilOzone/synapse-sdk`
  - `https://github.com/FIL-Builders/fs-upload-dapp`

## Conflict Rules

- Economics and service concepts: docs win.
- Current API and export names: SDK source wins.
- Example-app behavior is evidence, not protocol truth.
- Prefer exact dates when discussing versions or publish times.

## Fresh Facts

- docs host is `docs.filecoin.cloud`
- current npm latest:
  - `@filoz/synapse-sdk` = `0.40.0`
  - `@filoz/synapse-core` = `0.3.1`
- current public architecture still centers on FWSS + PDP + Filecoin Pay +
  Synapse SDK, with Beam/CDN and IPFS indexing as optional retrieval paths
