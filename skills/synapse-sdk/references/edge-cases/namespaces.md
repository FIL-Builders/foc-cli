---
description: Namespace isolation, metadata discipline, and provenance edge cases.
---

# Namespaces

## Reuse Is Exact

- Dataset reuse requires exact metadata key/value equality.
- Adding or removing one dataset key creates a new reuse namespace.
- `source` is part of that namespace.

## Stable vs Volatile

Good dataset metadata:

- environment
- collection
- schema
- product/domain

Bad dataset metadata:

- timestamps
- run ids
- user/session ids
- random UUIDs

Keep volatile identifiers in piece metadata or inside the payload.

## Reserved Meanings

- `withCDN`: dataset-level retrieval addon request
- `withIPFSIndexing`: dataset-level IPNI/IPFS indexing request
- `ipfsRootCID`: piece-level advisory root CID
- `source`: dataset namespace isolation key

## Provenance

- PDP proves the bytes are held.
- PDP does not prove who authored the bytes.
- Payer identity does not prove content authorship.
- If provenance matters, upload a signed envelope or signed canonical payload.
