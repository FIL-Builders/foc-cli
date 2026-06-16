import { describe, expect, test } from 'bun:test'
import { deepSerialize, OutputContext } from '../src/output.ts'

describe('deepSerialize', () => {
  test('converts bigint to string', () => {
    expect(deepSerialize(42n)).toBe('42')
  })
  test('converts bigint in object', () => {
    expect(deepSerialize({ id: 42n, name: 'test' })).toEqual({
      id: '42',
      name: 'test',
    })
  })
  test('converts bigint in nested object', () => {
    expect(deepSerialize({ a: { b: 100n } })).toEqual({ a: { b: '100' } })
  })
  test('converts bigint in array', () => {
    expect(deepSerialize([1n, 2n, 3n])).toEqual(['1', '2', '3'])
  })
  test('converts bigint in array of objects', () => {
    expect(deepSerialize([{ id: 1n }, { id: 2n }])).toEqual([
      { id: '1' },
      { id: '2' },
    ])
  })
  test('passes through primitives', () => {
    expect(deepSerialize('hello')).toBe('hello')
    expect(deepSerialize(42)).toBe(42)
    expect(deepSerialize(true)).toBe(true)
    expect(deepSerialize(null)).toBe(null)
    expect(deepSerialize(undefined)).toBe(undefined)
  })
  test('handles empty objects and arrays', () => {
    expect(deepSerialize({})).toEqual({})
    expect(deepSerialize([])).toEqual([])
  })
})

describe('OutputContext', () => {
  // Mirror incur's run-context: error() reads code/message/retryable/cta off
  // the top level and rebuilds the { error } envelope (it does NOT echo the
  // argument verbatim, and has no slot for processLog).
  function mockContext(agent: boolean) {
    return {
      agent,
      ok: (data: any, opts?: any) => (opts ? { ...data, ...opts } : data),
      error: (opts: any) => ({
        error: {
          code: opts.code,
          message: opts.message,
          ...(opts.retryable !== undefined ? { retryable: opts.retryable } : {}),
        },
        ...(opts.cta ? { cta: opts.cta } : {}),
      }),
    }
  }

  describe('MCP mode (agent=true)', () => {
    test('done returns serialized data with processLog', () => {
      const c = mockContext(true)
      const out = new OutputContext(c)
      out.step('Step 1')
      out.step('Step 2')
      const result = out.done({ balance: 100n })
      expect(result.balance).toBe('100')
      expect(result.processLog).toEqual([
        { step: 'Step 1', status: 'done' },
        { step: 'Step 2', status: 'done' },
      ])
    })

    test('done includes cta when provided', () => {
      const c = mockContext(true)
      const out = new OutputContext(c)
      out.step('Depositing')
      const result = out.done(
        { status: 'ok' },
        {
          cta: {
            commands: [
              { command: 'wallet balance', description: 'Check balance' },
            ],
          },
        }
      )
      expect(result.cta).toBeDefined()
      expect(result.cta.commands[0].command).toBe('wallet balance')
    })

    test('fail returns an error envelope incur can render (code, message, cta)', () => {
      const c = mockContext(true)
      const out = new OutputContext(c)
      out.step('Connecting')
      out.step('Submitting')
      const result = out.fail('TX_FAILED', 'insufficient funds', {
        cta: {
          commands: [{ command: 'wallet fund', description: 'Get tokens' }],
        },
      })
      // code/message must survive to the top-level error object so incur
      // renders them instead of `code: null, message: null`.
      expect(result.error.code).toBe('TX_FAILED')
      expect(result.error.message).toBe('insufficient funds')
      expect(result.cta.commands[0].command).toBe('wallet fund')
    })

    test('fail with retryable flag', () => {
      const c = mockContext(true)
      const out = new OutputContext(c)
      out.step('Trying')
      const result = out.fail('RETRY_ME', 'transient', { retryable: true })
      expect(result.error.retryable).toBe(true)
    })
  })

  describe('deep serialize through done', () => {
    test('serializes nested bigints in done output', () => {
      const c = mockContext(true)
      const out = new OutputContext(c)
      const result = out.done({
        datasets: [{ id: 42n, epoch: 1000n }],
        blockNumber: 999n,
      })
      expect(result.datasets[0].id).toBe('42')
      expect(result.datasets[0].epoch).toBe('1000')
      expect(result.blockNumber).toBe('999')
    })
  })
})
