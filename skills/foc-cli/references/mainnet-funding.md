# Mainnet Funding: Getting FIL and USDFC

Mainnet (`--chain 314`) uses **real funds**: FIL pays gas, USDFC pays for storage. There is no mainnet faucet — `wallet fund` is testnet-only. Everything below moves real value; confirm amounts with a human before executing, and keep a dedicated wallet with only the funds foc-cli needs.

> The live source of truth is the FOC docs — verify before acting:
> `npx foc-cli docs --url https://docs.filecoin.cloud/resources/additional-resources.md`

## Your wallet address

The foc-cli wallet is a standard EVM account (`0x…`) on the Filecoin EVM (FEVM); on Filecoin's native address format it corresponds to an `f410…` address. Get the address from `wallet balance`. **Caveat when withdrawing from exchanges:** not every exchange supports withdrawing FIL directly to `0x`/`f410` addresses. If yours doesn't, withdraw to a self-custody Filecoin wallet that can send to `0x` addresses (e.g. MetaMask with the Filecoin network, or Glif), then forward from there.

## Getting FIL (gas)

Per the FOC docs, mainnet options are:

1. **Buy on a centralized or decentralized exchange** and withdraw to your wallet (see address caveat above).
2. **Crypto onramps** that sell FIL directly to a wallet address.
3. **Bridge from any chain/token to FIL** with [Squid Router](https://app.squidrouter.com).

Gas needs are small — a few FIL covers many operations.

## Getting USDFC (storage payments)

USDFC is a FIL-collateralized, USD-pegged stablecoin by Secured Finance ([docs](https://docs.secured.finance/usdfc-stablecoin/overview)). Mainnet options per the FOC docs:

1. **Bridge/swap any token to USDFC** with [Squid Router](https://app.squidrouter.com) — simplest if funds live on another chain.
2. **Swap FIL → USDFC on SushiSwap V3** (FIL/USDFC pool on Filecoin) — simplest if you already hold FIL.
3. **Mint against FIL collateral** at the [USDFC app](https://app.usdfc.net): deposit FIL into a "Trove" and mint USDFC. Per Secured Finance docs the minimum collateral ratio is 110% and the minimum borrow is 180 USDFC plus a 20 USDFC liquidation reserve — verify current parameters in their docs before minting, and understand liquidation risk: if FIL's price drops your collateral can be liquidated.

For most users storing data, **swapping** (1 or 2) is the right choice; minting (3) is a DeFi position, not just a purchase.

## After funding

```bash
npx foc-cli wallet balance --chain 314                 # confirm FIL + USDFC arrived
npx foc-cli wallet costs --extraBytes <n> --extraRunway <months> --chain 314   # live rate + deposit needed
npx foc-cli wallet deposit <amount> --chain 314        # move USDFC into the payment account
npx foc-cli upload ./file.pdf --chain 314
```

Cross-check the USDFC token you received against the address foc-cli itself uses — the CLI's bundled chain config (from `@filoz/synapse-core`) pins the official USDFC contract per chain, so a mismatched balance in `wallet balance` means you hold a different token than the one FOC pays with.

## Testnet (for contrast)

On Calibration (the default chain) all of this is one command — `npx foc-cli wallet fund` — which claims free tFIL and tUSDFC from faucets.
