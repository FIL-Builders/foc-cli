import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Synapse } from '@filoz/synapse-sdk'
import { z } from 'incur'
import { privateKeyClient } from '../client.ts'
import { OutputContext } from '../output.ts'
import { datasetScannerUrl, hashLink, pieceScannerUrl } from '../utils.ts'

export const uploadCommand = {
  description:
    'Upload a file to Filecoin warm storage (high-level, recommended)',
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
  output: z.object({
    status: z.string(),
    result: z.object({
      pieceCid: z.string(),
      pieceScannerUrl: z.string(),
      size: z.number(),
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
    const { client, chain } = privateKeyClient(c.options.chain)

    try {
      out.step('Reading file')
      const absolutePath = path.resolve(c.args.path)
      const file = await readFile(absolutePath)
      const fileStream = new ReadableStream({
        start(controller) {
          controller.enqueue(file)
          controller.close()
        },
      })

      const synapse = new Synapse({ client, source: 'foc-cli' })

      out.step('Creating storage contexts')
      const contexts = await synapse.storage.createContexts({
        copies: c.options.copies,
        withCDN: c.options.withCDN,
      })

      out.step('Preparing upload')
      const prep = await synapse.storage.prepare({
        context: contexts,
        dataSize: BigInt(file.byteLength),
      })

      if (prep.transaction) {
        out.step('Submitting transaction')
        const { hash } = await prep.transaction.execute()
        out.info(`Tx: ${hashLink(hash, chain)}`)
      }

      out.step('Uploading file')
      const result = await synapse.storage.upload(fileStream, {
        contexts,
        withCDN: c.options.withCDN,
      })

      const cidStr = result.pieceCid.toString()
      const copyResults = result.copies.map((copy: any) => ({
        dataSetId: copy.dataSetId,
        datasetScannerUrl: datasetScannerUrl(copy.dataSetId, chain),
        url: copy.retrievalUrl,
        pieceId: copy.pieceId,
        providerId: copy.providerId,
        isNewDataSet: copy.isNewDataSet,
        providerRole: copy.role,
      }))
      const copyFailures = result.failedAttempts.map((failure: any) => ({
        providerId: failure.providerId,
        role: failure.role,
        error: failure instanceof Error ? failure.message : String(failure),
        explicit: failure.explicit,
      }))

      return out.done({
        status: 'uploaded',
        result: {
          pieceCid: cidStr,
          pieceScannerUrl: pieceScannerUrl(cidStr, chain),
          size: result.size,
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
