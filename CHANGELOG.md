# Changelog

All notable changes to **foc-cli** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Pre-1.0, minor versions may contain breaking changes; they are always called out explicitly.

## [Unreleased]

Agent-hardening release ([#30]), driven by a 609-invocation live smoke campaign on Calibration and a keystore field test. Contains one breaking change, so the next release should be **0.2.0**.

### Added

- `download <pieceCid>` — retrieval as verification: the SDK validates received bytes against the piece CID, so a successful download is itself the proof of storage. Distinct error codes separate what retrying can fix (`DOWNLOAD_FAILED`) from what it cannot (`INTEGRITY_MISMATCH`, `PROVIDER_NOT_FOUND`, `WRITE_FAILED`, `FILE_EXISTS`). ([#7])
- `download --force` — downloads no longer overwrite an existing output file: without the flag, an existing path fails with `FILE_EXISTS` and a ready-to-run overwrite CTA, and the MCP annotation declares `destructiveHint: true`. ([#30])
- `wallet costs --copies` / `--withCDN` — the estimate prices the copies the next upload will create (default 2, like `upload`); an empty wallet is priced as new datasets without touching provider selection. ([#30])
- `wallet init` output schema — it was the only executable command without one, hiding its result contract from `--schema` and MCP `get_tool_details`; a discovery test now walks `src/commands` so the next schema-less command fails CI. ([#30])
- `docs --deep` — searches the full ~1,800-page site sitemap (SDK API reference, changelogs), automatically invoked when the curated index has no matches. ([#25])
- MCP tool annotations on every command — human titles, `readOnlyHint` on reads, `destructiveHint` on `wallet init` / `dataset terminate` / `piece remove` — plus descriptions that state consequences (uploads commit USDFC onchain, terminate is irreversible). ([#28])
- Fetch-all CTAs on paginated lists (`piece list`, `dataset details`) alongside next-page.
- `ADDRESS_NOT_ON_CHAIN` — `wallet balance` on a brand-new address now explains the address has no onchain history and suggests `wallet fund`, instead of dumping raw RPC internals. ([#27])
- Skill references: [keystore setup](skills/foc-cli/references/keystore-setup.md) (with creation recipe), [mainnet funding](skills/foc-cli/references/mainnet-funding.md), and a [troubleshooting catalog](skills/foc-cli/references/troubleshooting.md) of every error code with retry semantics. ([#2], [#4])
- Skills-consistency test: skill frontmatter version/license and every `foc-cli@x.y.z` doc pin are CI-pinned to `cli/package.json`.

### Changed

- Uploads stream to providers (`upload`, `multi-upload`) — peak memory stays flat at any file size; only `stat` sizes are read up front. ([#24])
- `wallet costs` no longer depends on endorsed-provider selection and prices the upload it is quoting — `--copies` storage contexts (default 2), reusing active datasets before pricing new ones — instead of every active dataset, which made the quote scale with historical dataset count. ([#26], [#30])
- `wallet init` explicit methods (`--auto`, `--keystore`, `--privateKey`) now replace the configured wallet and clear the alternate credential; `--auto` previously reported `already_configured` behind an existing key, and a configured keystore silently outranked a newly set key. ([#30])
- `--schema` now tells the truth: declared output schemas include the `processLog` step trail and `cta` block that real agent-mode responses carry. ([#28])
- Both agent skills open with a self-discovery rule (run `<cmd> -h` and `<cmd> --schema --format json` before first use) and document flag syntax truthfully: camelCase and kebab-case spellings both parse, and boolean flags are presence-only switches (`--flag=false` is the explicit form). ([#1], [#3], [#5])
- Keystore mode documented as interactive-CLI-only — and now enforced: agent/MCP mode rejects `--keystore` (`KEYSTORE_INTERACTIVE_ONLY`) and its init guidance no longer offers it, since the password prompt reads the terminal at use time. ([#30])
- README rewritten against the verified current surface — one-table command map, quick start ending in a download round-trip. ([#29])
- Dependencies: `@filoz/synapse-sdk` 1.1.0, `incur` 0.4.19 (fixes the doubled group prefix in `--llms` output). ([#23])

### Fixed

- `upload --withCDN` always failed against the pinned SDK — `contexts` and `withCDN` are mutually exclusive upload options — and only after the funding transaction had run. CDN preference now rides in via context creation alone. ([#30])
- Both upload paths accepted directories, FIFOs, and devices at preflight (readability and size only), so the funding transaction could execute before streaming failed or blocked; non-regular files are now rejected (`NOT_A_FILE` / `FILE_READ_FAILED`) before provider selection. ([#30])
- `wallet balance` actor-not-found guidance suggested the Calibration-only faucet on every chain; the `wallet fund` CTA is now testnet-only and mainnet gets prose directing funds to the address. ([#30])
- `wallet balance` fresh-address humanization also recognizes the current Glif RPC wording (`failed to apply on state with gas`) — live-observed 2026-07-23, the older `actor not found` match alone had let the raw multicall dump return. ([#27], [#30])
- `wallet costs` failed with `No endorsed provider available` and undercounted datasets sharing a provider (live check: 0.1058 → correct 0.1322 USDFC/month for 1 GiB). ([#26])
- `wallet init --keystore` accepted a directory or arbitrary JSON and reported success; it now validates the path is a regular file (a FIFO could block the process at the synchronous read) containing an encrypted keystore with a `crypto` object (`KEYSTORE_INVALID`). ([#27], [#30])
- Keystore failures decode themselves: missing `cast` (install Foundry), `Mac Mismatch` (wrong password), no terminal (keystore mode cannot run under MCP/CI). ([#27])
- `docs` auto-fetch could return raw HTML for pages without a markdown mirror; both fetch paths now share the HTML backstop.
- Interactive spinner no longer blanks step labels or leaks orphan glyphs when info/success messages interleave with steps.

### Removed

- **Breaking:** `dataset upload` — `upload` already creates a dataset automatically; the low-level duplicate had a worse interface. Use `foc-cli upload <path>` (auto provider/dataset) or `dataset create` + `upload` for explicit control. ([#24])

### Security

- `docs --url` is restricted to `docs.filecoin.cloud` (full URL or bare docs path), rejects traversal, and refuses redirects so the host allowlist holds end-to-end. ([#25])
- The same allowlist now also gates URLs parsed out of fetched content — `llms.txt` index entries, sitemap shards, and sitemap pages — so a planted external link can never be auto-fetched. ([#30])
- Keystore decryption invokes `cast` with an argument array — the keystore path is never interpolated into a shell command. ([#27])

## [0.1.1] — 2026-06-16

Synapse SDK v1 migration plus a CLI-hardening pass ([#17], [#19], [#20], [#21], [#22]).

### Added

- Provider health checks before upload context selection — unreachable providers are skipped instead of failing the upload.
- Piece pagination with next-page CTAs on `piece list` and `dataset details`.
- `wallet init --source <name>` — attribution tag reported to Synapse/Warm Storage.

### Changed

- Migrated all commands to Synapse SDK v1 APIs.
- Centralized Synapse client construction (`synapseClient`).
- `incur` 0.4.8; Node.js >= 22 required; dropped `@remix-run/fs`.
- CLI version is read from `package.json` (was hardcoded).

### Fixed

- Failure envelopes render the real error code and message (previously `code: null, message: null`).
- `wallet costs` no longer reports a duplicate monthly rate and surfaces whether a one-time operator approval is still needed.

## [0.1.0] — 2026-05-13

### Added

- CI workflow (test + lint on every push).
- Test coverage for the Synapse-backed commands.

### Changed

- Upgraded Synapse SDK and synapse-core.
- `dataset create` requires a `providerId` (schema-enforced).

## [0.0.4] — 2026-03-19

Initial public release.

### Added

- CLI refactored out of the original `foc-skill`: upload, wallet, dataset, piece, provider, and docs commands for Filecoin Onchain Cloud.
- MCP server mode and the two agent skills (`foc-cli`, `foc-docs`).
- MCP client compatibility fixes.

[Unreleased]: https://github.com/FIL-Builders/foc-cli/compare/main...agent-hardening
[0.1.1]: https://www.npmjs.com/package/foc-cli/v/0.1.1
[0.1.0]: https://www.npmjs.com/package/foc-cli/v/0.1.0
[0.0.4]: https://www.npmjs.com/package/foc-cli/v/0.0.4
[#1]: https://github.com/FIL-Builders/foc-cli/issues/1
[#2]: https://github.com/FIL-Builders/foc-cli/issues/2
[#3]: https://github.com/FIL-Builders/foc-cli/issues/3
[#4]: https://github.com/FIL-Builders/foc-cli/issues/4
[#5]: https://github.com/FIL-Builders/foc-cli/issues/5
[#7]: https://github.com/FIL-Builders/foc-cli/issues/7
[#17]: https://github.com/FIL-Builders/foc-cli/pull/17
[#19]: https://github.com/FIL-Builders/foc-cli/pull/19
[#20]: https://github.com/FIL-Builders/foc-cli/pull/20
[#21]: https://github.com/FIL-Builders/foc-cli/pull/21
[#22]: https://github.com/FIL-Builders/foc-cli/pull/22
[#23]: https://github.com/FIL-Builders/foc-cli/issues/23
[#24]: https://github.com/FIL-Builders/foc-cli/issues/24
[#25]: https://github.com/FIL-Builders/foc-cli/issues/25
[#26]: https://github.com/FIL-Builders/foc-cli/issues/26
[#27]: https://github.com/FIL-Builders/foc-cli/issues/27
[#28]: https://github.com/FIL-Builders/foc-cli/issues/28
[#29]: https://github.com/FIL-Builders/foc-cli/issues/29
[#30]: https://github.com/FIL-Builders/foc-cli/pull/30
