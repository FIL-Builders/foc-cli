import { mock } from 'bun:test'
import * as viemActions from 'viem/actions'

export function cid(value: string) {
  return {
    toString: () => value,
  }
}

const fakeChain = {
  id: 314159,
  blockExplorers: {
    default: {
      url: 'https://calibration.filfox.info/en',
    },
  },
}

export const fakeWalletClient = {
  account: {
    address: '0x0000000000000000000000000000000000000123',
  },
}

const fakePublicClient = {
  name: 'public-client',
}

export const synapseWaitForTransactionReceipt = mock(async () => ({
  status: 'success',
}))

export const synapsePayments = {
  walletBalance: mock(async (options?: { token?: string }) =>
    options?.token ? 2000n : 1000n
  ),
  accountInfo: mock(async () => ({
    availableFunds: 3000n,
    lockupCurrent: 4000n,
    lockupRate: 5000n,
    lockupLastSettledAt: 6000n,
    funds: 7000n,
  })),
  depositWithPermitAndApproveOperator: mock(async () => '0xdeposit'),
  withdraw: mock(async () => '0xwithdraw'),
}

export const synapseStorage = {
  createContext: mock(async (options: any) => ({
    dataSetId: options?.dataSetId,
  })),
  createContexts: mock(async () => []),
  prepare: mock(async () => ({
    transaction: null,
    costs: {
      rates: {
        perEpoch: 11n,
        perMonth: 111n,
      },
      depositNeeded: 222n,
      ready: true,
      needsFwssMaxApproval: false,
    },
  })),
  upload: mock(async () => ({
    pieceCid: cid('baga-upload'),
    size: 4,
    requestedCopies: 0,
    complete: true,
    copies: [],
    failedAttempts: [],
  })),
  download: mock(async () => new Uint8Array([1, 2, 3, 4])),
}

export const synapseConstructorArgs: any[] = []
class Synapse {
  client: { waitForTransactionReceipt: typeof synapseWaitForTransactionReceipt }
  payments: typeof synapsePayments
  storage: typeof synapseStorage

  constructor(options: any) {
    synapseConstructorArgs.push(options)
    this.client = {
      waitForTransactionReceipt: synapseWaitForTransactionReceipt,
    }
    this.payments = synapsePayments
    this.storage = synapseStorage
  }
}

export const parseUnits = mock((value: string) => BigInt(value) * 1_000_000n)

export const privateKeyClient = mock(() => ({
  client: fakeWalletClient,
  chain: fakeChain,
}))

export const publicClient = mock(() => fakePublicClient)

const getChain = mock((chainId: number) => ({
  ...fakeChain,
  id: chainId,
}))

export const formatBalance = mock(({ value }: { value: bigint }) => {
  return `formatted:${value.toString()}`
})

export const claimTokens = mock(async () => [
  { faucetInfo: 'CalibnetUSDFC', tx_hash: '0xusdfc' },
  { faucetInfo: 'CalibnetFIL', tx_hash: '0xfil' },
])

export const fakeProvider = {
  id: 77n,
  name: 'Provider 77',
  description: 'Fast provider',
  serviceProvider: 'f077',
  payee: '0x0000000000000000000000000000000000000777',
  isActive: true,
  pdp: {
    serviceURL: 'https://provider.example',
    location: 'Earth',
    minPieceSizeInBytes: 1024n,
    maxPieceSizeInBytes: 1024n * 1024n,
    storagePricePerTibPerDay: 99n,
    minProvingPeriodInEpochs: 2880n,
    paymentTokenAddress: '0x0000000000000000000000000000000000000abc',
    ipniPiece: true,
    ipniIpfs: false,
    ipniPeerId: '12D3KooWProvider',
  },
}

export const getPDPProvider = mock(async () => fakeProvider)
export const getApprovedPDPProviders = mock(async () => [fakeProvider])

// Provider universe for pre-flight health selection. Three endorsed, reachable
// providers so `--copies` up to 3 resolves without a shortfall.
export const fakeProviderSelectionInput = {
  providers: [
    {
      id: 77n,
      name: 'Provider 77',
      pdp: { serviceURL: 'https://provider.example' },
    },
    {
      id: 79n,
      name: 'Provider 79',
      pdp: { serviceURL: 'https://provider79.example' },
    },
    {
      id: 80n,
      name: 'Provider 80',
      pdp: { serviceURL: 'https://provider80.example' },
    },
  ],
  endorsedIds: [77n, 79n, 80n],
  clientDataSets: [],
}

export const fetchProviderSelectionInput = mock(
  async () => fakeProviderSelectionInput
)

// Provider health checks GET {serviceURL}/pdp/ping via global fetch; mock it so
// every provider answers 200 (reachable) by default.
export const fetchMock = mock(
  async (_url: string | URL): Promise<Response> =>
    new Response(null, { status: 200 })
)
globalThis.fetch = fetchMock as unknown as typeof fetch

export const fakeDataSet = {
  dataSetId: 42n,
  clientDataSetId: 100n,
  provider: fakeProvider,
  cdn: true,
  live: true,
  managed: false,
  pdpEndEpoch: 0n,
  hasActivePieces: true,
  metadata: {
    label: 'dataset',
  },
}

export const getPdpDataSets = mock(async () => ({ items: [fakeDataSet] }))
export const getPdpDataSet = mock(async () => fakeDataSet)

const fakePiece = {
  id: 7n,
  cid: cid('baga-piece'),
  url: 'https://provider.example/piece/baga-piece',
  metadata: {
    name: 'file.txt',
  },
}

export const getPiecesWithMetadata = mock(async () => ({
  items: [fakePiece],
}))

export const createDataSet = mock(async () => ({
  txHash: '0xcreate',
  statusUrl: 'https://provider.example/status',
}))

export const waitForCreateDataSet = mock(async () => ({
  dataSetId: 42n,
}))

export const uploadPiece = mock(async () => undefined)
export const uploadPieceStreaming = mock(async () => ({
  pieceCid: cid('baga-calculated'),
  size: 5,
}))
export const findPiece = mock(async () => undefined)
export const calculate = mock(async () => cid('baga-calculated'))

export const createDataSetAndAddPieces = mock(async () => ({
  txHash: '0xdatasetupload',
  statusUrl: 'https://provider.example/status',
}))

export const waitForCreateDataSetAddPieces = mock(async () => ({
  dataSetId: 43n,
  piecesIds: [8n],
}))

export const schedulePieceDeletion = mock(async () => ({
  hash: '0xremove',
}))

export const terminateServiceSync = mock(async (_client: any, options: any) => {
  options.onHash?.('0xterminate')
  return {
    event: {
      args: {
        dataSetId: options.dataSetId,
      },
    },
  }
})

export const getAccountSummary = mock(async () => ({
  funds: 5n,
  availableFunds: 1n,
  debt: 0n,
  lockupRatePerEpoch: 6n,
  lockupRatePerMonth: 4n,
  totalLockup: 2n,
  totalFixedLockup: 7n,
  totalRateBasedLockup: 3n,
  runwayInEpochs: 120n,
  grossCoverageInEpochs: 240n,
  epoch: 100n,
}))

export const getBlockNumber = mock(async () => 123n)
export const waitForTransactionReceipt = mock(async () => ({
  status: 'success',
}))

export const configStore = {
  path: '/tmp/foc-cli-test-config.json',
  get: mock((_key: string): string | undefined => undefined),
  set: mock((_key: string, _value: string) => {}),
  delete: mock((_key: string) => {}),
}

mock.module('../src/config.ts', () => ({ default: configStore }))

// The real isAgent() ORs in !process.stdout.isTTY, which is always true under
// the test runner — every command context would count as agent mode. Pin it
// to the context flag so tests can exercise both modes deliberately.
//
// canPrompt() needs the same treatment for the same reason: the runner gives
// the process no TTY on any descriptor, so it would answer "no terminal" for
// every context and make the two keystore branches indistinguishable. Pinning
// it to the inverse of the agent flag is what the two mean on a real machine —
// and keeping them separate here is the point, since conflating them is the
// bug these mocks are standing in for.
const realUtils = await import('../src/utils.ts')
mock.module('../src/utils.ts', () => ({
  ...realUtils,
  isAgent: (c: { agent?: boolean }) => c.agent === true,
  canPrompt: (c: { agent?: boolean }) => c.agent !== true,
}))

// Provider availability is a PATH scan in the real module, which would make
// call-to-action assertions depend on whether the test machine happens to have
// clawdi installed. Tests set this explicitly instead.
export const availableProvidersMock = mock((): string[] => [])

const realKeyRef = await import('../src/key-ref.ts')
mock.module('../src/key-ref.ts', () => ({
  ...realKeyRef,
  availableProviders: availableProvidersMock,
  isProviderAvailable: (name: string) =>
    availableProvidersMock().includes(name),
}))

const mockKeySource = () =>
  configStore.get('keyRef')
    ? 'keyRef'
    : configStore.get('keystore')
      ? 'keystore'
      : configStore.get('privateKey')
        ? 'privateKey'
        : 'none'

// Commands run against a usable wallet unless a test says otherwise — the
// preflight is a PATH scan over the real machine, which would otherwise decide
// the outcome of every command test. The guard's own behaviour is covered
// against the real implementation in preflight.test.ts; what these tests need
// from it is the ability to make it fire, so a command can be checked for
// actually consulting it.
export const walletPreflightMock = mock((_c: { agent?: boolean }): any => null)

mock.module('../src/client.ts', () => ({
  privateKeyClient,
  publicClient,
  // Both read the mocked config store, so they report whatever a test sets up.
  keySource: mockKeySource,
  walletPreflight: walletPreflightMock,
  // The real wiring, so a command that calls the guard produces the real
  // failure envelope rather than a shape only these tests would ever see.
  requireWallet: (c: { agent?: boolean }, out: any) => {
    const problem = walletPreflightMock(c)
    return problem
      ? out.fail(problem.code, problem.message, {
          cta: problem.cta,
          retryable: problem.retryable,
        })
      : null
  },
}))

mock.module('@filoz/synapse-sdk', () => ({
  Synapse,
  TOKENS: {
    USDFC: 'USDFC',
  },
  parseUnits,
}))

mock.module('@filoz/synapse-core/chains', () => ({
  getChain,
}))

mock.module('@filoz/synapse-core/utils', () => ({
  claimTokens,
  formatBalance,
}))

mock.module('@filoz/synapse-core/sp-registry', () => ({
  getApprovedPDPProviders,
  getPDPProvider,
}))

mock.module('@filoz/synapse-core/warm-storage', () => ({
  getPdpDataSet,
  getPdpDataSets,
  terminateServiceSync,
  fetchProviderSelectionInput,
}))

mock.module('@filoz/synapse-core/pdp-verifier', () => ({
  getPiecesWithMetadata,
}))

mock.module('@filoz/synapse-core/sp', () => ({
  createDataSet,
  createDataSetAndAddPieces,
  findPiece,
  schedulePieceDeletion,
  uploadPiece,
  uploadPieceStreaming,
  waitForCreateDataSet,
  waitForCreateDataSetAddPieces,
}))

mock.module('@filoz/synapse-core/piece', () => ({
  calculate,
}))

mock.module('@filoz/synapse-core/pay', () => ({
  getAccountSummary,
}))

// Spread the real module: the root '@filoz/synapse-core' entry (imported for
// paginate) transitively pulls other viem actions, and a two-export mock made
// that import fail with "Export named 'readContract' not found".
mock.module('viem/actions', () => ({
  ...viemActions,
  getBlockNumber,
  waitForTransactionReceipt,
}))

export function resetCommandMocks() {
  mock.clearAllMocks()
  synapseConstructorArgs.length = 0

  configStore.get.mockImplementation(() => undefined)
  configStore.set.mockImplementation(() => {})
  configStore.delete.mockImplementation(() => {})

  // Default to a machine with no secret manager installed, so a test that
  // asserts on key-reference guidance has to opt in deliberately.
  availableProvidersMock.mockImplementation(() => [])

  walletPreflightMock.mockImplementation(() => null)

  privateKeyClient.mockImplementation(() => ({
    client: fakeWalletClient,
    chain: fakeChain,
  }))
  publicClient.mockImplementation(() => fakePublicClient)
  getChain.mockImplementation((chainId: number) => ({
    ...fakeChain,
    id: chainId,
  }))

  formatBalance.mockImplementation(({ value }: { value: bigint }) => {
    return `formatted:${value.toString()}`
  })
  claimTokens.mockImplementation(async () => [
    { faucetInfo: 'CalibnetUSDFC', tx_hash: '0xusdfc' },
    { faucetInfo: 'CalibnetFIL', tx_hash: '0xfil' },
  ])

  synapsePayments.walletBalance.mockImplementation(
    async (options?: { token?: string }) => (options?.token ? 2000n : 1000n)
  )
  synapsePayments.accountInfo.mockImplementation(async () => ({
    availableFunds: 3000n,
    lockupCurrent: 4000n,
    lockupRate: 5000n,
    lockupLastSettledAt: 6000n,
    funds: 7000n,
  }))
  synapsePayments.depositWithPermitAndApproveOperator.mockImplementation(
    async () => '0xdeposit'
  )
  synapsePayments.withdraw.mockImplementation(async () => '0xwithdraw')
  synapseWaitForTransactionReceipt.mockImplementation(async () => ({
    status: 'success',
  }))

  synapseStorage.createContext.mockImplementation(async (options: any) => ({
    dataSetId: options?.dataSetId,
  }))
  synapseStorage.createContexts.mockImplementation(async () => [])
  synapseStorage.prepare.mockImplementation(async () => ({
    transaction: null,
    costs: {
      rates: {
        perEpoch: 11n,
        perMonth: 111n,
      },
      depositNeeded: 222n,
      ready: true,
      needsFwssMaxApproval: false,
    },
  }))
  synapseStorage.upload.mockImplementation(async (_data: any, options: any) => {
    // Mirror the pinned SDK's _resolveUploadContexts guard: contexts are
    // exclusive with the options they were built from. Keeping the guard in
    // the mock makes every upload test a regression against that contract.
    if (options?.contexts != null) {
      const invalid = ['providerIds', 'dataSetIds', 'withCDN'].filter(
        (key) => options[key] !== undefined
      )
      if (invalid.length > 0) {
        throw new Error(
          `Cannot specify both 'contexts' and other options: ${invalid.join(', ')}`
        )
      }
    }
    return {
      pieceCid: cid('baga-upload'),
      size: 4,
      copies: [],
      failedAttempts: [],
    }
  })
  synapseStorage.download.mockImplementation(
    async () => new Uint8Array([1, 2, 3, 4])
  )
  parseUnits.mockImplementation((value: string) => BigInt(value) * 1_000_000n)

  getPDPProvider.mockImplementation(async () => fakeProvider)
  getApprovedPDPProviders.mockImplementation(async () => [fakeProvider])
  fetchProviderSelectionInput.mockImplementation(
    async () => fakeProviderSelectionInput
  )
  fetchMock.mockImplementation(async () => new Response(null, { status: 200 }))
  getPdpDataSets.mockImplementation(async () => ({ items: [fakeDataSet] }))
  getPdpDataSet.mockImplementation(async () => fakeDataSet)
  getPiecesWithMetadata.mockImplementation(async () => ({
    items: [fakePiece],
  }))

  createDataSet.mockImplementation(async () => ({
    txHash: '0xcreate',
    statusUrl: 'https://provider.example/status',
  }))
  waitForCreateDataSet.mockImplementation(async () => ({
    dataSetId: 42n,
  }))
  uploadPiece.mockImplementation(async () => undefined)
  uploadPieceStreaming.mockImplementation(async () => ({
    pieceCid: cid('baga-calculated'),
    size: 5,
  }))
  findPiece.mockImplementation(async () => undefined)
  calculate.mockImplementation(async () => cid('baga-calculated'))
  createDataSetAndAddPieces.mockImplementation(async () => ({
    txHash: '0xdatasetupload',
    statusUrl: 'https://provider.example/status',
  }))
  waitForCreateDataSetAddPieces.mockImplementation(async () => ({
    dataSetId: 43n,
    piecesIds: [8n],
  }))
  schedulePieceDeletion.mockImplementation(async () => ({
    hash: '0xremove',
  }))
  terminateServiceSync.mockImplementation(
    async (_client: any, options: any) => {
      options.onHash?.('0xterminate')
      return {
        event: {
          args: {
            dataSetId: options.dataSetId,
          },
        },
      }
    }
  )
  getAccountSummary.mockImplementation(async () => ({
    funds: 5n,
    availableFunds: 1n,
    debt: 0n,
    lockupRatePerEpoch: 6n,
    lockupRatePerMonth: 4n,
    totalLockup: 2n,
    totalFixedLockup: 7n,
    totalRateBasedLockup: 3n,
    runwayInEpochs: 120n,
    grossCoverageInEpochs: 240n,
    epoch: 100n,
  }))
  getBlockNumber.mockImplementation(async () => 123n)
  waitForTransactionReceipt.mockImplementation(async () => ({
    status: 'success',
  }))
}

resetCommandMocks()
