import { mock } from 'bun:test'

export function cid(value: string) {
  return {
    toString: () => value,
  }
}

export const fakeChain = {
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

export const fakePublicClient = {
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
  createContexts: mock(async () => []),
  prepare: mock(async () => ({
    transaction: null,
    costs: {
      rate: {
        perMonth: 111n,
      },
      depositNeeded: 222n,
      ready: true,
    },
  })),
  upload: mock(async () => ({
    pieceCid: cid('baga-upload'),
    size: 4,
    copies: [],
    failedAttempts: [],
  })),
}

export const synapseConstructorArgs: any[] = []
export class Synapse {
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

export const getChain = mock((chainId: number) => ({
  ...fakeChain,
  id: chainId,
}))

export const formatBalance = mock(({ value }: { value: bigint }) => {
  return `formatted:${value.toString()}`
})

export const claimTokens = mock(async () => [{ tx_hash: '0xfaucet' }])

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

export const fakeDataSet = {
  dataSetId: 42n,
  clientDataSetId: 100n,
  provider: fakeProvider,
  cdn: true,
  live: true,
  managed: false,
  pdpEndEpoch: 0n,
  activePieceCount: 2n,
  metadata: {
    label: 'dataset',
  },
}

export const getPdpDataSets = mock(async () => [fakeDataSet])
export const getPdpDataSet = mock(async () => fakeDataSet)

export const fakePiece = {
  id: 7n,
  cid: cid('baga-piece'),
  url: 'https://provider.example/piece/baga-piece',
  metadata: {
    name: 'file.txt',
  },
}

export const getPiecesWithMetadata = mock(async () => ({
  pieces: [fakePiece],
}))

export const createDataSet = mock(async () => ({
  txHash: '0xcreate',
}))

export const waitForCreateDataSet = mock(async () => ({
  dataSetId: 42n,
}))

export const uploadPiece = mock(async () => undefined)
export const findPiece = mock(async () => undefined)
export const calculate = mock(() => cid('baga-calculated'))

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
  availableFunds: 1n,
  totalLockup: 2n,
  totalRateBasedLockup: 3n,
  lockupRatePerMonth: 4n,
  funds: 5n,
  epoch: 100n,
  fundedUntilEpoch: 220n,
}))

export const getBlockNumber = mock(async () => 123n)
export const waitForTransactionReceipt = mock(async () => ({
  status: 'success',
}))

mock.module('../src/client.ts', () => ({
  privateKeyClient,
  publicClient,
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
  waitForCreateDataSet,
  waitForCreateDataSetAddPieces,
}))

mock.module('@filoz/synapse-core/piece', () => ({
  calculate,
}))

mock.module('@filoz/synapse-core/pay', () => ({
  getAccountSummary,
}))

mock.module('viem/actions', () => ({
  getBlockNumber,
  waitForTransactionReceipt,
}))

export function resetCommandMocks() {
  mock.clearAllMocks()
  synapseConstructorArgs.length = 0

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
  claimTokens.mockImplementation(async () => [{ tx_hash: '0xfaucet' }])

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

  synapseStorage.createContexts.mockImplementation(async () => [])
  synapseStorage.prepare.mockImplementation(async () => ({
    transaction: null,
    costs: {
      rate: {
        perMonth: 111n,
      },
      depositNeeded: 222n,
      ready: true,
    },
  }))
  synapseStorage.upload.mockImplementation(async () => ({
    pieceCid: cid('baga-upload'),
    size: 4,
    copies: [],
    failedAttempts: [],
  }))
  parseUnits.mockImplementation((value: string) => BigInt(value) * 1_000_000n)

  getPDPProvider.mockImplementation(async () => fakeProvider)
  getApprovedPDPProviders.mockImplementation(async () => [fakeProvider])
  getPdpDataSets.mockImplementation(async () => [fakeDataSet])
  getPdpDataSet.mockImplementation(async () => fakeDataSet)
  getPiecesWithMetadata.mockImplementation(async () => ({
    pieces: [fakePiece],
  }))

  createDataSet.mockImplementation(async () => ({
    txHash: '0xcreate',
  }))
  waitForCreateDataSet.mockImplementation(async () => ({
    dataSetId: 42n,
  }))
  uploadPiece.mockImplementation(async () => undefined)
  findPiece.mockImplementation(async () => undefined)
  calculate.mockImplementation(() => cid('baga-calculated'))
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
    availableFunds: 1n,
    totalLockup: 2n,
    totalRateBasedLockup: 3n,
    lockupRatePerMonth: 4n,
    funds: 5n,
    epoch: 100n,
    fundedUntilEpoch: 220n,
  }))
  getBlockNumber.mockImplementation(async () => 123n)
  waitForTransactionReceipt.mockImplementation(async () => ({
    status: 'success',
  }))
}

resetCommandMocks()
