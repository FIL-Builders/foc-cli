# Calibration Funding: Getting tFIL and tUSDFC

Calibration (`--chain 314159`) needs tFIL for gas and tUSDFC for storage payments. Both are test tokens.

> The live source of truth is the FOC docs — verify before acting:
> `npx foc-cli docs --url https://docs.filecoin.cloud/resources/additional-resources.md`

## Agent workflow

1. Inspect the address and current state:

   ```bash
   npx foc-cli wallet balance --chain 314159
   ```

   Report the address, tFIL (`fil`), wallet tUSDFC (`usdfc`), total Filecoin Pay funds (`funds`), and currently available Filecoin Pay funds (`availableFunds`) separately. A brand-new, unfunded address may return `ADDRESS_NOT_ON_CHAIN`; the error still includes the address and means every balance is zero.

2. Run `wallet costs` for the actual upload size, runway, copy count, and CDN setting. Use `alreadyCovered` and `depositNeeded` to determine whether Filecoin Pay needs more tUSDFC. If `alreadyCovered` is true, do not request wallet tUSDFC. Otherwise, compare `depositNeeded` with the wallet tUSDFC balance and request only the shortfall.

3. Use the user's funding choice if it is already known. Otherwise, ask whether the user wants to fund the address or wants agent-assisted faucet funding.

   - **User-funded:** show the address and the documented faucets below, then stop and wait.
   - **Agent-assisted, tFIL and tUSDFC both required:** run the built-in faucet command once:

     ```bash
     npx foc-cli wallet fund --chain 314159
     ```

   - **Only one asset required:** do not run the combined command; use the matching asset-specific browser handoff below.
   - **Neither asset required:** skip funding.

4. After any faucet attempt, re-check the balance before deciding what happened:

   ```bash
   npx foc-cli wallet balance --chain 314159
   ```

   One faucet asset may have arrived even when the combined command reports an error. If a returned transaction is pending, or the command failed or timed out without a definitive per-asset result, treat a zero balance as unconfirmed: wait and re-check, then stop rather than submitting another claim. Use a fallback only for an asset known not to have been claimed or confirmed, and never submit a duplicate claim.

5. After any required funding arrives, re-run `wallet costs`. Its `depositNeeded` and `needsFwssMaxApproval` fields are distinct from wallet and Filecoin Pay balances.

## Documented fallback ladder

Use browser handoff for these faucets; the user enters only the public wallet address and completes any human verification:

1. **Missing tFIL:** use the [ChainSafe Calibration faucet](https://faucet.calibnet.chainsafe-fil.io/funds.html). If it is unavailable, Filecoin Docs also lists the [Zondax faucet](https://beryx.zondax.ch/faucet/) and [Forest faucet](https://forest-explorer.chainsafe.dev/faucet/calibnet).
2. **Missing tUSDFC:** use the [Calibration tUSDFC faucet](https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc).
3. Re-run `wallet balance --chain 314159` after each completed request and resume only from the observed balances.

Do not infer or call faucet APIs from website code, bypass CAPTCHA or anti-bot controls, submit parallel faucet claims, or retry without first checking balances. Never ask for or enter the user's private key into a faucet.
