import { execSync } from 'node:child_process'
import { basename, dirname } from 'node:path'
import { getChain } from '@filoz/synapse-core/chains'
import { createPublicClient, createWalletClient, type Hex, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import config from './config.ts'

function privateKeyFromConfig() {
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
  const keystoreDir = dirname(keystore)
  const keystoreName = basename(keystore)
  try {
    const extraction = execSync(
      `cast w dk -k ${keystoreDir} ${keystoreName}`
    ).toString()
    const foundAt = extraction.search(/0x[a-fA-F0-9]{64}/)
    if (foundAt === -1) {
      throw new Error('Failed to retrieve private key from keystore')
    }
    return extraction.slice(foundAt, foundAt + 66)
  } catch (_error) {
    throw new Error('Failed to access keystore')
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
