---
description: Current Filecoin Onchain Cloud architecture and economics.
---

# Architecture

Verified `2026-03-23`.

## Layers

- `Synapse SDK`: client orchestration, provider selection, payments prep,
  upload/retrieval APIs
- `FWSS`: warm-storage service contract and dataset lifecycle
- `PDPVerifier`: proof system that verifies providers still hold bytes
- `Filecoin Pay`: continuous settlement rails in USDFC
- `FilBeam`: CDN / performance retrieval path
- `Filecoin Pin + IPNI`: public content discovery path for IPFS-style content

## Data Model

- bytes -> `pieceCid`
- one provider + one dataset -> one payment relationship
- multi-copy storage -> one committed copy per provider
- dataset metadata drives reuse
- piece metadata labels a single object

## Economics

- base storage: `2.50 USDFC / TiB / 30-day month`
- minimum dataset rate: `0.06 USDFC / month`
- new dataset sybil fee: `0.1 USDFC`
- CDN setup on new CDN dataset: `1.0 USDFC`
- CDN egress: `14 USDFC / TiB downloaded`
- storage service expects roughly `30` days of prepayment runway

## Product Choices

- PDP only:
  durable storage + retrievability
- PDP + Beam:
  low-latency retrieval
- PDP + IPFS indexing:
  public gateway/IPNI discoverability
- PDP + signed payload:
  durable provenance / state anchoring
