---
description: Role-splitting edge cases for Filecoin Onchain Cloud integrations.
---

# Authority

## Keep These Roles Separate

- author:
  who created the bytes
- uploader:
  who executed the storage operation
- payer:
  who funds the rails
- publisher:
  who exposes the external pointer
- helper:
  who assists with credentials, funding, or transport

## Safe Patterns

- one actor owns all roles
- delegated uploader acts for the payer, but the payload still proves author
- helper service never invents or rewrites anchor outputs

## Unsafe Patterns

- payer identity used as a proxy for authorship
- unsigned payloads later treated as provenance-bearing records
- stale `pieceCid` / timestamp / dataset fields carried forward to new records
- helper outage breaking the core protocol path

## Review Test

Ask, in order:

1. Who produced the exact uploaded bytes?
2. Who signed them?
3. Who paid?
4. Who published the pointer?
5. Can any other process rewrite those answers later?

If the answers drift across systems, the authority boundary is probably wrong.
