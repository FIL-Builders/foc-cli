---
description: Golden-path and split-path Synapse SDK workflows.
---

# Flows

## Golden Path

```ts
const synapse = Synapse.create({ account, chain, source: "my-app" })

const prep = await synapse.storage.prepare({
  dataSize: BigInt(data.byteLength),
})
if (prep.transaction) await prep.transaction.execute()

const result = await synapse.storage.upload(data, {
  copies: 2,
  metadata: dataSetMetadata,
  pieceMetadata,
})

if (!result.complete) {
  // Partial success: use copies[], inspect failedAttempts[]
}
```

Use this when:

- default provider selection is acceptable
- one call is more important than per-provider control
- retrying from raw bytes is fine

## Split Flow

Use for batch uploads, multi-file orchestration, explicit per-provider progress,
or commit retries without re-uploading bytes.

1. `createContexts({ copies, metadata })`
2. `primary.store(data)`
3. `secondary.presignForCommit([{ pieceCid, pieceMetadata? }])`
4. `secondary.pull({ pieces, from: primary.getPieceUrl, extraData })`
5. `commit()` only on contexts that actually hold the piece
6. Persist `providerId`, `dataSetId`, `pieceId`, `retrievalUrl`, `role`

Rules:

- Pre-sign once, reuse `extraData` for `pull()` and `commit()`.
- Primary is client upload. Secondaries are SP-to-SP transfer.
- `CommitError` after successful store/pull means retry commit, not re-upload.

## Downloads

- Default:
  `await synapse.storage.download({ pieceCid, withCDN? })`
- Explicit provider path:
  use `context.getPieceUrl(pieceCid)` when you need provider-specific retrieval
  or your own fetch pipeline.

## Metadata Split

- dataset metadata:
  stable, low-cardinality, reuse-driving
- piece metadata:
  per-object, high-cardinality, advisory
