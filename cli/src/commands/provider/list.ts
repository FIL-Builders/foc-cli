import { getChain } from '@filoz/synapse-core/chains'
import { getApprovedPDPProviders } from '@filoz/synapse-core/sp-registry'
import { formatBalance } from '@filoz/synapse-core/utils'
import { z } from 'incur'
import { publicClient } from '../../client.ts'
import { chainCta, commandOutput, OutputContext } from '../../output.ts'
import { dealbotDashboardUrl, formatBytes } from '../../utils.ts'

export const listCommand = {
  description:
    'List all approved PDP storage providers with full details and performance dashboard',
  mcp: {
    annotations: { title: 'List storage providers', readOnlyHint: true },
  },
  options: z.object({
    chain: z
      .number()
      .default(314159)
      .describe('Chain ID. 314159 = Calibration, 314 = Mainnet'),
    debug: z.boolean().optional().describe('Enable debug mode'),
  }),
  alias: { chain: 'c' },
  output: commandOutput({
    dealbotDashboard: z.string(),
    providers: z.array(
      z.object({
        providerId: z.number(),
        name: z.string(),
        description: z.string(),
        serviceProvider: z.string(),
        payee: z.string(),
        isActive: z.boolean(),
        serviceURL: z.string(),
        location: z.string(),
        minPieceSize: z.string(),
        maxPieceSize: z.string(),
        storagePricePerTibPerDay: z.string(),
        minProvingPeriodInEpochs: z.string(),
        paymentTokenAddress: z.string(),
        ipniPiece: z.boolean(),
        ipniIpfs: z.boolean(),
        ipniPeerId: z.string().optional(),
      })
    ),
  }),
  examples: [
    { description: 'List approved providers on testnet' },
    { options: { chain: 314 }, description: 'List mainnet providers' },
  ],
  async run(c: any) {
    const out = new OutputContext(c)
    const client = publicClient(c.options.chain)
    const chain = getChain(c.options.chain)

    try {
      out.step('Fetching approved providers')
      const rawProviders = await getApprovedPDPProviders(client)

      const providers = rawProviders.map((prov: any) => ({
        providerId: Number(prov.id),
        name: prov.name,
        description: prov.description,
        serviceProvider: prov.serviceProvider,
        payee: prov.payee,
        isActive: prov.isActive,
        serviceURL: prov.pdp.serviceURL,
        location: prov.pdp.location,
        minPieceSize: formatBytes(prov.pdp.minPieceSizeInBytes),
        maxPieceSize: formatBytes(prov.pdp.maxPieceSizeInBytes),
        storagePricePerTibPerDay: formatBalance({
          value: prov.pdp.storagePricePerTibPerDay,
        }),
        minProvingPeriodInEpochs: prov.pdp.minProvingPeriodInEpochs.toString(),
        paymentTokenAddress: prov.pdp.paymentTokenAddress,
        ipniPiece: prov.pdp.ipniPiece,
        ipniIpfs: prov.pdp.ipniIpfs,
        ipniPeerId: prov.pdp.ipniPeerId || undefined,
      }))

      return out.done(
        {
          dealbotDashboard: dealbotDashboardUrl(chain),
          providers,
        },
        {
          cta: chainCta(c.options.chain, {
            commands: [
              {
                command: 'dataset create',
                description: 'Create a dataset with a provider',
              },
              {
                command: 'upload',
                description: 'Upload a file (auto-selects provider)',
              },
            ],
          }),
        }
      )
    } catch (error) {
      if (c.options.debug) console.error(error)
      return out.fail('PROVIDER_LIST_FAILED', (error as Error).message)
    }
  },
}
