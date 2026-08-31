# Mainnet Funding: Getting FIL and USDFC

Mainnet (`--chain 314`) uses **real funds**: FIL pays gas, USDFC pays for storage. There is no mainnet faucet — `wallet fund` is testnet-only. Everything below moves real value; confirm amounts with a human before executing, and keep a dedicated wallet with only the funds foc-cli needs.

> The live source of truth is the FOC docs — verify before acting:
> `npx foc-cli docs --url https://docs.filecoin.cloud/resources/additional-resources.md`

## Agent workflow

1. Run `npx foc-cli wallet balance --chain 314`, then show the user the public address and the FIL, wallet USDFC, total Filecoin Pay funds, and available Filecoin Pay funds separately. A brand-new address may return `ADDRESS_NOT_ON_CHAIN`; the error still includes the address and means every balance is zero.
2. Run `wallet costs` for the actual upload size, runway, and copy count. Use `alreadyCovered` and `depositNeeded` to determine whether the existing Filecoin Pay funds cover the upload.
3. Explain only the shortfalls: FIL is required for gas, but wallet USDFC is required only when the quote needs an additional payment-account deposit. If `alreadyCovered` is true, do not ask the user to acquire more USDFC. Present acquisition routes only for missing assets, and do not perform an exchange, bridge, swap, or mint for the user.
4. If funding is required, ask the user to fund the displayed address, then stop and wait. Re-run `wallet balance --chain 314` and `wallet costs` after the user says funding is complete.
5. Show the latest estimate and required payment-account deposit, then obtain explicit confirmation before depositing or uploading.

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

## After any required funding

```bash
npx foc-cli wallet balance --chain 314                 # confirm FIL + USDFC arrived
npx foc-cli wallet costs --extraBytes <n> --extraRunway <months> --chain 314   # live rate + deposit needed
```

Show the estimate and wait for explicit human confirmation. Run `wallet deposit` only when `depositNeeded` is non-zero; otherwise skip it. Then obtain confirmation for the upload:

```bash
npx foc-cli wallet deposit <depositNeeded> --chain 314 # only when depositNeeded is non-zero
npx foc-cli upload ./file.pdf --chain 314
```

Cross-check the USDFC token you received against the address foc-cli itself uses — the CLI's bundled chain config (from `@filoz/synapse-core`) pins the official USDFC contract per chain, so a mismatched balance in `wallet balance` means you hold a different token than the one FOC pays with.

## Testnet (for contrast)

For the Calibration workflow and documented faucet fallbacks, see [testnet-funding.md](testnet-funding.md).
