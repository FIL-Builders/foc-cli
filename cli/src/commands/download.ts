import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'incur'
import { requireWallet } from '../client.ts'
import { chainCta, commandOutput, OutputContext } from '../output.ts'
import { synapseClient } from '../synapse.ts'
import { pieceScannerUrl } from '../utils.ts'

export const downloadCommand = {
  description:
    'Download a piece by CID and verify the bytes against it (retrieval is cryptographic proof of storage). Writes to --out (default ./<pieceCid>); refuses to overwrite an existing file unless --force is passed.',
  mcp: {
    annotations: {
      title: 'Download and verify a piece',
      // --force can overwrite existing local files, so the tool as a whole
      // must not claim to be non-destructive.
      destructiveHint: true,
      idempotentHint: true,
    },
  },
  args: z.object({
    pieceCid: z
      .string()
      .describe('Piece CID to download (from upload output or piece list)'),
  }),
  options: z.object({
    chain: z
      .number()
      .default(314159)
      .describe('Chain ID. 314159 = Calibration, 314 = Mainnet'),
    out: z
      .string()
      .optional()
      .describe(
        'Output file path (defaults to ./<pieceCid> in the current directory)'
      ),
    withCDN: z.boolean().optional().describe('Prefer CDN retrieval'),
    force: z
      .boolean()
      .optional()
      .describe('Overwrite an existing file at the output path'),
    providerAddress: z
      .string()
      .optional()
      .describe(
        'Retrieve from a specific provider address instead of auto-resolving'
      ),
    debug: z.boolean().optional().describe('Enable debug mode'),
  }),
  alias: { chain: 'c', out: 'o' },
  output: commandOutput({
    pieceCid: z.string(),
    pieceScannerUrl: z.string(),
    size: z.number(),
    verified: z.boolean(),
    path: z.string(),
  }),
  examples: [
    {
      args: { pieceCid: 'baga6ea4seaq...' },
      description: 'Download a piece to ./<pieceCid>',
    },
    {
      args: { pieceCid: 'baga6ea4seaq...' },
      options: { out: './myfile.pdf' },
      description: 'Download to a specific path',
    },
  ],
  // --withCDN and --force are switches; a `true` option value would render as
  // `--withCDN true`, whose `true` the parser drops as a stray positional.
  hint: 'Refuses to overwrite an existing file — re-run with --force to replace it. Add --withCDN to prefer CDN retrieval. Both are switches: pass the flag alone, not `--force true`.',
  async run(c: any) {
    const out = new OutputContext(c)
    const blocked = requireWallet(c, out)
    if (blocked) return blocked
    const { chain, synapse } = synapseClient(c.options.chain)

    let bytes: Uint8Array
    try {
      out.step('Downloading piece')
      // storage.download() retrieves via CDN/chain/provider resolution and
      // validates the bytes against the piece CID — a successful return IS
      // the retrievability + integrity proof.
      bytes = await synapse.storage.download({
        pieceCid: c.args.pieceCid,
        ...(c.options.withCDN !== undefined
          ? { withCDN: c.options.withCDN }
          : {}),
        ...(c.options.providerAddress
          ? { providerAddress: c.options.providerAddress as `0x${string}` }
          : {}),
      })
    } catch (error) {
      if (c.options.debug) console.error(error)
      const message = (error as Error).message
      if (message.includes('Invalid PieceCID')) {
        return out.fail('INVALID_PIECE_CID', message)
      }
      // The bytes arrived but do not hash to the expected piece CID: this is
      // the one failure that must never look like a transient blip — the data
      // at this source is wrong, and retrying the same source cannot fix it.
      if (message.includes('PieceCID verification failed')) {
        return out.fail('INTEGRITY_MISMATCH', message, {
          cta: chainCta(c.options.chain, {
            description: 'The source served corrupt data. Try another route:',
            commands: [
              {
                command: 'download',
                args: { pieceCid: c.args.pieceCid },
                options: { withCDN: !c.options.withCDN },
                description: 'Retry via a different retrieval route',
              },
              {
                command: 'provider list',
                description: 'Pick a specific provider (--providerAddress)',
              },
            ],
          }),
        })
      }
      // Deterministic input error: the given --providerAddress is not a
      // registered provider. Retrying cannot help.
      if (c.options.providerAddress && message.includes('not found')) {
        return out.fail('PROVIDER_NOT_FOUND', message)
      }
      // Remaining failures are transient retrieval problems (provider
      // unreachable, CDN cache miss) — flag retryable so agents re-attempt.
      return out.fail('DOWNLOAD_FAILED', message, { retryable: true })
    }

    const outputPath = path.resolve(c.options.out ?? c.args.pieceCid)
    try {
      out.step('Writing file')
      // Exclusive creation by default ('wx'): silently clobbering local data
      // is the one destructive thing this read-mostly command could do. An
      // explicit --force opts into overwriting.
      await writeFile(outputPath, bytes, c.options.force ? {} : { flag: 'wx' })

      return out.done(
        {
          pieceCid: c.args.pieceCid,
          pieceScannerUrl: pieceScannerUrl(c.args.pieceCid, chain),
          size: bytes.length,
          verified: true,
          path: outputPath,
        },
        {
          cta: chainCta(c.options.chain, {
            commands: [
              {
                command: 'piece list',
                description:
                  'List piece CIDs in a dataset to download/verify more',
              },
              {
                command: 'dataset list',
                description: 'List your datasets',
              },
            ],
          }),
        }
      )
    } catch (error) {
      if (c.options.debug) console.error(error)
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return out.fail(
          'FILE_EXISTS',
          `${outputPath} already exists. Pass --force to overwrite it, or --out to write elsewhere.`,
          {
            cta: chainCta(c.options.chain, {
              commands: [
                {
                  // --force is a switch, so it goes in the command string:
                  // `{ force: true }` would render as `--force <force>`.
                  command: 'download --force',
                  args: { pieceCid: c.args.pieceCid },
                  options: {
                    ...(c.options.out ? { out: c.options.out } : {}),
                  },
                  description: 'Overwrite the existing file',
                },
              ],
            }),
          }
        )
      }
      // The piece downloaded and validated; only the local write failed
      // (permissions, missing directory, disk full). Not a retrieval problem.
      return out.fail(
        'WRITE_FAILED',
        `Downloaded and validated ${bytes.length} bytes, but writing ${outputPath} failed: ${(error as Error).message}`
      )
    }
  },
}
