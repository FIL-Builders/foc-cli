---
description: Official source order and conflict handling for Synapse SDK facts.
---

# Source Ledger

Verified `2026-03-23`.

## Source Order

1. npm registry metadata
   - `https://registry.npmjs.org/@filoz/synapse-sdk`
   - `https://registry.npmjs.org/@filoz/synapse-core`
2. Current GitHub source and changelogs
   - `https://github.com/FilOzone/synapse-sdk`
3. Official docs
   - `https://docs.filecoin.cloud/getting-started/`
   - `https://docs.filecoin.cloud/developer-guides/storage/storage-operations/`
   - `https://docs.filecoin.cloud/developer-guides/storage/storage-context/`
   - `https://docs.filecoin.cloud/developer-guides/storage/storage-costs/`
   - `https://docs.filecoin.cloud/developer-guides/session-keys/`
   - `https://docs.filecoin.cloud/developer-guides/migration-guide/`
4. Official example app
   - `https://github.com/FIL-Builders/fs-upload-dapp`

## Conflict Rules

- Release numbers and publish dates: npm wins.
- API shape and exported names: current GitHub source wins.
- Product guidance and economics: current docs win unless contradicted by newer
  source.
- Examples are illustrative, not normative.

## Known Drift To Normalize

- Examples using `new Synapse({ client, ... })` are valid advanced patterns, not
  the default starting point.
- Any `Synapse.create()` example without `source` is stale for current typings;
  use a stable non-empty string or explicit `null`.
- `warmStorageAddress` is not a modern `Synapse.create()` option; address
  discovery is internal for supported chains.
