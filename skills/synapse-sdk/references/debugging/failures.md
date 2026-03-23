---
description: Failure classification and recovery rules for Synapse SDK operations.
---

# Failures

Classify before changing code.

## Funding Or Approval

Signals:

- `prepare()` returns `transaction`
- uploads fail on underfunded accounts
- new datasets stop progressing

Check:

- `prep.costs.depositNeeded`
- `prep.costs.needsFwssMaxApproval`
- whether the app skipped `prepare()`

## Session Key

Signals:

- root wallet works, delegated path fails
- things work immediately after login, then stop later

Check:

- permission set
- `sessionKey.syncExpirations()`
- whether the client was constructed before expirations were refreshed

## Metadata / Reuse

Signals:

- new dataset every upload
- wrong dataset reused
- expected prior dataset missing

Check:

- exact dataset metadata keys and values
- `source`
- `withCDN`
- `withIPFSIndexing`
- any volatile keys in dataset metadata

## Provider / Copy Path

Signals:

- returned result but `complete === false`
- fewer copies than requested
- secondaries fail while primary succeeds

Check:

- `result.copies.length`
- `result.requestedCopies`
- `result.failedAttempts`
- whether split flow is needed for observability or recovery

## Error Meaning

- `StoreError`: zero providers committed anything; retry upload
- `CommitError`: bytes were stored but all commits failed; retry commit path
- returned result + non-empty `failedAttempts`: not necessarily failure

## Drift

If docs, examples, and code disagree, normalize with
`references/core/source-ledger.md`.
