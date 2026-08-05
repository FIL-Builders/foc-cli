# Keystore Setup (Foundry)

`foc-cli` supports an encrypted **Foundry keystore** — the option for a wallet that will hold real funds, as a safer alternative to a raw private key. In this mode the config file stores only the keystore *path* — never the key. Each command decrypts the key at runtime by shelling out to Foundry's `cast wallet decrypt-keystore`, so the key is password-encrypted at rest and only held in memory while a command runs.

## Requirements

- [Foundry](https://getfoundry.sh) installed (`cast` must be on `PATH`) — the CLI runs `cast w dk` internally.
- **An interactive terminal.** The password prompt appears at *use* time (the first wallet command, not `wallet init`) and reads from the terminal's tty directly — redirecting stdin does not suppress or feed it. With no tty at all (the MCP server, CI, cron), decryption fails instead of prompting.

**Keystore mode is interactive-CLI-only.** A keystore-configured wallet cannot work under the MCP server: there is no tty to prompt on, and no password-in-config option exists (deliberately — it would defeat the encryption). For MCP or any automation, use one of:

- `wallet init --keyRef <provider>:<reference>` — the key stays in an external secret manager and is fetched per command. Nothing prompts and nothing is at rest, which makes it the closest equivalent to this mode for automation. See [key-injection.md](key-injection.md).
- `wallet init --auto` (testnet) or `wallet init --privateKey <key>` — simplest, but the key lives in the config file.

## Setup

**Option A — import an existing key into an encrypted keystore:**

```bash
cast wallet import foc --interactive
# prompts for the private key, then a password;
# writes ~/.foundry/keystores/foc
```

The `--interactive` prompt keeps the key out of shell history. Never pass the key as a command argument.

**Option B — generate a brand-new key directly into a keystore:**

```bash
mkdir -p ~/.foundry/keystores        # cast wallet new does NOT create the directory
cast wallet new ~/.foundry/keystores
# prompts for a password ("Enter secret:"), then prints the new address and
# the keystore file path — the filename is a random UUID, e.g.
#   Created new encrypted keystore file: ~/.foundry/keystores/365c7404-....
# Optionally rename it (the filename is not part of the encryption):
mv ~/.foundry/keystores/<uuid> ~/.foundry/keystores/foc
```

**Point foc-cli at the keystore** (the file Option A named `foc`, or the path Option B printed/renamed):

```bash
npx foc-cli wallet init --keystore ~/.foundry/keystores/foc
npx foc-cli wallet balance   # verify: prompts for the keystore password, shows balances
```

`wallet init` validates that the path is an encrypted keystore *file* (rejecting directories and non-keystore JSON), but it cannot check the password — that happens at first use. If the verify step prints `Mac Mismatch`, the password was wrong; run the command again and re-enter it.

`wallet init --keystore` clears any previously stored raw `privateKey` from the config. foc-cli expands a leading `~` itself, so `~`-paths work even where no shell does the expansion (MCP tool calls, config files), and the keystore path is passed to `cast` as an argument list — never interpolated into a shell command.

## Security notes

- The keystore file is encrypted, but its password is the last line of defense — use a strong one and don't reuse it.
- Back up the keystore file (and remember the password); losing either loses access to the wallet's funds.
- Keep a dedicated wallet for foc-cli holding only the funds it needs.
- The decrypted key exists in process memory during a command run. Anyone who can run commands as your OS user while the keystore password is known/cached can spend from the wallet — standard local-machine hygiene applies.
