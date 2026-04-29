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
  function mockContext(agent: boolean) {
    return {
      agent,
      ok: (data: any, opts?: any) => (opts ? { ...data, ...opts } : data),
      error: (err: any) => err,
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

    test('fail returns error with processLog trail', () => {
      const c = mockContext(true)
      const out = new OutputContext(c)
      out.step('Connecting')
      out.step('Submitting')
      const result = out.fail('TX_FAILED', 'insufficient funds', {
        cta: {
          commands: [{ command: 'wallet fund', description: 'Get tokens' }],
        },
      })
      expect(result.error.code).toBe('TX_FAILED')
      expect(result.processLog[0]).toEqual({
        step: 'Connecting',
        status: 'done',
      })
      expect(result.processLog[1]).toEqual({
        step: 'Submitting',
        status: 'failed',
        error: 'insufficient funds',
      })
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
