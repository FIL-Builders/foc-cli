import { execFileSync } from 'node:child_process'
import { basename, dirname } from 'node:path'
import { getChain } from '@filoz/synapse-core/chains'
import { createPublicClient, createWalletClient, type Hex, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import config from './config.ts'
import { resolveKeyRef } from './key-ref.ts'
import { expandHome } from './utils.ts'

/**
 * Which custody mode is configured, without resolving anything. Safe to call
 * from read-only paths and from output formatting — it touches no secret and
 * costs no round trip.
 */
export function keySource(): 'keyRef' | 'keystore' | 'privateKey' | 'none' {
  if (config.get('keyRef')) return 'keyRef'
  if (config.get('keystore')) return 'keystore'
  if (config.get('privateKey')) return 'privateKey'
  return 'none'
}

function privateKeyFromConfig() {
  // First because it is the most explicit: only ever present when someone ran
  // `wallet init --key-ref`, and it holds a reference rather than a key, so
  // nothing is at rest. Absent on every other install, which is why the
  // branches below are reached unchanged.
  const keyRef = config.get('keyRef')
  if (keyRef) {
    return resolveKeyRef(keyRef, config.get('keyRefProject'))
  }

  const keystore = config.get('keystore')
  if (!keystore) {
    const privateKey = config.get('privateKey')
    if (!privateKey) {
      throw new Error(
        'Private key not found. Please run `foc-cli wallet init` to initialize the CLI'
      )
    }
    return privateKey
  }
  // execFileSync with an argv array: the keystore path is data, never shell
  // syntax — a path containing metacharacters must not become a command.
  const keystorePath = expandHome(keystore)
  const keystoreDir = dirname(keystorePath)
  const keystoreName = basename(keystorePath)
  try {
    const extraction = execFileSync('cast', [
      'w',
      'dk',
      '-k',
      keystoreDir,
      keystoreName,
    ]).toString()
    const foundAt = extraction.search(/0x[a-fA-F0-9]{64}/)
    if (foundAt === -1) {
      throw new Error('Failed to retrieve private key from keystore')
    }
    return extraction.slice(foundAt, foundAt + 66)
  } catch (error) {
    // cast's own stderr (password prompt, "Error: Mac Mismatch") passes
    // through to the terminal; this message decodes what that output means
    // rather than re-reading it.
    if ((error as { code?: string }).code === 'ENOENT') {
      throw new Error(
        'Failed to access keystore: Foundry `cast` is not on PATH. Install Foundry (https://getfoundry.sh), or switch to a private-key wallet with `foc-cli wallet init`.'
      )
    }
    throw new Error(
      'Failed to access keystore. "Mac Mismatch" above means the password was wrong. Other causes: an invalid keystore file, or a session with no terminal for the password prompt — keystore mode is interactive-only, so MCP/CI must use a private-key wallet.'
    )
  }
}

export function privateKeyClient(chainId: number) {
  const chain = getChain(chainId)

  const privateKey = privateKeyFromConfig()

  const account = privateKeyToAccount(privateKey as Hex)
  const client = createWalletClient({
    account,
    chain,
    transport: http(),
  })
  return {
    client,
    chain,
  }
}

export function publicClient(chainId: number) {
  const chain = getChain(chainId)
  const publicClient = createPublicClient({
    chain,
    transport: http(),
  })
  return publicClient
}
