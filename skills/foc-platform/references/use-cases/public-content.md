---
description: Public-content patterns combining IPFS indexing and Beam/CDN.
---

# Public Content

## Use IPFS Indexing When

- content should resolve by IPFS root CID
- public gateways or IPNI discovery matter
- the uploaded bytes are CAR / IPLD-friendly content

Pattern:

- dataset metadata includes `withIPFSIndexing`
- piece metadata includes `ipfsRootCID`
- verify gateway/IPNI visibility before claiming public availability

## Use Beam / CDN When

- low-latency retrieval matters
- traffic volume justifies egress costs
- public discovery is not enough on its own

## Do Not Conflate

- IPFS indexing:
  discoverability / addressing
- Beam / CDN:
  retrieval performance / egress path
- PDP:
  storage possession proof
- payload signature:
  authorship / provenance
