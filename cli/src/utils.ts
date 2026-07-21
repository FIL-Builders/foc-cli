import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { Chain } from '@filoz/synapse-core/chains'
import terminalLink from 'terminal-link'

/**
 * Expand a leading `~` to the home directory. Shells do this for interactive
 * users, but paths arriving via MCP tool calls or config files reach us
 * unexpanded — without this, `~/.foundry/keystores/foc` silently "does not
 * exist" in agent contexts.
 */
export function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return resolve(homedir(), path.slice(2))
  return path
}

function networkSlug(chain: Chain): string {
  return chain.id === 314 ? 'mainnet' : 'calibration'
}

export function hashLink(hash: string, chain: Chain) {
  return terminalLink(hash, `${chain.blockExplorers?.default?.url}/tx/${hash}`)
}

export function datasetScannerUrl(dataSetId: string | bigint, chain: Chain) {
  return `https://pdp.vxb.ai/${networkSlug(chain)}/dataset/${dataSetId.toString()}`
}

export function pieceScannerUrl(pieceCid: string, chain: Chain) {
  return `https://pdp.vxb.ai/${networkSlug(chain)}/piece/${pieceCid}`
}

export function txExplorerUrl(hash: string, chain: Chain) {
  return `${chain.blockExplorers?.default?.url}/tx/${hash}`
}

export function dealbotDashboardUrl(chain: Chain) {
  return chain.id === 314
    ? 'https://dealbot.filoz.org'
    : 'https://staging.dealbot.filoz.org'
}

export function formatBytes(bytes: bigint): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = Number(bytes)
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value % 1 === 0 ? value : value.toFixed(2)} ${units[unitIndex]}`
}

/**
 * Detects whether the CLI is running in agent/MCP mode.
 *
 * incur's MCP handler doesn't pass `agent: true` to command run contexts,
 * so c.agent is undefined when invoked via --mcp. This helper checks both
 * the run context AND process-level signals (--mcp flag, non-TTY stdout).
 */
const mcpMode = process.argv.includes('--mcp')

export function isAgent(c: { agent?: boolean }): boolean {
  return c.agent === true || mcpMode || !process.stdout.isTTY
}
