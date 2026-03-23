---
description: High-signal product and architecture failure modes on Filecoin Onchain Cloud.
---

# Failure Modes

## Authority Bugs

Symptoms:

- one process builds bytes, another publishes the pointer
- helper service can mutate anchor fields after upload
- client-authored state becomes server-authored storage

Fix:

- collapse build/sign/upload/publish onto the actual state authority

## Economic Bugs

Symptoms:

- storage costs spike unexpectedly
- many tiny datasets appear
- CDN costs look wrong

Check:

- volatile dataset metadata
- accidental `source` changes
- unnecessary new datasets
- CDN setup fee vs recurring egress
- copy count inflation

## Partial-Success Bugs

Symptoms:

- app treats returned upload result as full success
- one failed provider marks the whole job failed

Check:

- `complete`
- committed `copies[]`
- whether retries replaced failed providers

## Topology Bugs

Symptoms:

- system stops working when helper services go down
- durable storage path is also the live coordination path

Fix:

- keep helper services optional
- keep durable anchoring separate from live transport
