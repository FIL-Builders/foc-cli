import { Synapse } from '@filoz/synapse-sdk'
import { privateKeyClient } from './client.ts'
import config from './config.ts'

/**
 * The `source` string Synapse reports to Warm Storage (used for telemetry and
 * attribution). Persisted in the CLI config — set it with
 * `wallet init --source <name>`; defaults to "foc-cli" when unset.
 */
function synapseSource(): string {
  return config.get('source') ?? 'foc-cli'
}

/**
 * Resolve the wallet client + chain for `chainId` together with a Synapse
 * instance bound to it — the single setup path for any command that talks to
 * Synapse, so the `source` (config `source`, default "foc-cli") is resolved in
 * exactly one place.
 *
 * Commands that only need the raw wallet/public client (e.g. dataset and piece
 * reads, which call synapse-core directly) keep using `privateKeyClient` /
 * `publicClient` from `./client.ts`.
 */
export function synapseClient(chainId: number) {
  const { client, chain } = privateKeyClient(chainId)
  const synapse = new Synapse({ client, source: synapseSource() })
  return { client, chain, synapse }
}
