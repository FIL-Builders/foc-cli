import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Synapse } from '@filoz/synapse-sdk'
import type { StorageContext } from '@filoz/synapse-sdk/storage'
import { z } from 'incur'
import type { Hex } from 'viem'
import { privateKeyClient } from '../client.ts'
import { OutputContext } from '../output.ts'
import {
  datasetScannerUrl,
  hashLink,
  pieceScannerUrl,
  txExplorerUrl,
} from '../utils.ts'

type CopyResult = {
  pieceCids: { pieceCid: string; pieceScannerUrl: string; url: string }[]
  pieceIds: string[]
  providerName: string
  dataSetId: string
  datasetScannerUrl: string
  txHash: Hex
  txExplorerUrl: string
}

export const multiUploadCommand = {
  description:
    'Upload multiple readable files to Filecoin warm storage (high-level, recommended)',
  args: z.object({
    paths: z
      .preprocess(
        (val) => (typeof val === 'string' ? val.split(',') : val),
        z.array(z.string())
      )
      .describe('File paths to upload. All paths must be readable.'),
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
  output: z.object({
    status: z.string(),
    results: z.array(
      z.object({
        pieceCids: z.array(
          z.object({
            pieceCid: z.string(),
            pieceScannerUrl: z.string(),
            url: z.string(),
          })
        ),
        pieceIds: z.array(z.string()),
        providerName: z.string(),
        dataSetId: z.string(),
        datasetScannerUrl: z.string(),
        txHash: z.string(),
        txExplorerUrl: z.string(),
      })
    ),
  }),
  examples: [
    {
      args: { paths: ['./myfile.pdf', './myfile2.pdf'] },
      options: { copies: 3, withCDN: true },
      description: 'Upload readable files with auto provider/dataset selection',
    },
    {
      args: { paths: ['./data.bin', './data2.bin'] },
      options: { withCDN: true },
      description: 'Upload with CDN',
    },
    {
      args: {
        paths: ['./myfile.pdf', './myfile2.pdf', './data.bin', './data2.bin'],
      },
      options: { chain: 314 },
      description: 'Upload on mainnet',
    },
  ],
  async run(c: any) {
    const out = new OutputContext(c)
    const { client, chain } = privateKeyClient(c.options.chain)

    try {
      out.step('Reading files')
      const absolutePaths = c.args.paths.map((filePath: string) =>
        path.resolve(filePath)
      )
      const fileResultsSettled = await Promise.allSettled(
        absolutePaths.map((filePath: string) => readFile(filePath))
      )
      const fileReadRejected = fileResultsSettled
        .map((result, index) => ({ result, path: absolutePaths[index] }))
        .filter(({ result }) => result.status === 'rejected')

      if (fileReadRejected.length > 0) {
        return out.fail(
          'FILE_READ_FAILED',
          fileReadRejected
            .map(({ result, path }) => {
              const reason =
                result.status === 'rejected' ? result.reason : undefined
              return `${path}: ${
                reason instanceof Error ? reason.message : String(reason)
              }`
            })
            .join(', ')
        )
      }

      const fileResults = fileResultsSettled
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value)

      const fileStreams = fileResults.map(
        (fileResult) =>
          new ReadableStream({
            start(controller) {
              controller.enqueue(fileResult)
              controller.close()
            },
          })
      )

      const synapse = new Synapse({ client, source: 'foc-cli' })

      out.step('Creating storage contexts')
      const contexts = await synapse.storage.createContexts({
        copies: c.options.copies,
        withCDN: c.options.withCDN,
      })

      out.step('Preparing upload')
      const prep = await synapse.storage.prepare({
        context: contexts,
        dataSize: BigInt(fileResults.reduce((acc, f) => acc + f.byteLength, 0)),
      })

      if (prep.transaction) {
        out.step('Submitting transaction')
        const { hash } = await prep.transaction.execute()
        out.info(`Tx: ${hashLink(hash, chain)}`)
      }

      out.step('Uploading to primary provider')
      const primary = contexts[0]
      const secondary = contexts.slice(1)

      const primaryStoreResultsSettled = await Promise.allSettled(
        fileStreams.map((fileStream) => primary.store(fileStream))
      )
      const primaryStoreResults = primaryStoreResultsSettled
        .filter((r) => r.status === 'fulfilled')
        .map((r) => r.value)
      const primaryStoreRejected = primaryStoreResultsSettled
        .filter((r) => r.status === 'rejected')
        .map((r) => r.reason)

      if (primaryStoreRejected.length > 0) {
        return out.fail('PRIMARY_STORE_FAILED', primaryStoreRejected.join(', '))
      }

      const pieceCids = primaryStoreResults.map((r) => r.pieceCid)

      out.step('Replicating to secondary providers')
      const pullResultsSettled = await Promise.allSettled(
        secondary.map((ctx) =>
          ctx.pull({
            pieces: pieceCids,
            from: primary.provider.pdp.serviceURL,
          })
        )
      )
      const pullRejected = pullResultsSettled
        .filter((r) => r.status === 'rejected')
        .map((r) => r.reason)

      if (pullRejected.length > 0) {
        return out.fail('PULL_TO_SECONDARY_FAILED', pullRejected.join(', '))
      }

      out.step('Committing to all providers')
      const txHashToContextMap = new Map<Hex, StorageContext>()
      const commitResultsSettled = await Promise.allSettled(
        contexts.map((ctx) =>
          ctx.commit({
            pieces: pieceCids.map((pieceCid) => ({ pieceCid })),
            onSubmitted: (txHash) => {
              txHashToContextMap.set(txHash, ctx)
            },
          })
        )
      )
      const commitResults = commitResultsSettled
        .filter((r) => r.status === 'fulfilled')
        .map((r) => r.value)
      const commitRejected = commitResultsSettled
        .filter((r) => r.status === 'rejected')
        .map((r) => r.reason)

      if (commitRejected.length > 0) {
        return out.fail('COMMIT_TO_CONTEXTS_FAILED', commitRejected.join(', '))
      }

      const results: CopyResult[] = []
      for (const [txHash, context] of txHashToContextMap.entries()) {
        const commitResult = commitResults.find((r) => r.txHash === txHash)
        if (!commitResult) continue
        results.push({
          pieceCids: pieceCids.map((pieceCid) => {
            const cidStr = pieceCid.toString()
            return {
              pieceCid: cidStr,
              pieceScannerUrl: pieceScannerUrl(cidStr, chain),
              url: context.getPieceUrl(pieceCid),
            }
          }),
          pieceIds: commitResult.pieceIds.map((id: any) => id.toString()),
          providerName: context.provider.name,
          dataSetId: commitResult.dataSetId.toString(),
          datasetScannerUrl: datasetScannerUrl(commitResult.dataSetId, chain),
          txHash: commitResult.txHash,
          txExplorerUrl: txExplorerUrl(commitResult.txHash, chain),
        })
      }

      return out.done(
        { status: 'uploaded', results },
        {
          cta: {
            description: 'Next steps:',
            commands: [
              { command: 'dataset list', description: 'View all datasets' },
              { command: 'wallet balance', description: 'Check balances' },
            ],
          },
        }
      )
    } catch (error) {
      if (c.options.debug) console.error(error)
      return out.fail(
        'UPLOAD_FAILED',
        error instanceof Error ? error.message : String(error)
      )
    }
  },
}
