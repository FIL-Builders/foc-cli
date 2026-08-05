import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { FailedAttempt } from '@filoz/synapse-sdk'
import { z } from 'incur'
import { requireWallet } from '../client.ts'
import { commandOutput, OutputContext } from '../output.ts'
import { selectHealthyProviders } from '../provider-selection.ts'
import { synapseClient } from '../synapse.ts'
import { datasetScannerUrl, hashLink, pieceScannerUrl } from '../utils.ts'

export const uploadCommand = {
  description:
    'Upload a file to Filecoin warm storage (high-level, recommended). Commits USDFC from the payment account via an onchain transaction; defaults to Calibration testnet.',
  mcp: {
    annotations: {
      title: 'Upload file to Filecoin (spends USDFC)',
      destructiveHint: false,
    },
  },
  args: z.object({
    path: z.string().describe('File path to upload'),
  }),
  options: z.object({
    chain: z
      .number()
      .default(314159)
      .describe('Chain ID. 314159 = Calibration, 314 = Mainnet'),
    copies: z
      .number()
      .default(2)
      .optional()
      .describe('Number of copies to create for each file'),
    withCDN: z.boolean().optional().describe('Enable CDN for the upload'),
    debug: z.boolean().optional().describe('Enable debug mode'),
  }),
  alias: { chain: 'c' },
  output: commandOutput({
    status: z.string(),
    result: z.object({
      pieceCid: z.string(),
      pieceScannerUrl: z.string(),
      size: z.number(),
      requestedCopies: z.number(),
      complete: z.boolean(),
      copyResults: z.array(
        z.object({
          dataSetId: z.string(),
          datasetScannerUrl: z.string(),
          url: z.string(),
          pieceId: z.string(),
          providerId: z.string(),
          isNewDataSet: z.boolean(),
          providerRole: z.string(),
        })
      ),
      copyFailures: z.array(
        z.object({
          providerId: z.string(),
          role: z.string(),
          error: z.string(),
          explicit: z.boolean(),
        })
      ),
    }),
  }),
  examples: [
    {
      args: { path: './myfile.pdf' },
      options: { copies: 3, withCDN: true },
      description: 'Upload with auto provider/dataset selection',
    },
    {
      args: { path: './myfile.pdf' },
      options: { withCDN: true },
      description: 'Upload with CDN',
    },
    {
      args: { path: './data.bin' },
      options: { chain: 314 },
      description: 'Upload on mainnet',
    },
  ],
  async run(c: any) {
    const out = new OutputContext(c)
    const blocked = requireWallet(c, out)
    if (blocked) return blocked
    const { client, chain, synapse } = synapseClient(c.options.chain)

    try {
      out.step('Opening file')
      // Stream the file straight through Synapse to the primary provider —
      // never buffer the whole piece in memory. Only the size is needed up
      // front (for prepare), which stat provides without reading a byte.
      const absolutePath = path.resolve(c.args.path)
      const stats = await stat(absolutePath)
      // stat() succeeds for directories, FIFOs, sockets, and devices — their
      // size would flow into prepare() and a funding transaction could execute
      // before createReadStream errored or blocked. Reject non-regular files
      // here, before any provider selection or onchain spend.
      if (!stats.isFile()) {
        return out.fail(
          'NOT_A_FILE',
          `${absolutePath} is not a regular file. Pass a path to a readable file.`
        )
      }
      const { size } = stats

      out.step('Checking provider health')
      const selection = await selectHealthyProviders(
        client,
        c.options.copies ?? 2
      )
      if (selection.usedUnendorsedPrimary) {
        out.info(
          `No endorsed provider reachable — using approved provider ${selection.primaryName} for the primary copy.`
        )
      }
      if (selection.reducedCopies) {
        out.info(
          `Storing ${selection.selectedCopies} of ${selection.requestedCopies} requested copies (${selection.reachableCount} of ${selection.approvedCount} providers reachable).`
        )
      }

      out.step('Creating storage contexts')
      const contexts = await synapse.storage.createContexts({
        providerIds: selection.providerIds,
        withCDN: c.options.withCDN,
      })

      out.step('Preparing upload')
      const prep = await synapse.storage.prepare({
        context: contexts,
        dataSize: BigInt(size),
      })

      if (prep.transaction) {
        out.step('Submitting transaction')
        const { hash } = await prep.transaction.execute()
        out.info(`Tx: ${hashLink(hash, chain)}`)
      }

      out.step('Uploading file')
      // Open the stream only now — immediately before it is consumed — so a
      // file that vanished or changed since stat surfaces here, not earlier.
      const fileStream = Readable.toWeb(createReadStream(absolutePath))
      // CDN preference is already baked into the contexts; the SDK rejects
      // upload({ contexts, withCDN }) outright, so pass contexts alone.
      const result = await synapse.storage.upload(fileStream, { contexts })

      const cidStr = result.pieceCid.toString()
      const copyResults = result.copies.map((copy) => ({
        dataSetId: copy.dataSetId.toString(),
        datasetScannerUrl: datasetScannerUrl(copy.dataSetId, chain),
        url: copy.retrievalUrl,
        pieceId: copy.pieceId.toString(),
        providerId: copy.providerId.toString(),
        isNewDataSet: copy.isNewDataSet,
        providerRole: copy.role,
      }))
      const copyFailures = result.failedAttempts.map((failure) => ({
        providerId: failure.providerId.toString(),
        role: failure.role,
        error: formatFailedAttemptError(failure),
        explicit: Boolean(failure.explicit),
      }))

      return out.done({
        status: result.complete ? 'uploaded' : 'partially_uploaded',
        result: {
          pieceCid: cidStr,
          pieceScannerUrl: pieceScannerUrl(cidStr, chain),
          size: result.size,
          requestedCopies: result.requestedCopies,
          complete: result.complete,
          copyResults,
          copyFailures,
        },
      })
    } catch (error) {
      if (c.options.debug) console.error(error)
      return out.fail('UPLOAD_FAILED', (error as Error).message)
    }
  },
}

function formatFailedAttemptError(failure: FailedAttempt | Error | unknown) {
  if (failure instanceof Error) return failure.message
  if (failure && typeof failure === 'object' && 'error' in failure) {
    const error = failure.error
    if (error instanceof Error) return error.message
    if (error !== undefined && error !== null) return String(error)
  }
  return String(failure)
}
