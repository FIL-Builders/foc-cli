import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  availableProvidersMock,
  cid,
  claimTokens,
  configStore,
  createDataSet,
  fakeProvider,
  fakeWalletClient,
  fetchMock,
  fetchProviderSelectionInput,
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
  waitForCreateDataSet,
  waitForTransactionReceipt,
} from './command-mocks.ts'

const { uploadCommand } = await import('../src/commands/upload.ts')
const { multiUploadCommand } = await import('../src/commands/multi-upload.ts')
const { downloadCommand } = await import('../src/commands/download.ts')
const { docsCommand } = await import('../src/commands/docs.ts')
const { balanceCommand } = await import('../src/commands/wallet/balance.ts')
const { initCommand } = await import('../src/commands/wallet/init.ts')
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
const { listCommand: pieceListCommand } = await import(
  '../src/commands/piece/list.ts'
)
const { removeCommand: pieceRemoveCommand } = await import(
  '../src/commands/piece/remove.ts'
)
const { selectHealthyProviders } = await import('../src/provider-selection.ts')
const { synapseClient } = await import('../src/synapse.ts')

const tempDirs: string[] = []

function commandContext({
  args = {},
  options = {},
  agent = true,
}: {
  args?: Record<string, any>
  options?: Record<string, any>
  agent?: boolean
} = {}) {
  return {
    agent,
    args,
    options: {
      chain: 314159,
      ...options,
    },
    ok(data: any) {
      return data
    },
    // Mirror incur's run-context error(): reads code/message/retryable/cta off
    // the top level and rebuilds the { error } envelope (not a verbatim echo).
    error(opts: any) {
      return {
        error: {
          code: opts.code,
          message: opts.message,
          ...(opts.retryable !== undefined
            ? { retryable: opts.retryable }
            : {}),
        },
        ...(opts.cta ? { cta: opts.cta } : {}),
      }
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
    const contexts = [{ id: 'ctx-primary' }, { id: 'ctx-secondary' }]
    const execute = mock(async () => ({ hash: '0xprepare' }))

    synapseStorage.createContexts.mockImplementation(async () => contexts)
    synapseStorage.prepare.mockImplementation(async () => ({
      transaction: { execute },
    }))
    synapseStorage.upload.mockImplementation(async () => ({
      pieceCid: cid('baga-upload'),
      size: 4,
      requestedCopies: 2,
      complete: true,
      copies: [
        {
          dataSetId: 42n,
          retrievalUrl: 'https://provider.example/piece/baga-upload',
          pieceId: 7n,
          providerId: 77n,
          isNewDataSet: true,
          role: 'primary',
        },
        {
          dataSetId: 43n,
          retrievalUrl: 'https://backup.example/piece/baga-upload',
          pieceId: 8n,
          providerId: 79n,
          isNewDataSet: false,
          role: 'secondary',
        },
      ],
      failedAttempts: [
        {
          providerId: 78n,
          role: 'secondary',
          error: 'replaced after transient failure',
          explicit: false,
        },
      ],
    }))

    const result = await uploadCommand.run(
      commandContext({
        args: { path: filePath },
        options: { copies: 2, withCDN: true },
      })
    )

    expect(privateKeyClient).toHaveBeenCalledWith(314159)
    expect(synapseConstructorArgs).toEqual([
      { client: fakeWalletClient, source: 'foc-cli' },
    ])
    expect(fetchProviderSelectionInput).toHaveBeenCalledWith(fakeWalletClient, {
      address: fakeWalletClient.account.address,
    })
    expect(synapseStorage.createContexts).toHaveBeenCalledWith({
      providerIds: [77n, 79n],
      withCDN: true,
    })
    expect(synapseStorage.prepare).toHaveBeenCalledWith({
      context: contexts,
      dataSize: 4n,
    })
    expect(execute).toHaveBeenCalled()
    // The SDK contract: upload() rejects any other option (withCDN,
    // providerIds, dataSetIds) once contexts are supplied — CDN preference
    // must ride in via createContexts only.
    expect(synapseStorage.upload).toHaveBeenCalledWith(expect.anything(), {
      contexts,
    })
    expect(result.status).toBe('uploaded')
    expect(result.result).toEqual({
      pieceCid: 'baga-upload',
      pieceScannerUrl: 'https://pdp.vxb.ai/calibration/piece/baga-upload',
      size: 4,
      requestedCopies: 2,
      complete: true,
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
        {
          dataSetId: '43',
          datasetScannerUrl: 'https://pdp.vxb.ai/calibration/dataset/43',
          url: 'https://backup.example/piece/baga-upload',
          pieceId: '8',
          providerId: '79',
          isNewDataSet: false,
          providerRole: 'secondary',
        },
      ],
      copyFailures: [
        {
          providerId: '78',
          role: 'secondary',
          error: 'replaced after transient failure',
          explicit: false,
        },
      ],
    })
  })

  test('upload reports partial status when Synapse commits fewer copies than requested', async () => {
    const filePath = await tempFile('partial.txt', 'data')
    const contexts = [
      { id: 'ctx-primary' },
      { id: 'ctx-secondary-a' },
      { id: 'ctx-secondary-b' },
    ]

    synapseStorage.createContexts.mockImplementation(async () => contexts)
    synapseStorage.upload.mockImplementation(async () => ({
      pieceCid: cid('baga-partial'),
      size: 4,
      requestedCopies: 3,
      complete: false,
      copies: [
        {
          dataSetId: 42n,
          retrievalUrl: 'https://provider.example/piece/baga-partial',
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
        },
      ],
    }))

    const result = await uploadCommand.run(
      commandContext({
        args: { path: filePath },
        options: { copies: 3 },
      })
    )

    expect(result.status).toBe('partially_uploaded')
    expect(result.result).toMatchObject({
      pieceCid: 'baga-partial',
      requestedCopies: 3,
      complete: false,
      copyResults: [
        {
          dataSetId: '42',
          pieceId: '7',
          providerId: '77',
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

  // A directory passes stat() with a size, so without an isFile() gate the
  // funding transaction could execute before the stream ever failed.
  test('upload rejects a directory before contexts or prepare can run', async () => {
    const insideDir = await tempFile('marker.txt', 'x')
    const dir = path.dirname(insideDir)

    const result = await uploadCommand.run(
      commandContext({ args: { path: dir } })
    )

    expect(result.error.code).toBe('NOT_A_FILE')
    expect(result.error.message).toContain(dir)
    expect(synapseStorage.createContexts).not.toHaveBeenCalled()
    expect(synapseStorage.prepare).not.toHaveBeenCalled()
  })

  test('multi-upload rejects a batch mixing a regular file and a directory before contexts or prepare', async () => {
    const readable = await tempFile('readable.txt', 'ok')
    const dir = path.dirname(readable)

    const result = await multiUploadCommand.run(
      commandContext({ args: { paths: [readable, dir] } })
    )

    expect(result.error.code).toBe('FILE_READ_FAILED')
    expect(result.error.message).toContain(dir)
    expect(synapseStorage.createContexts).not.toHaveBeenCalled()
    expect(synapseStorage.prepare).not.toHaveBeenCalled()
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

  test('wallet balance on a brand-new address humanizes the actor-not-found dump', async () => {
    synapsePayments.walletBalance.mockImplementationOnce(async () => {
      throw new Error(
        'The contract function "balanceOf" reverted.\n\nmulticall3... actor not found (RetCode=1)'
      )
    })

    const result = await balanceCommand.run(commandContext())

    expect(result.error.code).toBe('ADDRESS_NOT_ON_CHAIN')
    expect(result.error.message).toContain('no onchain history')
    expect(result.error.message).toContain(fakeWalletClient.account.address)
    expect(result.cta.commands[0]).toMatchObject({ command: 'wallet fund' })
  })

  // Live-observed 2026-07-23: current Glif Calibration nodes report a fresh
  // address as "failed to apply on state with gas" instead of "actor not
  // found" — both must map to the humanized envelope.
  test('wallet balance humanizes the newer failed-to-apply-on-state RPC variant', async () => {
    synapsePayments.walletBalance.mockImplementationOnce(async () => {
      throw new Error(
        'RPC Request failed.\n\nDetails: RPC error (-32603): failed to apply on state with gas'
      )
    })

    const result = await balanceCommand.run(commandContext())

    expect(result.error.code).toBe('ADDRESS_NOT_ON_CHAIN')
    expect(result.cta.commands[0]).toMatchObject({ command: 'wallet fund' })
  })

  // wallet fund is Calibration-only; recommending it on mainnet would point
  // an agent's funding workflow at the wrong network.
  test('wallet balance on mainnet never suggests the testnet faucet', async () => {
    synapsePayments.walletBalance.mockImplementationOnce(async () => {
      throw new Error('multicall3... actor not found (RetCode=1)')
    })

    const result = await balanceCommand.run(
      commandContext({ options: { chain: 314 } })
    )

    expect(result.error.code).toBe('ADDRESS_NOT_ON_CHAIN')
    expect(result.error.message).toContain('no mainnet faucet')
    expect(result.cta).toBeUndefined()
  })

  test('wallet init --keystore rejects a directory instead of configuring it', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'foc-cli-test-'))
    tempDirs.push(dir)

    const result = await initCommand.run(
      commandContext({ options: { keystore: dir }, agent: false })
    )

    expect(result.error.code).toBe('KEYSTORE_INVALID')
    expect(result.error.message).toContain('directory')
    expect(configStore.set).not.toHaveBeenCalledWith(
      'keystore',
      expect.anything()
    )
  })

  test('wallet init --keystore rejects a file that is not an encrypted keystore', async () => {
    const filePath = await tempFile('not-a-keystore.json', '{"hello":"world"}')

    const result = await initCommand.run(
      commandContext({ options: { keystore: filePath }, agent: false })
    )

    expect(result.error.code).toBe('KEYSTORE_INVALID')
    expect(result.error.message).toContain('crypto')
  })

  test('wallet init --keystore reports a missing path as KEYSTORE_NOT_FOUND', async () => {
    const result = await initCommand.run(
      commandContext({
        options: { keystore: '/nonexistent-dir-8f2k/ks.json' },
        agent: false,
      })
    )

    expect(result.error.code).toBe('KEYSTORE_NOT_FOUND')
  })

  test('wallet init --keystore accepts a keystore-shaped file and clears any raw key', async () => {
    const filePath = await tempFile(
      'keystore.json',
      JSON.stringify({ crypto: { cipher: 'aes-128-ctr' }, id: 'x', version: 3 })
    )

    const result = await initCommand.run(
      commandContext({ options: { keystore: filePath }, agent: false })
    )

    expect(configStore.set).toHaveBeenCalledWith('keystore', filePath)
    expect(configStore.delete).toHaveBeenCalledWith('privateKey')
    expect(result).toMatchObject({
      status: 'configured',
      method: 'keystore',
      path: filePath,
    })
  })

  // Without the isFile() gate this test HANGS: readFileSync on a FIFO with no
  // writer blocks the process, which is exactly the failure being prevented.
  test('wallet init --keystore rejects a FIFO instead of reading it', async () => {
    const marker = await tempFile('marker.txt', 'x')
    const fifoPath = path.join(path.dirname(marker), 'keystore.fifo')
    execFileSync('mkfifo', [fifoPath])

    const result = await initCommand.run(
      commandContext({ options: { keystore: fifoPath }, agent: false })
    )

    expect(result.error.code).toBe('KEYSTORE_INVALID')
    expect(result.error.message).toContain('regular file')
    expect(configStore.set).not.toHaveBeenCalledWith(
      'keystore',
      expect.anything()
    )
  })

  test('wallet init --keystore rejects JSON whose crypto field is not an object', async () => {
    const filePath = await tempFile(
      'fake-keystore.json',
      JSON.stringify({ crypto: 'not-an-object' })
    )

    const result = await initCommand.run(
      commandContext({ options: { keystore: filePath }, agent: false })
    )

    expect(result.error.code).toBe('KEYSTORE_INVALID')
  })

  test('wallet init --keystore is rejected in agent mode before touching config', async () => {
    const filePath = await tempFile(
      'keystore.json',
      JSON.stringify({ crypto: { cipher: 'aes-128-ctr' }, id: 'x', version: 3 })
    )

    const result = await initCommand.run(
      commandContext({ options: { keystore: filePath } })
    )

    expect(result.error.code).toBe('KEYSTORE_INTERACTIVE_ONLY')
    expect(configStore.set).not.toHaveBeenCalledWith(
      'keystore',
      expect.anything()
    )
  })

  // Explicit methods must replace the configured wallet — the old ordering
  // returned already_configured and kept the previous credential. Replacing is
  // destructive, so it now takes --force (or a confirmation on a terminal).
  test('wallet init --auto --force replaces an existing private key', async () => {
    configStore.get.mockImplementation((key: string) =>
      key === 'privateKey' ? '0xold' : undefined
    )

    const result = await initCommand.run(
      commandContext({ options: { auto: true, force: true } })
    )

    expect(result.status).toBe('configured')
    expect(result.method).toBe('auto')
    expect(configStore.set).toHaveBeenCalledWith(
      'privateKey',
      expect.stringMatching(/^0x[a-fA-F0-9]{64}$/)
    )
  })

  test('wallet init --auto --force clears a configured keystore so the new key wins', async () => {
    configStore.get.mockImplementation((key: string) =>
      key === 'keystore' ? '/home/user/.foundry/keystores/foc' : undefined
    )

    const result = await initCommand.run(
      commandContext({ options: { auto: true, force: true } })
    )

    expect(result.status).toBe('configured')
    expect(configStore.delete).toHaveBeenCalledWith('keystore')
  })

  // Replacing a configured wallet discards a key that may be the only copy.
  // In agent mode there is nobody to ask, so it refuses rather than overwrite.
  test('wallet init refuses to replace a configured wallet without --force', async () => {
    configStore.get.mockImplementation((key: string) =>
      key === 'privateKey'
        ? '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
        : undefined
    )

    const result = await initCommand.run(
      commandContext({ options: { auto: true } })
    )

    expect(result.error.code).toBe('WALLET_ALREADY_CONFIGURED')
    expect(configStore.set).not.toHaveBeenCalled()
    // The refusal carries the way forward, and names what would be lost. The
    // caller's own --auto is replayed alongside --force, and both are switches,
    // so both live in the command string — as options incur would render them
    // `--auto <auto> --force <force>`, which is not a runnable command.
    expect(result.cta.commands[0].command).toBe('wallet init --auto --force')
    expect(result.cta.commands[0].options).not.toHaveProperty('force')
    expect(result.error.message).toContain('0x70997970')
  })

  test('wallet init does not refuse when the change replaces nothing', async () => {
    // Re-running the same reference is idempotent. Refusing it would train
    // agents to pass --force reflexively, which defeats the guard.
    configStore.get.mockImplementation((key: string) =>
      key === 'keyRef' ? 'clawdi:FILECOIN_PRIVATE_KEY' : undefined
    )

    const result = await initCommand.run(
      commandContext({ options: { keyRef: 'clawdi:FILECOIN_PRIVATE_KEY' } })
    )

    expect(result.status).toBe('configured')
    expect(result.method).toBe('keyRef')
  })

  test('wallet init reports a configured key reference as already configured', async () => {
    configStore.get.mockImplementation((key: string) =>
      key === 'keyRef' ? 'clawdi:FILECOIN_PRIVATE_KEY' : undefined
    )

    const result = await initCommand.run(commandContext())

    expect(result.status).toBe('already_configured')
    expect(result.keyRef).toBe('clawdi:FILECOIN_PRIVATE_KEY')
  })

  // A call to action naming a tool the machine does not have is a dead end.
  test('wallet init guidance offers a key reference only when a provider is installed', async () => {
    availableProvidersMock.mockImplementation(() => [])
    let result = await initCommand.run(commandContext())
    expect(result.error.code).toBe('INIT_METHOD_REQUIRED')
    expect(result.cta.commands.some((cmd: any) => cmd.options?.keyRef)).toBe(
      false
    )

    availableProvidersMock.mockImplementation(() => ['clawdi'])
    result = await initCommand.run(commandContext())
    expect(
      result.cta.commands.some(
        (cmd: any) => cmd.options?.keyRef === 'clawdi:FILECOIN_PRIVATE_KEY'
      )
    ).toBe(true)
  })

  test('wallet init --keyRef reports whether the provider is installed here', async () => {
    availableProvidersMock.mockImplementation(() => [])
    const result = await initCommand.run(
      commandContext({ options: { keyRef: 'clawdi:FILECOIN_PRIVATE_KEY' } })
    )
    // Configuring before installing the provider is legitimate, so it succeeds
    // — but it must say so, or the next command fails confusingly.
    expect(result.status).toBe('configured')
    expect(result.providerAvailable).toBe(false)
  })

  test('wallet init agent guidance no longer offers the interactive-only keystore method', async () => {
    const result = await initCommand.run(commandContext())

    expect(result.error.code).toBe('INIT_METHOD_REQUIRED')
    const offered = result.cta.commands.map((cmd: any) => cmd.options)
    expect(offered).not.toContainEqual(
      expect.objectContaining({ keystore: expect.anything() })
    )
  })

  // Re-running the same reference is a documented no-op, and the force guard
  // agrees — so it never asks. That made an unconditional delete of the scope
  // silently destructive: the wallet re-resolved against the provider's default
  // project, which is a different key and therefore a different address.
  test('wallet init --keyRef keeps the configured project when the reference is unchanged', async () => {
    configStore.get.mockImplementation((key: string) =>
      key === 'keyRef'
        ? 'clawdi:FILECOIN_PRIVATE_KEY'
        : key === 'keyRefProject'
          ? 'engineering'
          : undefined
    )

    const result = await initCommand.run(
      commandContext({ options: { keyRef: 'clawdi:FILECOIN_PRIVATE_KEY' } })
    )

    expect(result.status).toBe('configured')
    expect(configStore.delete).not.toHaveBeenCalledWith('keyRefProject')
    // And it reports the scope actually in effect, not the absent option.
    expect(result.keyProject).toBe('engineering')
  })

  test('wallet init --keyRef drops the old project when the reference changes', async () => {
    configStore.get.mockImplementation((key: string) =>
      key === 'keyRef'
        ? 'clawdi:OLD_KEY'
        : key === 'keyRefProject'
          ? 'engineering'
          : undefined
    )

    await initCommand.run(
      commandContext({
        options: { keyRef: 'clawdi:NEW_KEY', force: true },
      })
    )

    // A scope belongs to the reference it was set for.
    expect(configStore.delete).toHaveBeenCalledWith('keyRefProject')
  })

  test('wallet init --keyRef --keyProject "" clears the scope deliberately', async () => {
    configStore.get.mockImplementation((key: string) =>
      key === 'keyRef'
        ? 'clawdi:FILECOIN_PRIVATE_KEY'
        : key === 'keyRefProject'
          ? 'engineering'
          : undefined
    )

    await initCommand.run(
      commandContext({
        options: { keyRef: 'clawdi:FILECOIN_PRIVATE_KEY', keyProject: '' },
      })
    )

    expect(configStore.delete).toHaveBeenCalledWith('keyRefProject')
  })

  // --key-ref sits beside --private-key in help and both take a 0x-ish string.
  // The envelope for that mix-up travels into the MCP result, the agent's
  // context and every log downstream, so it must not carry the key.
  test('wallet init --keyRef never echoes a value that looks like a private key', async () => {
    const key = `0x${'a'.repeat(64)}`

    const result = await initCommand.run(
      commandContext({ options: { keyRef: key } })
    )

    expect(result.error.code).toBe('INVALID_KEY_REF')
    expect(result.error.message).not.toContain(key)
    expect(result.error.message).not.toContain('a'.repeat(32))
    // And it names the flag that was actually meant.
    expect(result.error.message).toContain('--private-key')
  })

  // A value that could never work is judged before the replacement guard, so
  // the caller is told what is actually wrong instead of being asked to pass
  // --force for a command that was going to be refused anyway. Whichever
  // refusal wins, the key must not appear anywhere in it.
  test('a key passed as --keyRef is refused on its own terms, and never echoed', async () => {
    const key = `0x${'b'.repeat(64)}`
    configStore.get.mockImplementation((key_: string) =>
      key_ === 'privateKey' ? `0x${'c'.repeat(64)}` : undefined
    )

    const result = await initCommand.run(
      commandContext({ options: { keyRef: key } })
    )

    expect(result.error.code).toBe('INVALID_KEY_REF')
    expect(result.error.message).not.toContain('b'.repeat(32))
    expect(JSON.stringify(result.cta ?? {})).not.toContain('b'.repeat(32))
    // Nothing was written on the way to refusing.
    expect(configStore.set).not.toHaveBeenCalled()
  })

  // Two methods is a question, not a request, and --keyRef used to answer it by
  // winning silently: `--auto --keyRef clawdi:K` configured the reference,
  // minted no key, and reported method 'keyRef', so a caller who asked for a
  // throwaway testnet key kept signing with the vault key.
  test('wallet init refuses two custody methods rather than picking one', async () => {
    const result = await initCommand.run(
      commandContext({
        options: { auto: true, keyRef: 'clawdi:FILECOIN_PRIVATE_KEY' },
      })
    )

    expect(result.error.code).toBe('CONFLICTING_INIT_METHODS')
    expect(result.error.message).toContain('--auto')
    expect(result.error.message).toContain('--key-ref')
    expect(configStore.set).not.toHaveBeenCalled()
  })

  // A command that reports failure must leave the config as it found it.
  // --source was written ahead of every validation branch, so a refused init
  // still changed the file it said it had not touched.
  test('wallet init writes nothing at all when it refuses', async () => {
    const result = await initCommand.run(
      commandContext({
        options: { source: 'my-app', keyRef: 'clawdi:MY KEY&touch x' },
      })
    )

    expect(result.error.code).toBe('INVALID_KEY_REF')
    expect(configStore.set).not.toHaveBeenCalled()
  })

  // The same mix-up with the provider prefix included: `clawdi:0x<64 hex>`
  // parses and is pure hex, so the character allowlist alone stored it — a key
  // at rest under a field documented as safe to display, echoed by every
  // surface that names the reference.
  test('a key pasted after the provider prefix is refused, and never echoed', async () => {
    const key = `0x${'d'.repeat(64)}`

    const result = await initCommand.run(
      commandContext({ options: { keyRef: `clawdi:${key}` } })
    )

    expect(result.error.code).toBe('INVALID_KEY_REF')
    expect(result.error.message).toContain('--private-key')
    expect(result.error.message).not.toContain('d'.repeat(32))
    expect(configStore.set).not.toHaveBeenCalled()
  })

  test('wallet init --keyRef redacts key-like runs from what it reports back', async () => {
    // Not exactly a key, so it configures — but the hex run it carries must
    // not ride back in the result, which lands in the MCP envelope.
    const run = 'e'.repeat(64)

    const result = await initCommand.run(
      commandContext({ options: { keyRef: `clawdi:vault/0x${run}` } })
    )

    expect(result.status).toBe('configured')
    expect(result.keyRef).not.toContain('e'.repeat(32))
  })

  // redactKeyLike matches any 32+ hex run, which is right for hiding a secret
  // and wrong as a test of what the value is. Using it as a classifier told the
  // author of a hex-ish reference to pass it to --private-key, where it fails
  // again with INVALID_KEY.
  test('a hex-ish reference is not misreported as a private key', async () => {
    const result = await initCommand.run(
      commandContext({
        options: { keyRef: 'deadbeefdeadbeefdeadbeefdeadbeef' },
      })
    )

    expect(result.error.code).toBe('INVALID_KEY_REF')
    expect(result.error.message).not.toContain('--private-key')
  })

  // Init is the only moment this is cheap to catch. Storing it anyway meant
  // `configured` was reported, the previous wallet was cleared, and every
  // command afterwards failed with "re-run `foc-cli wallet init`" — pointing
  // back at the command that had just accepted the value.
  test('wallet init --keyRef refuses a reference no command could ever resolve', async () => {
    const result = await initCommand.run(
      commandContext({ options: { keyRef: 'clawdi:MY KEY&touch x' } })
    )

    expect(result.error.code).toBe('INVALID_KEY_REF')
    expect(configStore.set).not.toHaveBeenCalledWith(
      'keyRef',
      expect.anything()
    )
  })

  test('wallet init --keyRef refuses a reference that would become a provider flag', async () => {
    const result = await initCommand.run(
      commandContext({ options: { keyRef: 'clawdi:--project' } })
    )

    expect(result.error.code).toBe('INVALID_KEY_REF')
    expect(result.error.message).toContain('option')
    expect(configStore.set).not.toHaveBeenCalledWith(
      'keyRef',
      expect.anything()
    )
  })

  test('wallet init --keyProject is validated too', async () => {
    const result = await initCommand.run(
      commandContext({
        options: {
          keyRef: 'clawdi:FILECOIN_PRIVATE_KEY',
          keyProject: 'proj & id',
        },
      })
    )

    expect(result.error.code).toBe('INVALID_KEY_PROJECT')
    expect(configStore.set).not.toHaveBeenCalledWith(
      'keyRef',
      expect.anything()
    )
  })

  // Both reference docs tell the reader to do exactly this. Nothing consumed
  // it, so the command fell through to already_configured, wrote nothing, and
  // reported success — leaving the caller believing a scope was pinned.
  test('wallet init --keyProject alone re-scopes the configured reference', async () => {
    configStore.get.mockImplementation((key: string) =>
      key === 'keyRef' ? 'clawdi:FILECOIN_PRIVATE_KEY' : undefined
    )

    const result = await initCommand.run(
      commandContext({ options: { keyProject: 'engineering' } })
    )

    expect(result.status).toBe('configured')
    expect(result.keyRef).toBe('clawdi:FILECOIN_PRIVATE_KEY')
    expect(configStore.set).toHaveBeenCalledWith('keyRefProject', 'engineering')
  })

  test('wallet init --auto --keyProject is refused, not silently one or the other', async () => {
    // This branch runs before --auto, so it must not shadow it: --auto with a
    // scope is a contradiction, and answering it by quietly doing one of the
    // two is the same silent-ignore the branch exists to remove.
    const result = await initCommand.run(
      commandContext({ options: { auto: true, keyProject: 'engineering' } })
    )

    expect(result.error.code).toBe('KEY_PROJECT_WITHOUT_KEY_REF')
    expect(configStore.set).not.toHaveBeenCalledWith(
      'privateKey',
      expect.anything()
    )
  })

  test('wallet init --keyProject alone is refused when no reference is configured', async () => {
    const result = await initCommand.run(
      commandContext({ options: { keyProject: 'engineering' } })
    )

    expect(result.error.code).toBe('KEY_PROJECT_WITHOUT_KEY_REF')
    expect(configStore.set).not.toHaveBeenCalledWith(
      'keyRefProject',
      expect.anything()
    )
  })

  // The one custody mode the already-configured checks could not see: bare
  // `wallet init` fell past them to the interactive prompt, which writes a
  // private key and deletes the keystore — replacing a wallet with no --force
  // and no confirmation.
  test('wallet init reports a configured keystore as already configured', async () => {
    configStore.get.mockImplementation((key: string) =>
      key === 'keystore' ? '/home/user/.foundry/keystores/foc' : undefined
    )

    const result = await initCommand.run(
      commandContext({ agent: false, options: {} })
    )

    expect(result.status).toBe('already_configured')
    expect(result.path).toBe('/home/user/.foundry/keystores/foc')
    expect(configStore.set).not.toHaveBeenCalledWith(
      'privateKey',
      expect.anything()
    )
    expect(configStore.delete).not.toHaveBeenCalledWith('keystore')
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
    const activeDataSet = {
      dataSetId: 42n,
      providerId: 77n,
      live: true,
      managed: true,
      pdpEndEpoch: 0n,
    }
    // Same provider as activeDataSet — still costed as its own context
    const sameProviderDataSet = { ...activeDataSet, dataSetId: 43n }
    const terminatingDataSet = {
      ...activeDataSet,
      dataSetId: 44n,
      providerId: 78n,
      pdpEndEpoch: 999n,
    }
    getPdpDataSets.mockResolvedValueOnce([
      activeDataSet,
      sameProviderDataSet,
      terminatingDataSet,
    ] as any)

    const result = await costsCommand.run(
      commandContext({
        options: { extraBytes: 1024, extraRunway: 2 },
      })
    )

    expect(getPdpDataSets).toHaveBeenCalledWith(fakeWalletClient, {
      address: fakeWalletClient.account.address,
    })
    expect(synapseStorage.createContext).toHaveBeenCalledTimes(2)
    expect(synapseStorage.createContext).toHaveBeenCalledWith({
      dataSetId: 42n,
    })
    expect(synapseStorage.createContext).toHaveBeenCalledWith({
      dataSetId: 43n,
    })
    expect(synapseStorage.prepare).toHaveBeenCalledWith({
      dataSize: 1024n,
      extraRunwayEpochs: 172800n,
      context: [{ dataSetId: 42n }, { dataSetId: 43n }],
    })
    expect(formatBalance).toHaveBeenNthCalledWith(1, { value: 111n })
    expect(formatBalance).toHaveBeenNthCalledWith(2, { value: 222n })
    expect(result).toEqual({
      newPerMonthRate: 'formatted:111',
      depositNeeded: 'formatted:222',
      alreadyCovered: true,
      needsFwssMaxApproval: false,
      processLog: [{ step: 'Getting costs', status: 'done' }],
    })
  })

  test('wallet costs prices two new datasets for an empty wallet without provider selection', async () => {
    getPdpDataSets.mockResolvedValueOnce([] as any)

    const result = await costsCommand.run(
      commandContext({
        options: { extraBytes: 1024, extraRunway: 1 },
      })
    )

    expect(synapseStorage.createContexts).not.toHaveBeenCalled()
    expect(synapseStorage.createContext).not.toHaveBeenCalled()
    expect(synapseStorage.prepare).toHaveBeenCalledWith({
      dataSize: 1024n,
      extraRunwayEpochs: 86400n,
      context: [
        { dataSetId: undefined, withCDN: false },
        { dataSetId: undefined, withCDN: false },
      ],
    })
    expect(result).toMatchObject({ alreadyCovered: true })
  })

  // prepare() applies extraBytes once per supplied context, so the estimate
  // must price the copies the next upload will write — not every dataset the
  // wallet has ever created.
  test('wallet costs with one active dataset prices the second copy as a new dataset', async () => {
    getPdpDataSets.mockResolvedValueOnce([
      {
        dataSetId: 42n,
        providerId: 77n,
        live: true,
        managed: true,
        pdpEndEpoch: 0n,
      },
    ] as any)

    await costsCommand.run(
      commandContext({ options: { extraBytes: 1024, extraRunway: 1 } })
    )

    expect(synapseStorage.createContext).toHaveBeenCalledTimes(1)
    expect(synapseStorage.prepare).toHaveBeenCalledWith({
      dataSize: 1024n,
      extraRunwayEpochs: 86400n,
      context: [{ dataSetId: 42n }, { dataSetId: undefined, withCDN: false }],
    })
  })

  test('wallet costs with three active datasets prices only the requested copies', async () => {
    const base = { providerId: 77n, live: true, managed: true, pdpEndEpoch: 0n }
    getPdpDataSets.mockResolvedValueOnce([
      { ...base, dataSetId: 42n },
      { ...base, dataSetId: 43n },
      { ...base, dataSetId: 44n },
    ] as any)

    await costsCommand.run(
      commandContext({ options: { extraBytes: 1024, extraRunway: 1 } })
    )

    expect(synapseStorage.createContext).toHaveBeenCalledTimes(2)
    expect(synapseStorage.prepare).toHaveBeenCalledWith({
      dataSize: 1024n,
      extraRunwayEpochs: 86400n,
      context: [{ dataSetId: 42n }, { dataSetId: 43n }],
    })
  })

  test('wallet costs --copies overrides how many contexts are priced', async () => {
    getPdpDataSets.mockResolvedValueOnce([] as any)

    await costsCommand.run(
      commandContext({
        options: { extraBytes: 1024, extraRunway: 1, copies: 3, withCDN: true },
      })
    )

    expect(synapseStorage.prepare).toHaveBeenCalledWith({
      dataSize: 1024n,
      extraRunwayEpochs: 86400n,
      context: [
        { dataSetId: undefined, withCDN: true },
        { dataSetId: undefined, withCDN: true },
        { dataSetId: undefined, withCDN: true },
      ],
    })
  })

  test('wallet fund waits for both assets and returns their updated balances', async () => {
    const result = await fundCommand.run(commandContext())

    expect(claimTokens).toHaveBeenCalledWith({
      address: fakeWalletClient.account.address,
    })
    expect(waitForTransactionReceipt).toHaveBeenNthCalledWith(
      1,
      fakeWalletClient,
      { hash: '0xusdfc' }
    )
    expect(waitForTransactionReceipt).toHaveBeenNthCalledWith(
      2,
      fakeWalletClient,
      { hash: '0xfil' }
    )
    expect(synapsePayments.walletBalance).toHaveBeenNthCalledWith(1)
    expect(synapsePayments.walletBalance).toHaveBeenNthCalledWith(2, {
      token: 'USDFC',
    })
    expect(result).toMatchObject({
      status: 'funded',
      fil: {
        status: 'funded',
        balance: 'formatted:1000',
        txHash: '0xfil',
      },
      usdfc: {
        status: 'funded',
        balance: 'formatted:2000',
        txHash: '0xusdfc',
      },
    })
  })

  test('wallet fund does not treat an unknown faucet asset as USDFC', async () => {
    claimTokens.mockResolvedValueOnce([
      { faucetInfo: 'unexpected', tx_hash: '0xunknown' },
    ] as any)

    const result = await fundCommand.run(commandContext())

    expect(waitForTransactionReceipt).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      status: 'unconfirmed',
      faucetError: 'Unexpected faucet asset: unexpected',
      usdfc: { status: 'unconfirmed' },
    })
    expect(result.usdfc.txHash).toBeUndefined()
    expect(result.processLog[1]).toMatchObject({ status: 'failed' })
  })

  test('wallet fund leaves a successful claim unconfirmed until its balance appears', async () => {
    synapsePayments.walletBalance.mockImplementation(
      async (options?: { token?: string }) => (options?.token ? 0n : 1000n)
    )

    const result = await fundCommand.run(commandContext())

    expect(result).toMatchObject({
      status: 'unconfirmed',
      fil: { status: 'funded', balance: 'formatted:1000' },
      usdfc: { status: 'unconfirmed', balance: 'formatted:0' },
    })
    expect(result.cta.description).toContain('USDFC is unconfirmed')
    expect(result.cta.description).toContain(
      'Check unconfirmed balances before retrying'
    )
    expect(result.cta.description).not.toContain('Request')
    expect(result.cta.description).not.toContain('faucet')
    expect(result.cta.commands).toEqual([
      {
        command: 'wallet balance',
        options: { chain: 314159 },
        description: 'Verify wallet balances before continuing',
      },
    ])
  })

  test('wallet fund directs successful claims through upload costing', async () => {
    const result = await fundCommand.run(commandContext())

    expect(result.cta).toEqual({
      description:
        'Funding complete. Run wallet costs for the intended upload before depositing.',
      commands: [],
    })
  })

  test('wallet fund does not treat an existing balance as proof after a receipt timeout', async () => {
    waitForTransactionReceipt.mockImplementation(
      async (_client: any, { hash }: { hash: string }) => {
        if (hash === '0xusdfc') throw new Error('receipt timed out')
        return { status: 'success' }
      }
    )

    const result = await fundCommand.run(commandContext())

    expect(waitForTransactionReceipt).toHaveBeenCalledTimes(2)
    expect(synapsePayments.walletBalance).toHaveBeenNthCalledWith(1)
    expect(synapsePayments.walletBalance).toHaveBeenNthCalledWith(2, {
      token: 'USDFC',
    })
    expect(result).toMatchObject({
      status: 'unconfirmed',
      fil: { status: 'funded' },
      usdfc: {
        status: 'unconfirmed',
        balance: 'formatted:2000',
        error: 'receipt timed out',
      },
    })
    expect(result.processLog[1]).toEqual({
      step: 'Waiting for transactions to be mined',
      status: 'failed',
      error: 'receipt timed out',
    })
  })

  test('wallet fund does not retry an unconfirmed zero balance after a receipt timeout', async () => {
    waitForTransactionReceipt.mockImplementation(
      async (_client: any, { hash }: { hash: string }) => {
        if (hash === '0xusdfc') throw new Error('receipt timed out')
        return { status: 'success' }
      }
    )
    synapsePayments.walletBalance.mockImplementation(
      async (options?: { token?: string }) => (options?.token ? 0n : 1000n)
    )

    const result = await fundCommand.run(commandContext())

    expect(result).toMatchObject({
      status: 'unconfirmed',
      fil: { status: 'funded' },
      usdfc: {
        status: 'unconfirmed',
        balance: 'formatted:0',
        error: 'receipt timed out',
      },
    })
    expect(result.cta.description).toContain(
      'Check unconfirmed balances before retrying'
    )
    expect(result.cta.description).not.toContain('Request')
    expect(result.cta.description).not.toContain('faucet')
  })

  test('wallet fund preserves a reverted outcome despite an existing balance', async () => {
    waitForTransactionReceipt.mockImplementation(
      async (_client: any, { hash }: { hash: string }) => ({
        status: hash === '0xusdfc' ? 'reverted' : 'success',
      })
    )

    const result = await fundCommand.run(commandContext())

    expect(result).toMatchObject({
      status: 'partially_funded',
      fil: { status: 'funded' },
      usdfc: {
        status: 'missing',
        balance: 'formatted:2000',
        error: 'Faucet transaction reverted',
      },
    })
  })

  test('wallet fund preserves a reverted outcome when its balance check fails', async () => {
    waitForTransactionReceipt.mockImplementation(
      async (_client: any, { hash }: { hash: string }) => ({
        status: hash === '0xusdfc' ? 'reverted' : 'success',
      })
    )
    synapsePayments.walletBalance.mockImplementation(
      async (options?: { token?: string }) => {
        if (options?.token) throw new Error('RPC unavailable')
        return 1000n
      }
    )

    const result = await fundCommand.run(commandContext())

    expect(result).toMatchObject({
      status: 'partially_funded',
      fil: { status: 'funded' },
      usdfc: {
        status: 'missing',
        error:
          'Faucet transaction reverted; Balance check failed: RPC unavailable',
      },
    })
    expect(result.processLog[2]).toEqual({
      step: 'Fetching updated balances',
      status: 'failed',
      error: 'Balance check failed: RPC unavailable',
    })
  })

  test('wallet fund rechecks both balances after the faucet helper fails', async () => {
    claimTokens.mockRejectedValueOnce(new Error('faucet unavailable'))

    const result = await fundCommand.run(commandContext())

    expect(waitForTransactionReceipt).not.toHaveBeenCalled()
    expect(synapsePayments.walletBalance).toHaveBeenNthCalledWith(1)
    expect(synapsePayments.walletBalance).toHaveBeenNthCalledWith(2, {
      token: 'USDFC',
    })
    expect(result).toMatchObject({
      status: 'unconfirmed',
      faucetError: 'faucet unavailable',
      fil: { status: 'unconfirmed', balance: 'formatted:1000' },
      usdfc: { status: 'unconfirmed', balance: 'formatted:2000' },
    })
    expect(result.processLog[0]).toEqual({
      step: 'Requesting faucet tokens',
      status: 'failed',
      error: 'faucet unavailable',
    })
    expect(result.error).toBeUndefined()
    expect(result.cta.description).not.toContain('Request')
  })

  test('wallet fund rejects mainnet before creating a client or contacting a faucet', async () => {
    const result = await fundCommand.run(
      commandContext({ options: { chain: 314 } })
    )

    expect(result.error).toEqual({
      code: 'TESTNET_ONLY',
      message:
        'wallet fund only supports Filecoin Calibration (chain 314159). Fund mainnet wallets by sending FIL and USDFC to the wallet address.',
    })
    expect(privateKeyClient).not.toHaveBeenCalled()
    expect(claimTokens).not.toHaveBeenCalled()
    expect(synapsePayments.walletBalance).not.toHaveBeenCalled()
  })

  test('wallet summary maps account summary balances and funding timeline', async () => {
    const result = await summaryCommand.run(commandContext())

    expect(getAccountSummary).toHaveBeenCalledWith(fakeWalletClient, {
      address: fakeWalletClient.account.address,
    })
    expect(result).toMatchObject({
      availableFunds: 'formatted:1',
      timeRemaining: '~1h',
      totalLockup: 'formatted:2',
      rateBasedLockup: 'formatted:3',
      monthlyAccountRate: 'formatted:4',
      funds: 'formatted:5',
    })
  })

  // The old formatter concatenated the same duration in five units
  // ("17468h 727d 103w 25m 2y"); each runway must render as ONE unit.
  test('wallet summary renders the funding runway in a single unit', async () => {
    getAccountSummary.mockImplementationOnce(async () => ({
      availableFunds: 1n,
      totalLockup: 2n,
      totalRateBasedLockup: 3n,
      lockupRatePerMonth: 4n,
      funds: 5n,
      runwayInEpochs: 2096160n, // 17468 hours ≈ 2 years
    }))

    const result = await summaryCommand.run(commandContext())

    expect(result.timeRemaining).toBe('~2y')
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
    expect(waitForCreateDataSet).toHaveBeenCalledWith({
      txHash: '0xcreate',
      statusUrl: 'https://provider.example/status',
    })
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
      offset: 0n,
      limit: 100n,
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
    expect(result.hasMore).toBe(false)
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
      hasMore: false,
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

  test('dataset details paginates and emits a next-page CTA when more pieces remain', async () => {
    getPiecesWithMetadata.mockImplementationOnce(async () => ({
      pieces: [
        {
          id: 7n,
          cid: cid('baga-page1'),
          url: 'https://provider.example/piece/baga-page1',
          metadata: { name: 'file.txt' },
        },
      ],
      hasMore: true,
    }))

    const result = await datasetDetailsCommand.run(
      commandContext({ options: { dataSetId: 42, offset: 5, limit: 1 } })
    )

    expect(getPiecesWithMetadata).toHaveBeenCalledWith(fakeWalletClient, {
      dataSet: expect.anything(),
      address: fakeWalletClient.account.address,
      offset: 5n,
      limit: 1n,
    })
    expect(result.hasMore).toBe(true)
    expect(result.nextOffset).toBe(6)
    expect(result.cta.commands).toContainEqual({
      command: 'dataset details',
      options: { chain: 314159, dataSetId: 42, offset: 6, limit: 1 },
      description: 'Show the next page of pieces (offset 6)',
    })
    expect(result.cta.commands).toContainEqual({
      command: 'dataset details',
      options: { chain: 314159, dataSetId: 42, offset: 0, limit: 2 },
      description: 'Fetch all 2 pieces in one call',
    })
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
      offset: 0n,
      limit: 100n,
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
    expect(result.hasMore).toBe(false)
  })

  test('piece list paginates and emits a next-page CTA when more pieces remain', async () => {
    getPiecesWithMetadata.mockImplementationOnce(async () => ({
      pieces: [
        {
          id: 7n,
          cid: cid('baga-page1'),
          url: 'https://provider.example/piece/baga-page1',
          metadata: { name: 'file.txt' },
        },
      ],
      hasMore: true,
    }))

    const result = await pieceListCommand.run(
      commandContext({
        args: { dataSetId: 42 },
        options: { offset: 5, limit: 1 },
      })
    )

    expect(getPiecesWithMetadata).toHaveBeenCalledWith(fakeWalletClient, {
      dataSet: expect.anything(),
      address: fakeWalletClient.account.address,
      offset: 5n,
      limit: 1n,
    })
    expect(result.hasMore).toBe(true)
    expect(result.nextOffset).toBe(6)
    expect(result.cta.commands).toContainEqual({
      command: 'piece list',
      args: { dataSetId: 42 },
      options: { chain: 314159, offset: 6, limit: 1 },
      description: 'Show the next page of pieces (offset 6)',
    })
    expect(result.cta.commands).toContainEqual({
      command: 'piece list',
      args: { dataSetId: 42 },
      options: { chain: 314159, offset: 0, limit: 2 },
      description: 'Fetch all 2 pieces in one call',
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

describe('provider health selection', () => {
  test('selects reachable endorsed providers first, primary first', async () => {
    const selection = await selectHealthyProviders(fakeWalletClient, 2)

    expect(fetchProviderSelectionInput).toHaveBeenCalledWith(fakeWalletClient, {
      address: fakeWalletClient.account.address,
    })
    expect(selection.providerIds).toEqual([77n, 79n])
    expect(selection.usedUnendorsedPrimary).toBe(false)
    expect(selection.reducedCopies).toBe(false)
    expect(selection.reachableCount).toBe(3)
  })

  test('falls back to a reachable non-endorsed provider for the primary when no endorsed is reachable', async () => {
    fetchProviderSelectionInput.mockImplementation(async () => ({
      providers: [
        {
          id: 77n,
          name: 'Endorsed',
          pdp: { serviceURL: 'https://endorsed.example' },
        },
        {
          id: 81n,
          name: 'Approved',
          pdp: { serviceURL: 'https://approved.example' },
        },
      ],
      endorsedIds: [77n],
      clientDataSets: [],
    }))
    // The only endorsed provider is down; the approved one answers.
    fetchMock.mockImplementation(async (url: string | URL) =>
      String(url).includes('endorsed.example')
        ? new Response(null, { status: 503 })
        : new Response(null, { status: 200 })
    )

    const selection = await selectHealthyProviders(fakeWalletClient, 1)

    expect(selection.providerIds).toEqual([81n])
    expect(selection.usedUnendorsedPrimary).toBe(true)
    expect(selection.primaryName).toBe('Approved')
    expect(selection.reducedCopies).toBe(false)
  })

  test('reduces copies when fewer providers are reachable than requested', async () => {
    // Only provider 77 (https://provider.example) answers.
    fetchMock.mockImplementation(async (url: string | URL) =>
      String(url).includes('://provider.example')
        ? new Response(null, { status: 200 })
        : new Response(null, { status: 503 })
    )

    const selection = await selectHealthyProviders(fakeWalletClient, 3)

    expect(selection.providerIds).toEqual([77n])
    expect(selection.selectedCopies).toBe(1)
    expect(selection.requestedCopies).toBe(3)
    expect(selection.reducedCopies).toBe(true)
    expect(selection.reachableCount).toBe(1)
  })

  test('throws a clear error when no provider is reachable', async () => {
    fetchMock.mockImplementation(
      async () => new Response(null, { status: 503 })
    )

    await expect(selectHealthyProviders(fakeWalletClient, 2)).rejects.toThrow(
      /No reachable storage providers/
    )
  })
})

describe('synapse client construction', () => {
  test('reports the configured source, defaulting to foc-cli', () => {
    synapseClient(314159)
    expect(synapseConstructorArgs.at(-1)).toEqual({
      client: fakeWalletClient,
      source: 'foc-cli',
    })

    configStore.get.mockImplementation((key: string) =>
      key === 'source' ? 'my-app' : undefined
    )
    synapseClient(314159)
    expect(synapseConstructorArgs.at(-1)).toEqual({
      client: fakeWalletClient,
      source: 'my-app',
    })
  })
})

describe('download command', () => {
  test('download retrieves validated bytes and writes them to the output path', async () => {
    // A sibling of a real temp file, but not pre-created: default download
    // mode is exclusive creation and refuses existing paths.
    const marker = await tempFile('marker.txt', '')
    const outPath = path.join(path.dirname(marker), 'downloaded.bin')
    const result = await downloadCommand.run(
      commandContext({
        args: { pieceCid: 'baga-piece' },
        options: { out: outPath },
      })
    )

    expect(synapseStorage.download).toHaveBeenCalledWith({
      pieceCid: 'baga-piece',
    })
    expect(result).toMatchObject({
      pieceCid: 'baga-piece',
      pieceScannerUrl: 'https://pdp.vxb.ai/calibration/piece/baga-piece',
      size: 4,
      verified: true,
      path: outPath,
    })
    const written = await readFile(outPath)
    expect([...written]).toEqual([1, 2, 3, 4])
  })

  test('download passes withCDN and providerAddress through to the SDK', async () => {
    const marker = await tempFile('marker.txt', '')
    const outPath = path.join(path.dirname(marker), 'cdn.bin')
    await downloadCommand.run(
      commandContext({
        args: { pieceCid: 'baga-piece' },
        options: { out: outPath, withCDN: true, providerAddress: '0xprovider' },
      })
    )

    expect(synapseStorage.download).toHaveBeenCalledWith({
      pieceCid: 'baga-piece',
      withCDN: true,
      providerAddress: '0xprovider',
    })
  })

  test('download reports a retryable failure when retrieval fails', async () => {
    synapseStorage.download.mockImplementationOnce(async () => {
      throw new Error('All provider retrieval attempts failed')
    })
    const result = await downloadCommand.run(
      commandContext({ args: { pieceCid: 'baga-piece' } })
    )

    expect(result.error).toMatchObject({
      code: 'DOWNLOAD_FAILED',
      retryable: true,
    })
  })

  test('download reports an invalid piece CID as non-retryable', async () => {
    synapseStorage.download.mockImplementationOnce(async () => {
      throw new Error('Invalid PieceCID: nope')
    })
    const result = await downloadCommand.run(
      commandContext({ args: { pieceCid: 'nope' } })
    )

    expect(result.error.code).toBe('INVALID_PIECE_CID')
    expect(result.error.retryable).toBeUndefined()
  })
})

describe('docs command url restriction', () => {
  test('docs --url resolves a bare docs path against docs.filecoin.cloud', async () => {
    fetchMock.mockImplementationOnce(
      async () => new Response('# Page\n\ncontent', { status: 200 })
    )
    const result = await docsCommand.run(
      commandContext({ options: { url: 'developer-guides/synapse.md' } })
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'https://docs.filecoin.cloud/developer-guides/synapse.md',
      expect.anything()
    )
    expect(result.source).toBe(
      'https://docs.filecoin.cloud/developer-guides/synapse.md'
    )
    expect(result.content).toContain('# Page')
  })

  test('docs --url upgrades http docs URLs to https and strips nothing else', async () => {
    fetchMock.mockImplementationOnce(
      async () => new Response('# Start', { status: 200 })
    )
    await docsCommand.run(
      commandContext({
        options: { url: 'http://docs.filecoin.cloud/getting-started.md' },
      })
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'https://docs.filecoin.cloud/getting-started.md',
      expect.anything()
    )
  })

  test('docs --url rejects non-docs hosts without fetching', async () => {
    const result = await docsCommand.run(
      commandContext({ options: { url: 'https://evil.example.com/page.md' } })
    )

    expect(result.error.code).toBe('INVALID_DOCS_URL')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('docs --url rejects path traversal in bare paths', async () => {
    const result = await docsCommand.run(
      commandContext({ options: { url: '../../etc/passwd' } })
    )

    expect(result.error.code).toBe('INVALID_DOCS_URL')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('docs command markdown normalization', () => {
  test('docs --url rewrites extensionless paths to their .md mirror', async () => {
    fetchMock.mockImplementationOnce(
      async () => new Response('# Synapse', { status: 200 })
    )
    const result = await docsCommand.run(
      commandContext({ options: { url: 'developer-guides/synapse' } })
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'https://docs.filecoin.cloud/developer-guides/synapse.md',
      expect.anything()
    )
    expect(result.source).toBe(
      'https://docs.filecoin.cloud/developer-guides/synapse.md'
    )
  })

  test('docs --url rewrites trailing-slash site URLs to their .md mirror', async () => {
    fetchMock.mockImplementationOnce(
      async () => new Response('# TOC', { status: 200 })
    )
    await docsCommand.run(
      commandContext({
        options: {
          url: 'https://docs.filecoin.cloud/reference/filoz/synapse-core/warm-storage/namespaces/getpdpdataset/toc/',
        },
      })
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'https://docs.filecoin.cloud/reference/filoz/synapse-core/warm-storage/namespaces/getpdpdataset/toc.md',
      expect.anything()
    )
  })

  test('docs --url refuses to return HTML when no markdown mirror exists', async () => {
    fetchMock.mockImplementationOnce(
      async () =>
        new Response('<!DOCTYPE html><html><body>sidebar soup</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
    )
    const result = await docsCommand.run(
      commandContext({ options: { url: 'llms.txt' } })
    )

    expect(result.error.code).toBe('HTML_RESPONSE')
    expect(result.error.message).toContain('markdown')
  })
})

describe('docs command deep sitemap search', () => {
  const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset><url><loc>https://docs.filecoin.cloud/reference/filoz/synapse-core/warm-storage/namespaces/getpdpdataset/toc/</loc></url>
<url><loc>https://docs.filecoin.cloud/developer-guides/payments/payment-operations/</loc></url>
<url><loc>https://docs.filecoin.cloud/changelog-sdk/v1-1-0/</loc></url></urlset>`

  test('docs --deep searches the sitemap and auto-fetches the top .md mirror', async () => {
    fetchMock
      .mockImplementationOnce(
        async () =>
          new Response('- [Payments](https://docs.filecoin.cloud/x.md): pay', {
            status: 200,
          })
      ) // llms.txt index
      .mockImplementationOnce(async () => new Response(null, { status: 404 })) // sitemap-index.xml → fall back to single shard
      .mockImplementationOnce(
        async () => new Response(SITEMAP_XML, { status: 200 })
      ) // sitemap-0.xml
      .mockImplementationOnce(
        async () => new Response('# getPdpDataSet', { status: 200 })
      ) // auto-fetched page

    const result = await docsCommand.run(
      commandContext({ options: { prompt: 'getPdpDataSet', deep: true } })
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'https://docs.filecoin.cloud/sitemap-0.xml',
      expect.anything()
    )
    expect(result.source).toBe(
      'https://docs.filecoin.cloud/reference/filoz/synapse-core/warm-storage/namespaces/getpdpdataset/toc.md'
    )
    expect(result.content).toContain('getPdpDataSet')
    expect(result.matchedEntries).toHaveLength(1)
  })

  test('docs falls back to the sitemap when the curated index has no matches', async () => {
    fetchMock
      .mockImplementationOnce(
        async () =>
          new Response('- [Payments](https://docs.filecoin.cloud/x.md): pay', {
            status: 200,
          })
      ) // llms.txt — no match for the prompt
      .mockImplementationOnce(async () => new Response(null, { status: 404 })) // sitemap-index.xml → fall back to single shard
      .mockImplementationOnce(
        async () => new Response(SITEMAP_XML, { status: 200 })
      ) // sitemap-0.xml fallback
      .mockImplementationOnce(
        async () => new Response('# getPdpDataSet', { status: 200 })
      ) // auto-fetched page

    const result = await docsCommand.run(
      commandContext({ options: { prompt: 'getpdpdataset' } })
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'https://docs.filecoin.cloud/sitemap-0.xml',
      expect.anything()
    )
    expect(result.source).toBe(
      'https://docs.filecoin.cloud/reference/filoz/synapse-core/warm-storage/namespaces/getpdpdataset/toc.md'
    )
  })
})

describe('docs command index url allowlist', () => {
  // The curated index arrives over the network; a planted external link must
  // be dropped at parse time, never auto-fetched.
  test('docs auto-fetch never follows an external host planted in llms.txt', async () => {
    fetchMock
      .mockImplementationOnce(
        async () =>
          new Response(
            [
              '- [Evil payments](https://evil.example.com/payments.md): payments',
              '- [Payments](https://docs.filecoin.cloud/payments.md): payments',
            ].join('\n'),
            { status: 200 }
          )
      ) // llms.txt with a planted external entry
      .mockImplementationOnce(
        async () => new Response('# Payments', { status: 200 })
      ) // auto-fetched page — must be the docs-host entry

    const result = await docsCommand.run(
      commandContext({ options: { prompt: 'payments' } })
    )

    expect(result.source).toBe('https://docs.filecoin.cloud/payments.md')
    const fetchedUrls = fetchMock.mock.calls.map((call: any[]) => call[0])
    expect(fetchedUrls).not.toContain('https://evil.example.com/payments.md')
    expect(result.matchedEntries).toHaveLength(1)
  })

  test('sitemap entries off the docs host are dropped', async () => {
    fetchMock
      .mockImplementationOnce(
        async () => new Response('# nothing relevant', { status: 200 })
      ) // llms.txt — no entries at all
      .mockImplementationOnce(async () => new Response(null, { status: 404 })) // sitemap-index.xml → single-shard fallback
      .mockImplementationOnce(
        async () =>
          new Response(
            '<urlset><url><loc>https://evil.example.com/payments/</loc></url></urlset>',
            { status: 200 }
          )
      ) // sitemap-0.xml with only an external loc

    const result = await docsCommand.run(
      commandContext({ options: { prompt: 'payments' } })
    )

    const fetchedUrls = fetchMock.mock.calls.map((call: any[]) => call[0])
    expect(
      fetchedUrls.some((url: string) => url.includes('evil.example.com'))
    ).toBe(false)
    expect(result.matchedEntries).toHaveLength(0)
  })
})

describe('docs command attribution', () => {
  test('docs requests identify foc-cli via User-Agent with version and source tag', async () => {
    fetchMock.mockImplementationOnce(
      async () => new Response('# Page', { status: 200 })
    )
    await docsCommand.run(
      commandContext({ options: { url: 'developer-guides/synapse.md' } })
    )

    const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
    const userAgent = (init.headers as Record<string, string>)['user-agent']
    expect(userAgent).toMatch(/^foc-cli\/\d+\.\d+\.\d+ /)
    expect(userAgent).toContain('source=foc-cli')
    expect(userAgent).toContain('github.com/FIL-Builders/foc-cli')
  })

  test('docs User-Agent carries a custom source tag from config', async () => {
    configStore.get.mockImplementation((key: string) =>
      key === 'source' ? 'my-app' : undefined
    )
    fetchMock.mockImplementationOnce(
      async () => new Response('# Page', { status: 200 })
    )
    await docsCommand.run(
      commandContext({ options: { url: 'developer-guides/synapse.md' } })
    )

    const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
    expect((init.headers as Record<string, string>)['user-agent']).toContain(
      'source=my-app'
    )
  })
})

describe('download error taxonomy', () => {
  test('CID-mismatch integrity failures are NOT retryable and get a distinct code', async () => {
    synapseStorage.download.mockImplementationOnce(async () => {
      throw new Error(
        'Failed to download piece.\n\nDetails: PieceCID verification failed. Expected: baga-a, Got: baga-b'
      )
    })
    const result = await downloadCommand.run(
      commandContext({ args: { pieceCid: 'baga-piece' } })
    )

    expect(result.error.code).toBe('INTEGRITY_MISMATCH')
    expect(result.error.retryable).toBeUndefined()
    expect(result.cta.commands[0]).toMatchObject({ command: 'download' })
  })

  test('unknown --providerAddress is a non-retryable PROVIDER_NOT_FOUND', async () => {
    synapseStorage.download.mockImplementationOnce(async () => {
      throw new Error('Provider 0xdead not found')
    })
    const result = await downloadCommand.run(
      commandContext({
        args: { pieceCid: 'baga-piece' },
        options: { providerAddress: '0xdead' },
      })
    )

    expect(result.error.code).toBe('PROVIDER_NOT_FOUND')
    expect(result.error.retryable).toBeUndefined()
  })

  test('local write failures after a validated download are WRITE_FAILED, not retryable retrieval errors', async () => {
    const result = await downloadCommand.run(
      commandContext({
        args: { pieceCid: 'baga-piece' },
        options: { out: '/nonexistent-dir-fjq38/x.bin' },
      })
    )

    expect(result.error.code).toBe('WRITE_FAILED')
    expect(result.error.retryable).toBeUndefined()
    expect(result.error.message).toContain('Downloaded and validated 4 bytes')
  })

  test('download without --out writes to ./<pieceCid> in the cwd', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'foc-cli-test-'))
    tempDirs.push(dir)
    const prevCwd = process.cwd()
    process.chdir(dir)
    try {
      const result = await downloadCommand.run(
        commandContext({ args: { pieceCid: 'baga-piece' } })
      )
      // process.cwd() rather than dir: macOS tmpdir is a /var -> /private/var
      // symlink and cwd reports the realpath.
      expect(result.path).toBe(path.join(process.cwd(), 'baga-piece'))
      const written = await readFile(result.path)
      expect([...written]).toEqual([1, 2, 3, 4])
    } finally {
      process.chdir(prevCwd)
    }
  })

  test('download refuses to overwrite an existing file without --force', async () => {
    const existing = await tempFile('already-there.bin', 'precious')

    const result = await downloadCommand.run(
      commandContext({
        args: { pieceCid: 'baga-piece' },
        options: { out: existing },
      })
    )

    expect(result.error.code).toBe('FILE_EXISTS')
    // --force is a switch, so it belongs in the command string: as an option
    // value incur would render it `--force <force>`, which no shell can run.
    expect(result.cta.commands[0].command).toBe('download --force')
    expect(result.cta.commands[0].options).not.toHaveProperty('force')
    // The original bytes must be untouched.
    expect((await readFile(existing)).toString()).toBe('precious')
  })

  test('download --force overwrites the existing file', async () => {
    const existing = await tempFile('already-there.bin', 'precious')

    const result = await downloadCommand.run(
      commandContext({
        args: { pieceCid: 'baga-piece' },
        options: { out: existing, force: true },
      })
    )

    expect(result.verified).toBe(true)
    expect([...(await readFile(existing))]).toEqual([1, 2, 3, 4])
  })
})

describe('docs command hardening round 2', () => {
  test('deep search walks sitemap-index.xml shards when available', async () => {
    const INDEX_XML = `<sitemapindex><sitemap><loc>https://docs.filecoin.cloud/sitemap-0.xml</loc></sitemap></sitemapindex>`
    const SHARD_XML = `<urlset><url><loc>https://docs.filecoin.cloud/reference/foo/getpdpdataset/toc/</loc></url></urlset>`
    fetchMock
      .mockImplementationOnce(
        async () =>
          new Response('- [X](https://docs.filecoin.cloud/x.md): x', {
            status: 200,
          })
      ) // llms.txt
      .mockImplementationOnce(
        async () => new Response(INDEX_XML, { status: 200 })
      ) // sitemap-index.xml
      .mockImplementationOnce(
        async () => new Response(SHARD_XML, { status: 200 })
      ) // shard
      .mockImplementationOnce(
        async () => new Response('# page', { status: 200 })
      ) // auto-fetch

    const result = await docsCommand.run(
      commandContext({ options: { prompt: 'getpdpdataset', deep: true } })
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'https://docs.filecoin.cloud/sitemap-index.xml',
      expect.anything()
    )
    expect(result.source).toBe(
      'https://docs.filecoin.cloud/reference/foo/getpdpdataset/toc.md'
    )
  })

  test('auto-fallback fails loudly when the sitemap cannot be fetched instead of reporting no matches', async () => {
    fetchMock
      .mockImplementationOnce(
        async () =>
          new Response('- [X](https://docs.filecoin.cloud/x.md): x', {
            status: 200,
          })
      ) // llms.txt — no match
      .mockImplementationOnce(async () => new Response(null, { status: 404 })) // sitemap-index
      .mockImplementationOnce(async () => new Response(null, { status: 404 })) // sitemap-0

    const result = await docsCommand.run(
      commandContext({ options: { prompt: 'getpdpdataset' } })
    )

    expect(result.error.code).toBe('FETCH_FAILED')
    expect(result.error.retryable).toBe(true)
  })

  test('docs --url refuses to follow redirects (3xx surfaces as FETCH_FAILED)', async () => {
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(null, {
          status: 301,
          headers: { location: 'https://evil.example.com/x' },
        })
    )
    const result = await docsCommand.run(
      commandContext({ options: { url: 'developer-guides/synapse.md' } })
    )

    expect(result.error.code).toBe('FETCH_FAILED')
  })

  test('HTML body-sniff fires even without an html content-type', async () => {
    fetchMock.mockImplementationOnce(
      async () =>
        new Response('<div>rendered page soup</div>', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        })
    )
    const result = await docsCommand.run(
      commandContext({ options: { url: 'llms.txt' } })
    )

    expect(result.error.code).toBe('HTML_RESPONSE')
  })
})

describe('command output schema discovery', () => {
  // wallet init shipped without an output declaration, leaving --schema and
  // MCP get_tool_details blind to its result contract. Walk the source tree
  // so the next command added without a schema fails here, not in the field.
  test('every executable command declares an output schema', async () => {
    const commandsDir = path.join(import.meta.dir, '../src/commands')
    const files = (await readdir(commandsDir, { recursive: true })).filter(
      (file) => file.endsWith('.ts') && !file.endsWith('index.ts')
    )
    expect(files.length).toBeGreaterThan(0)

    const missing: string[] = []
    for (const file of files) {
      const module = await import(path.join(commandsDir, file))
      for (const [exportName, command] of Object.entries(module)) {
        const isCommand =
          command &&
          typeof command === 'object' &&
          typeof (command as any).run === 'function'
        if (isCommand && !(command as any).output) {
          missing.push(`${file}:${exportName}`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  test('wallet init output schema accepts both result envelopes', () => {
    const schema = (initCommand as any).output
    expect(
      schema.safeParse({ status: 'configured', method: 'auto', source: 'x' })
        .success
    ).toBe(true)
    expect(
      schema.safeParse({ status: 'already_configured', configPath: '/c' })
        .success
    ).toBe(true)
  })
})

describe('cta chain propagation', () => {
  // A command run with --chain 314 must never hand an agent a follow-up
  // command that silently defaults back to Calibration. Every chain-aware
  // CTA is stamped via chainCta(); this sweep runs the CTA-emitting commands
  // on mainnet and rejects any suggested command that lost the chain.
  function expectCtaChain(result: any, chain: number) {
    expect(result.cta).toBeDefined()
    for (const cmd of result.cta.commands) {
      expect(cmd.options?.chain).toBe(chain)
    }
  }

  test('dataset list CTA carries chain 314', async () => {
    const result = await datasetListCommand.run(
      commandContext({ options: { chain: 314 } })
    )
    expectCtaChain(result, 314)
  })

  test('dataset details CTA (incl. pagination entries) carries chain 314', async () => {
    const result = await datasetDetailsCommand.run(
      commandContext({ options: { chain: 314, dataSetId: 42 } })
    )
    expectCtaChain(result, 314)
  })

  test('dataset create CTAs carry chain 314', async () => {
    const result = await datasetCreateCommand.run(
      commandContext({ args: { providerId: 77 }, options: { chain: 314 } })
    )
    expectCtaChain(result, 314)
  })

  test('dataset terminate CTA carries chain 314', async () => {
    const result = await datasetTerminateCommand.run(
      commandContext({ args: { dataSetId: 42 }, options: { chain: 314 } })
    )
    expectCtaChain(result, 314)
  })

  test('piece list CTA carries chain 314', async () => {
    const result = await pieceListCommand.run(
      commandContext({ args: { dataSetId: 42 }, options: { chain: 314 } })
    )
    expectCtaChain(result, 314)
  })

  test('piece remove CTA carries chain 314', async () => {
    const result = await pieceRemoveCommand.run(
      commandContext({
        args: { dataSetId: 42, pieceId: 7 },
        options: { chain: 314 },
      })
    )
    expectCtaChain(result, 314)
  })

  test('provider list CTA carries chain 314', async () => {
    const result = await providerListCommand.run(
      commandContext({ options: { chain: 314 } })
    )
    expectCtaChain(result, 314)
  })

  test('wallet deposit CTA carries chain 314', async () => {
    const result = await depositCommand.run(
      commandContext({ args: { amount: '1' }, options: { chain: 314 } })
    )
    expectCtaChain(result, 314)
  })

  test('wallet fund CTA carries the active chain', async () => {
    const result = await fundCommand.run(commandContext())
    expectCtaChain(result, 314159)
  })

  test('wallet balance faucet CTA carries the calibration chain explicitly', async () => {
    synapsePayments.walletBalance.mockImplementationOnce(async () => {
      throw new Error('actor not found')
    })
    const result = await balanceCommand.run(commandContext())
    expectCtaChain(result, 314159)
  })

  test('download success and FILE_EXISTS CTAs carry chain 314', async () => {
    const marker = await tempFile('marker.txt', '')
    const freshPath = path.join(path.dirname(marker), 'dl.bin')
    const ok = await downloadCommand.run(
      commandContext({
        args: { pieceCid: 'baga-piece' },
        options: { chain: 314, out: freshPath },
      })
    )
    expectCtaChain(ok, 314)

    const exists = await downloadCommand.run(
      commandContext({
        args: { pieceCid: 'baga-piece' },
        options: { chain: 314, out: freshPath },
      })
    )
    expect(exists.error.code).toBe('FILE_EXISTS')
    expectCtaChain(exists, 314)
  })
})
