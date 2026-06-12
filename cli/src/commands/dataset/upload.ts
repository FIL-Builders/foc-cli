import { readFile } from 'node:fs/promises'
import path from 'node:path'
import * as Piece from '@filoz/synapse-core/piece'
import * as SP from '@filoz/synapse-core/sp'
import { getPDPProvider } from '@filoz/synapse-core/sp-registry'
import { z } from 'incur'
import { privateKeyClient } from '../../client.ts'
import { OutputContext } from '../../output.ts'
import { datasetScannerUrl, hashLink, pieceScannerUrl } from '../../utils.ts'

export const uploadCommand = {
  description:
    'Upload a file to a new dataset (creates dataset + uploads piece)',
  args: z.object({
    path: z.string().describe('File path to upload'),
    providerId: z.coerce
      .number()
      .describe('Provider ID (use provider peers to list)'),
  }),
  options: z.object({
    chain: z
      .number()
      .default(314159)
      .describe('Chain ID. 314159 = Calibration, 314 = Mainnet'),
    cdn: z.boolean().optional().describe('Enable CDN'),
    debug: z.boolean().optional().describe('Enable debug mode'),
  }),
  alias: { chain: 'c' },
  output: z.object({
    pieceCid: z.string(),
    pieceScannerUrl: z.string(),
    dataSetId: z.string(),
    datasetScannerUrl: z.string(),
    pieceIds: z.array(z.string()),
  }),
  examples: [
    {
      args: { path: './myfile.pdf', providerId: 1 },
      description: 'Upload to new dataset with provider #1',
    },
    {
      args: { path: './data.bin', providerId: 1 },
      options: { cdn: true },
      description: 'Upload with CDN',
    },
  ],
  async run(c: any) {
    const out = new OutputContext(c)
    const { client, chain } = privateKeyClient(c.options.chain)

    try {
      out.step('Fetching provider')
      const provider = await getPDPProvider(client, {
        providerId: BigInt(c.args.providerId),
      })
      if (!provider) return out.fail('PROVIDER_NOT_FOUND', 'Provider not found')

      out.step('Reading file')
      const absolutePath = path.resolve(c.args.path)
      const fileData = await readFile(absolutePath)

      out.step('Calculating piece CID')
      const pieceCid = await Piece.calculate(fileData)

      out.step('Uploading to provider')
      await SP.uploadPiece({
        data: fileData,
        serviceURL: provider.pdp.serviceURL,
        pieceCid,
      })
      await SP.findPiece({
        pieceCid,
        serviceURL: provider.pdp.serviceURL,
        poll: true,
      })

      out.step('Creating dataset and adding pieces')
      const rsp = await SP.createDataSetAndAddPieces(client, {
        serviceURL: provider.pdp.serviceURL,
        payee: provider.payee,
        cdn: c.options.cdn ?? false,
        pieces: [{ pieceCid, metadata: { name: path.basename(absolutePath) } }],
      })

      out.step('Waiting for transaction to be mined')
      out.info(`Tx: ${hashLink(rsp.txHash, chain)}`)
      const created = await SP.waitForCreateDataSetAddPieces({
        statusUrl: rsp.statusUrl,
      })

      const cidStr = pieceCid.toString()
      return out.done(
        {
          pieceCid: cidStr,
          pieceScannerUrl: pieceScannerUrl(cidStr, chain),
          dataSetId: created.dataSetId,
          datasetScannerUrl: datasetScannerUrl(created.dataSetId, chain),
          pieceIds: created.piecesIds,
        },
        {
          cta: {
            commands: [
              { command: 'dataset list', description: 'View all datasets' },
              {
                command: 'dataset details',
                args: { dataSetId: created.dataSetId.toString() },
                description: 'View dataset details',
              },
            ],
          },
        }
      )
    } catch (error) {
      if (c.options.debug) console.error(error)
      return out.fail('DATASET_UPLOAD_FAILED', (error as Error).message)
    }
  },
}
