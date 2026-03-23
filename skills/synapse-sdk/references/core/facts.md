---
description: Verified March 23, 2026 facts for current Synapse SDK work.
---

# Facts

Verified `2026-03-23`.

- npm latest:
  - `@filoz/synapse-sdk` = `0.40.0`
  - `@filoz/synapse-core` = `0.3.1`
- Public baseline:
  - Node.js `20+`
  - `viem` peer dependency `2.x`
- Preferred constructor:
  - `Synapse.create({ account, source, chain?, transport?, withCDN?, sessionKey? })`
- Advanced constructor:
  - `new Synapse({ client, source, withCDN?, sessionClient? })`
- Default upload copies: `2`
- Upload result shape:
  - `requestedCopies`
  - `complete`
  - `copies[]`
  - `failedAttempts[]`
- Size limits:
  - min `127` bytes
  - max `1,065,353,216` bytes
- Metadata limits:
  - dataset metadata: `10` pairs
  - piece metadata: `5` pairs
- Time model:
  - epoch = `30s`
  - day = `2880` epochs
  - month = `86400` epochs
  - default lockup = `30` days
- Chain ids:
  - mainnet: `314`
  - calibration: `314159`
  - devnet: `31415926`
- Current storage economics:
  - storage = `2.50 USDFC / TiB / 30-day month`
  - minimum rate = `0.06 USDFC / month / dataset`
  - new dataset sybil fee = `0.1 USDFC`
  - CDN fixed lockup = `1.0 USDFC` per new CDN dataset

Operational implications:

- `prepare()` is the default funding gate.
- `source` participates in dataset reuse.
- `failedAttempts.length > 0` is diagnostic only.
- Persist committed copy info, not just `pieceCid`.
