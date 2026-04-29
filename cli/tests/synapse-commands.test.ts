import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  calculate,
  cid,
  claimTokens,
  createDataSet,
  createDataSetAndAddPieces,
  fakeProvider,
  fakeWalletClient,
  findPiece,
  formatBalance,
  getAccountSummary,
  getApprovedPDPProviders,
  getBlockNumber,
  getPDPProvider,
  getPdpDataSet,
  getPdpDataSets,
  getPiecesWithMetadata,
  parseUnits,
  privateKeyClient,
  publicClient,
  resetCommandMocks,
  schedulePieceDeletion,
  synapseConstructorArgs,
  synapsePayments,
  synapseStorage,
  synapseWaitForTransactionReceipt,
  terminateServiceSync,
  uploadPiece,
  waitForCreateDataSet,
  waitForCreateDataSetAddPieces,
  waitForTransactionReceipt,
} from './command-mocks.ts'

const { uploadCommand } = await import('../src/commands/upload.ts')
const { multiUploadCommand } = await import('../src/commands/multi-upload.ts')
const { balanceCommand } = await import('../src/commands/wallet/balance.ts')
const { costsCommand } = await import('../src/commands/wallet/costs.ts')
const { depositCommand } = await import('../src/commands/wallet/deposit.ts')
const { fundCommand } = await import('../src/commands/wallet/fund.ts')
const { summaryCommand } = await import('../src/commands/wallet/summary.ts')
const { withdrawCommand } = await import('../src/commands/wallet/withdraw.ts')
const { listCommand: providerListCommand } = await import(
  '../src/commands/provider/list.ts'
)
const { createCommand: datasetCreateCommand } = await import(
  '../src/commands/dataset/create.ts'
)
const { detailsCommand: datasetDetailsCommand } = await import(
  '../src/commands/dataset/details.ts'
)
const { listCommand: datasetListCommand } = await import(
  '../src/commands/dataset/list.ts'
)
const { terminateCommand: datasetTerminateCommand } = await import(
  '../src/commands/dataset/terminate.ts'
)
const { uploadCommand: datasetUploadCommand } = await import(
  '../src/commands/dataset/upload.ts'
)
const { listCommand: pieceListCommand } = await import(
  '../src/commands/piece/list.ts'
)
const { removeCommand: pieceRemoveCommand } = await import(
  '../src/commands/piece/remove.ts'
)

const tempDirs: string[] = []

function commandContext({
  args = {},
  options = {},
}: {
  args?: Record<string, any>
  options?: Record<string, any>
} = {}) {
  return {
    agent: true,
    args,
    options: {
      chain: 314159,
      ...options,
    },
    ok(data: any) {
      return data
    },
    error(data: any) {
      return data
    },
  }
}

async function tempFile(name: string, contents: string) {
  const dir = await mkdtemp(path.join(tmpdir(), 'foc-cli-test-'))
  tempDirs.push(dir)
  const filePath = path.join(dir, name)
  await writeFile(filePath, contents)
  return filePath
}

beforeEach(() => {
  resetCommandMocks()
})

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) await rm(dir, { recursive: true, force: true })
  }
})

describe('top-level upload commands', () => {
  test('upload prepares storage, executes funding, uploads, and maps copy results', async () => {
    const filePath = await tempFile('upload.txt', 'data')
    const contexts = [{ id: 'ctx-primary' }]
    const execute = mock(async () => ({ hash: '0xprepare' }))

    synapseStorage.createContexts.mockImplementation(async () => contexts)
    synapseStorage.prepare.mockImplementation(async () => ({
      transaction: { execute },
    }))
    synapseStorage.upload.mockImplementation(async () => ({
      pieceCid: cid('baga-upload'),
      size: 4,
      copies: [
        {
          dataSetId: 42n,
          retrievalUrl: 'https://provider.example/piece/baga-upload',
          pieceId: 7n,
          providerId: 77n,
          isNewDataSet: true,
          role: 'primary',
        },
      ],
      failedAttempts: [
        {
          providerId: 78n,
          role: 'secondary',
          error: 'temporarily unavailable',
          explicit: false,
          toString() {
            return this.error
          },
        },
      ],
    }))

    const result = await uploadCommand.run(
      commandContext({
        args: { path: filePath },
        options: { copies: 3, withCDN: true },
      })
    )

    expect(privateKeyClient).toHaveBeenCalledWith(314159)
    expect(synapseConstructorArgs).toEqual([
      { client: fakeWalletClient, source: 'foc-cli' },
    ])
    expect(synapseStorage.createContexts).toHaveBeenCalledWith({
      copies: 3,
      withCDN: true,
    })
    expect(synapseStorage.prepare).toHaveBeenCalledWith({
      context: contexts,
      dataSize: 4n,
    })
    expect(execute).toHaveBeenCalled()
    expect(synapseStorage.upload).toHaveBeenCalledWith(expect.anything(), {
      contexts,
      withCDN: true,
    })
    expect(result.status).toBe('uploaded')
    expect(result.result).toEqual({
      pieceCid: 'baga-upload',
      pieceScannerUrl: 'https://pdp.vxb.ai/calibration/piece/baga-upload',
      size: 4,
      copyResults: [
        {
          dataSetId: '42',
          datasetScannerUrl: 'https://pdp.vxb.ai/calibration/dataset/42',
          url: 'https://provider.example/piece/baga-upload',
          pieceId: '7',
          providerId: '77',
          isNewDataSet: true,
          providerRole: 'primary',
        },
      ],
      copyFailures: [
        {
          providerId: '78',
          role: 'secondary',
          error: 'temporarily unavailable',
          explicit: false,
        },
      ],
    })
  })

  test('multi-upload stores pieces with the primary provider, pulls to secondaries, and commits every context', async () => {
    const first = await tempFile('first.txt', 'one')
    const second = await tempFile('second.txt', 'two')
    const pieceCids = [cid('baga-one'), cid('baga-two')]
    const primary = {
      provider: {
        name: 'Primary',
        pdp: { serviceURL: 'https://primary.example' },
      },
      store: mock(async () => ({ pieceCid: pieceCids.shift() })),
      pull: mock(async () => undefined),
      commit: mock(async ({ onSubmitted }: any) => {
        onSubmitted('0xprimary')
        return { txHash: '0xprimary', pieceIds: [1n, 2n], dataSetId: 11n }
      }),
      getPieceUrl: (pieceCid: any) =>
        `https://primary.example/piece/${pieceCid.toString()}`,
    }
    const secondary = {
      provider: {
        name: 'Secondary',
        pdp: { serviceURL: 'https://secondary.example' },
      },
      store: mock(async () => undefined),
      pull: mock(async () => undefined),
      commit: mock(async ({ onSubmitted }: any) => {
        onSubmitted('0xsecondary')
        return { txHash: '0xsecondary', pieceIds: [3n, 4n], dataSetId: 12n }
      }),
      getPieceUrl: (pieceCid: any) =>
        `https://secondary.example/piece/${pieceCid.toString()}`,
    }

    synapseStorage.createContexts.mockImplementation(async () => [
      primary,
      secondary,
    ])

    const result = await multiUploadCommand.run(
      commandContext({
        args: { paths: [first, second] },
        options: { copies: 2, withCDN: false },
      })
    )

    expect(synapseStorage.prepare).toHaveBeenCalledWith({
      context: [primary, secondary],
      dataSize: 6n,
    })
    expect(primary.store).toHaveBeenCalledTimes(2)
    expect(secondary.pull).toHaveBeenCalledWith({
      pieces: [expect.anything(), expect.anything()],
      from: 'https://primary.example',
    })
    expect(primary.commit).toHaveBeenCalled()
    expect(secondary.commit).toHaveBeenCalled()
    expect(result.status).toBe('uploaded')
    expect(result.results).toEqual([
      {
        pieceCids: [
          {
            pieceCid: 'baga-one',
            pieceScannerUrl: 'https://pdp.vxb.ai/calibration/piece/baga-one',
            url: 'https://primary.example/piece/baga-one',
          },
          {
            pieceCid: 'baga-two',
            pieceScannerUrl: 'https://pdp.vxb.ai/calibration/piece/baga-two',
            url: 'https://primary.example/piece/baga-two',
          },
        ],
        pieceIds: ['1', '2'],
        providerName: 'Primary',
        dataSetId: '11',
        datasetScannerUrl: 'https://pdp.vxb.ai/calibration/dataset/11',
        txHash: '0xprimary',
        txExplorerUrl: 'https://calibration.filfox.info/en/tx/0xprimary',
      },
      {
        pieceCids: [
          {
            pieceCid: 'baga-one',
            pieceScannerUrl: 'https://pdp.vxb.ai/calibration/piece/baga-one',
            url: 'https://secondary.example/piece/baga-one',
          },
          {
            pieceCid: 'baga-two',
            pieceScannerUrl: 'https://pdp.vxb.ai/calibration/piece/baga-two',
            url: 'https://secondary.example/piece/baga-two',
          },
        ],
        pieceIds: ['3', '4'],
        providerName: 'Secondary',
        dataSetId: '12',
        datasetScannerUrl: 'https://pdp.vxb.ai/calibration/dataset/12',
        txHash: '0xsecondary',
        txExplorerUrl: 'https://calibration.filfox.info/en/tx/0xsecondary',
      },
    ])
  })

  test('multi-upload fails when any requested file cannot be read instead of silently uploading the readable subset', async () => {
    const readable = await tempFile('readable.txt', 'ok')
    const missing = path.join(path.dirname(readable), 'missing.txt')

    const result = await multiUploadCommand.run(
      commandContext({
        args: { paths: [readable, missing] },
      })
    )

    expect(result.error.code).toBe('FILE_READ_FAILED')
    expect(result.error.message).toContain(missing)
    expect(synapseStorage.createContexts).not.toHaveBeenCalled()
    expect(synapseStorage.upload).not.toHaveBeenCalled()
  })
})

describe('wallet commands', () => {
  test('wallet balance reads FIL, USDFC, and payment account balances', async () => {
    const result = await balanceCommand.run(commandContext())

    expect(synapsePayments.walletBalance).toHaveBeenNthCalledWith(1)
    expect(synapsePayments.walletBalance).toHaveBeenNthCalledWith(2, {
      token: 'USDFC',
    })
    expect(synapsePayments.accountInfo).toHaveBeenCalled()
    expect(result).toMatchObject({
      address: fakeWalletClient.account.address,
      fil: 'formatted:1000',
      usdfc: 'formatted:2000',
      availableFunds: 'formatted:3000',
      lockupCurrent: 'formatted:4000',
      lockupRate: 'formatted:5000',
      lockupLastSettledAt: 'formatted:6000',
      funds: 'formatted:7000',
    })
  })

  test('wallet deposit parses the amount, deposits with permit, and waits for the transaction', async () => {
    const result = await depositCommand.run(
      commandContext({ args: { amount: '5' } })
    )

    expect(parseUnits).toHaveBeenCalledWith('5')
    expect(
      synapsePayments.depositWithPermitAndApproveOperator
    ).toHaveBeenCalledWith({ amount: 5_000_000n })
    expect(synapseWaitForTransactionReceipt).toHaveBeenCalledWith({
      hash: '0xdeposit',
    })
    expect(result).toMatchObject({
      status: 'deposited',
      txHash: '0xdeposit',
      txExplorerUrl: 'https://calibration.filfox.info/en/tx/0xdeposit',
    })
  })

  test('wallet withdraw parses the amount, withdraws, and waits for the transaction', async () => {
    const result = await withdrawCommand.run(
      commandContext({ args: { amount: '3' } })
    )

    expect(parseUnits).toHaveBeenCalledWith('3')
    expect(synapsePayments.withdraw).toHaveBeenCalledWith({
      amount: 3_000_000n,
    })
    expect(synapseWaitForTransactionReceipt).toHaveBeenCalledWith({
      hash: '0xwithdraw',
    })
    expect(result).toMatchObject({
      status: 'withdrawn',
      txHash: '0xwithdraw',
      txExplorerUrl: 'https://calibration.filfox.info/en/tx/0xwithdraw',
    })
  })

  test('wallet costs prepares storage for the requested bytes and runway', async () => {
    const result = await costsCommand.run(
      commandContext({
        options: { extraBytes: 1024, extraRunway: 2 },
      })
    )

    expect(synapseStorage.prepare).toHaveBeenCalledWith({
      dataSize: 1024n,
      extraRunwayEpochs: 172800n,
    })
    expect(result).toEqual({
      newPerMonthRate: 'formatted:111',
      depositNeeded: 'formatted:222',
      alreadyCovered: true,
      processLog: [{ step: 'Getting costs', status: 'done' }],
    })
  })

  test('wallet fund claims faucet tokens, waits for FIL, and returns updated balances', async () => {
    const result = await fundCommand.run(commandContext())

    expect(claimTokens).toHaveBeenCalledWith({
      address: fakeWalletClient.account.address,
    })
    expect(waitForTransactionReceipt).toHaveBeenCalledWith(fakeWalletClient, {
      hash: '0xfaucet',
    })
    expect(synapsePayments.walletBalance).toHaveBeenNthCalledWith(1)
    expect(synapsePayments.walletBalance).toHaveBeenNthCalledWith(2, {
      token: 'USDFC',
    })
    expect(result).toMatchObject({
      fil: 'formatted:1000',
      usdfc: 'formatted:2000',
    })
  })

  test('wallet summary maps account summary balances and funding timeline', async () => {
    const result = await summaryCommand.run(commandContext())

    expect(getAccountSummary).toHaveBeenCalledWith(fakeWalletClient, {
      address: fakeWalletClient.account.address,
    })
    expect(result).toMatchObject({
      availableFunds: 'formatted:1',
      timeRemaining: '1h 0d 0w 0m 0y',
      totalLockup: 'formatted:2',
      monthlyAccountRate: 'formatted:3',
      monthlyStorageRate: 'formatted:4',
      funds: 'formatted:5',
    })
  })
})

describe('provider command', () => {
  test('provider list uses a public client and maps approved PDP provider details', async () => {
    const result = await providerListCommand.run(commandContext())

    expect(publicClient).toHaveBeenCalledWith(314159)
    expect(getApprovedPDPProviders).toHaveBeenCalledWith({
      name: 'public-client',
    })
    expect(formatBalance).toHaveBeenCalledWith({ value: 99n })
    expect(result.providers).toEqual([
      {
        providerId: 77,
        name: 'Provider 77',
        description: 'Fast provider',
        serviceProvider: 'f077',
        payee: fakeProvider.payee,
        isActive: true,
        serviceURL: 'https://provider.example',
        location: 'Earth',
        minPieceSize: '1 KiB',
        maxPieceSize: '1 MiB',
        storagePricePerTibPerDay: 'formatted:99',
        minProvingPeriodInEpochs: '2880',
        paymentTokenAddress: '0x0000000000000000000000000000000000000abc',
        ipniPiece: true,
        ipniIpfs: false,
        ipniPeerId: '12D3KooWProvider',
      },
    ])
    expect(result.dealbotDashboard).toBe('https://staging.dealbot.filoz.org')
  })
})

describe('dataset commands', () => {
  test('dataset create creates a data set for an explicit provider', async () => {
    const result = await datasetCreateCommand.run(
      commandContext({
        args: { providerId: 77 },
        options: { cdn: true },
      })
    )

    expect(getPDPProvider).toHaveBeenCalledWith(fakeWalletClient, {
      providerId: 77n,
    })
    expect(createDataSet).toHaveBeenCalledWith(fakeWalletClient, {
      payee: fakeProvider.payee,
      payer: fakeWalletClient.account.address,
      serviceURL: 'https://provider.example',
      cdn: true,
    })
    expect(waitForCreateDataSet).toHaveBeenCalledWith({ txHash: '0xcreate' })
    expect(result).toMatchObject({
      dataSetId: '42',
      scannerUrl: 'https://pdp.vxb.ai/calibration/dataset/42',
      providerId: '77',
    })
  })

  test('dataset create documents current behavior: providerId is required', async () => {
    const result = await datasetCreateCommand.run(commandContext())

    expect(result.error).toEqual({
      code: 'PROVIDER_REQUIRED',
      message: 'providerId argument required in non-interactive mode',
      retryable: true,
    })
    expect(getPDPProvider).not.toHaveBeenCalled()
    expect(createDataSet).not.toHaveBeenCalled()
  })

  test('dataset upload calculates the piece, uploads to the provider, and creates the dataset with metadata', async () => {
    const filePath = await tempFile('dataset-file.txt', 'piece')

    const result = await datasetUploadCommand.run(
      commandContext({
        args: { path: filePath, providerId: 77 },
        options: { cdn: false },
      })
    )

    expect(calculate).toHaveBeenCalled()
    expect(uploadPiece).toHaveBeenCalledWith({
      data: expect.any(Buffer),
      serviceURL: 'https://provider.example',
      pieceCid: expect.anything(),
    })
    expect(findPiece).toHaveBeenCalledWith({
      pieceCid: expect.anything(),
      serviceURL: 'https://provider.example',
      retry: true,
    })
    expect(createDataSetAndAddPieces).toHaveBeenCalledWith(fakeWalletClient, {
      serviceURL: 'https://provider.example',
      payee: fakeProvider.payee,
      cdn: false,
      pieces: [
        {
          pieceCid: expect.anything(),
          metadata: { name: 'dataset-file.txt' },
        },
      ],
    })
    expect(waitForCreateDataSetAddPieces).toHaveBeenCalledWith({
      statusUrl: 'https://provider.example/status',
    })
    expect(result).toMatchObject({
      pieceCid: 'baga-calculated',
      pieceScannerUrl: 'https://pdp.vxb.ai/calibration/piece/baga-calculated',
      dataSetId: '43',
      datasetScannerUrl: 'https://pdp.vxb.ai/calibration/dataset/43',
      pieceIds: ['8'],
    })
  })

  test('dataset list maps datasets and current block number', async () => {
    const result = await datasetListCommand.run(commandContext())

    expect(getPdpDataSets).toHaveBeenCalledWith(fakeWalletClient, {
      address: fakeWalletClient.account.address,
    })
    expect(getBlockNumber).toHaveBeenCalledWith(fakeWalletClient)
    expect(result).toMatchObject({
      blockNumber: '123',
      datasets: [
        {
          dataSetId: '42',
          scannerUrl: 'https://pdp.vxb.ai/calibration/dataset/42',
          provider: fakeProvider.payee,
          serviceURL: 'https://provider.example',
          cdn: true,
          live: true,
          managed: false,
          terminating: false,
        },
      ],
    })
  })

  test('dataset details maps dataset fields and piece metadata', async () => {
    const result = await datasetDetailsCommand.run(
      commandContext({ options: { dataSetId: 42 } })
    )

    expect(getPdpDataSet).toHaveBeenCalledWith(fakeWalletClient, {
      dataSetId: 42n,
    })
    expect(getPiecesWithMetadata).toHaveBeenCalledWith(fakeWalletClient, {
      dataSet: expect.anything(),
      address: fakeWalletClient.account.address,
    })
    expect(result.dataset).toMatchObject({
      dataSetId: '42',
      scannerUrl: 'https://pdp.vxb.ai/calibration/dataset/42',
      provider: fakeProvider.payee,
      serviceURL: 'https://provider.example',
      cdn: true,
      live: true,
      managed: false,
      terminating: false,
      activePieceCount: '2',
      metadata: { label: 'dataset' },
    })
    expect(result.pieces).toEqual([
      {
        id: '7',
        cid: 'baga-piece',
        scannerUrl: 'https://pdp.vxb.ai/calibration/piece/baga-piece',
        url: 'https://provider.example/piece/baga-piece',
        metadata: { name: 'file.txt' },
      },
    ])
  })

  test('dataset terminate calls Synapse Core and maps the termination event', async () => {
    const result = await datasetTerminateCommand.run(
      commandContext({ args: { dataSetId: 42 } })
    )

    expect(terminateServiceSync).toHaveBeenCalledWith(fakeWalletClient, {
      dataSetId: 42n,
      onHash: expect.any(Function),
    })
    expect(result).toMatchObject({
      dataSetId: '42',
      scannerUrl: 'https://pdp.vxb.ai/calibration/dataset/42',
      status: 'terminated',
    })
  })

  test('dataset details returns an object for empty piece metadata', async () => {
    getPiecesWithMetadata.mockImplementationOnce(async () => ({
      pieces: [
        {
          id: 8n,
          cid: cid('baga-empty-metadata'),
          url: 'https://provider.example/piece/baga-empty-metadata',
          metadata: {},
        },
      ],
    }))

    const result = await datasetDetailsCommand.run(
      commandContext({ options: { dataSetId: 42 } })
    )

    expect(result.pieces).toEqual([
      {
        id: '8',
        cid: 'baga-empty-metadata',
        scannerUrl: 'https://pdp.vxb.ai/calibration/piece/baga-empty-metadata',
        url: 'https://provider.example/piece/baga-empty-metadata',
        metadata: {},
      },
    ])
  })
})

describe('piece commands', () => {
  test('piece list maps pieces for a data set', async () => {
    const result = await pieceListCommand.run(
      commandContext({ args: { dataSetId: 42 } })
    )

    expect(getPdpDataSet).toHaveBeenCalledWith(fakeWalletClient, {
      dataSetId: 42n,
    })
    expect(getPiecesWithMetadata).toHaveBeenCalledWith(fakeWalletClient, {
      dataSet: expect.anything(),
      address: fakeWalletClient.account.address,
    })
    expect(result).toMatchObject({
      dataSetId: '42',
      datasetScannerUrl: 'https://pdp.vxb.ai/calibration/dataset/42',
      pieces: [
        {
          id: '7',
          cid: 'baga-piece',
          scannerUrl: 'https://pdp.vxb.ai/calibration/piece/baga-piece',
          metadata: { name: 'file.txt' },
        },
      ],
    })
  })

  test('piece remove schedules deletion and waits for the transaction', async () => {
    const result = await pieceRemoveCommand.run(
      commandContext({ args: { dataSetId: 42, pieceId: 7 } })
    )

    expect(schedulePieceDeletion).toHaveBeenCalledWith(fakeWalletClient, {
      dataSetId: 42n,
      clientDataSetId: 100n,
      pieceId: 7n,
      serviceURL: 'https://provider.example',
    })
    expect(waitForTransactionReceipt).toHaveBeenCalledWith(fakeWalletClient, {
      hash: '0xremove',
    })
    expect(result).toMatchObject({
      status: 'removed',
      dataSetId: '42',
      datasetScannerUrl: 'https://pdp.vxb.ai/calibration/dataset/42',
      pieceId: '7',
    })
  })

  test('piece list returns dataSetId as a string to match its schema', async () => {
    const result = await pieceListCommand.run(
      commandContext({ args: { dataSetId: 42 } })
    )

    expect(result.dataSetId).toBe('42')
  })
})
