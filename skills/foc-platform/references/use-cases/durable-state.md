---
description: Durable-state and signed-record anchoring patterns on Filecoin Onchain Cloud.
---

# Durable State

Use this when the uploaded bytes are more than files: signed reports, audit
records, manifests, local app state, or other data whose authorship matters.

## Correct Order

1. Produce canonical bytes at the authority that owns the state.
2. Compute the local hash / root over those bytes.
3. Sign the bytes or a deterministic envelope containing the root.
4. Upload to Filecoin.
5. Persist the real anchor outputs:
   `pieceCid`, `providerId`, `dataSetId`, `pieceId`, anchor timestamp.
6. Publish external pointers or manifests.

## Never Do

- publish the pointer first, fill storage fields later
- let a helper service invent the state hash after the fact
- infer authorship from the payer wallet
- treat PDP as a signature system

## Role Split

Valid:

- author = uploader = signer
- author != payer, but the uploaded payload contains the author's signature
- helper only issues credentials, funding, or transport assistance

Invalid:

- helper uploads unsigned state and claims the state is user-authored
- one process computes the pointer, another later patches in storage IDs
