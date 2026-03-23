---
description: Current delegated-signing flow for Synapse SDK session keys.
---

# Session Keys

## Default Flow

```ts
import * as SessionKey from "@filoz/synapse-core/session-key"

const sessionKey = SessionKey.fromSecp256k1({
  privateKey,
  root: rootAccount,
  chain,
})

await SessionKey.loginSync(rootWalletClient, {
  address: sessionKey.address,
})

await sessionKey.syncExpirations()

const synapse = Synapse.create({
  account: rootAccount,
  chain,
  source: "my-app",
  sessionKey,
})
```

## Default FWSS Permissions

- `CreateDataSetPermission`
- `AddPiecesPermission`
- `SchedulePieceRemovalsPermission`
- `DeleteDataSetPermission`

## Use Session Keys When

- wallet popups would otherwise dominate UX
- repeated storage operations must happen in-browser or on-device
- uploads must keep root ownership while delegating short-lived signing

## Hard Rules

- `syncExpirations()` before constructing `Synapse`.
- Missing or expired permissions fail like contract/auth errors, not random
  provider errors.
- Session keys delegate signing, not authorship.
- If payer and content author differ, prove authorship inside the payload.
