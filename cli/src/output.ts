import * as p from '@clack/prompts'
import { isAgent } from './utils.ts'

type LogEntry = { step: string; status: 'done' | 'failed'; error?: string }

interface CTA {
  description?: string
  commands: {
    command: string
    args?: Record<string, any>
    options?: Record<string, any>
    description: string
  }[]
}

interface DoneOpts {
  cta?: CTA
}

interface FailOpts {
  cta?: CTA
  retryable?: boolean
}

export function deepSerialize(obj: any): any {
  if (typeof obj === 'bigint') return obj.toString()
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(deepSerialize)
  if (typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, deepSerialize(v)])
    )
  }
  return obj
}

export class OutputContext {
  private log: LogEntry[] = []
  private agent: boolean
  private spinner: ReturnType<typeof p.spinner> | null
  private c: any

  constructor(c: any) {
    this.c = c
    this.agent = isAgent(c)
    this.spinner = this.agent ? null : p.spinner()
  }

  step(message: string) {
    if (
      this.log.length > 0 &&
      this.log[this.log.length - 1].status !== 'failed'
    ) {
      this.log[this.log.length - 1].status = 'done'
    }
    this.log.push({ step: message, status: 'done' })

    if (!this.agent) {
      if (this.log.length === 1) {
        this.spinner?.start(message)
      } else {
        this.spinner?.message(message)
      }
    }
  }

  info(message: string) {
    if (!this.agent) {
      this.spinner?.stop()
      p.log.info(message)
      this.spinner = p.spinner()
    }
  }

  success(message: string) {
    if (!this.agent) {
      this.spinner?.stop()
      p.log.success(message)
      this.spinner = p.spinner()
    }
  }

  done(data: any, opts?: DoneOpts) {
    this.spinner?.stop()
    const serialized = deepSerialize(data)

    if (this.agent) {
      const result: any = { ...serialized, processLog: this.log }
      if (opts?.cta) result.cta = opts.cta
      return this.c.ok ? this.c.ok(result) : result
    }

    if (opts?.cta && this.c.ok) {
      return this.c.ok(serialized, { cta: opts.cta })
    }
    return serialized
  }

  fail(code: string, message: string, opts?: FailOpts) {
    if (this.log.length > 0) {
      this.log[this.log.length - 1].status = 'failed'
      this.log[this.log.length - 1].error = message
    }

    this.spinner?.stop()

    if (!this.agent) {
      p.log.error(message)
    }

    // incur's run-context `error()` reads `code`/`message`/`retryable`/`cta`
    // off the TOP LEVEL of its argument and rebuilds the `{ ok:false, error }`
    // envelope itself. Passing a nested `{ error }` made incur read `undefined`
    // and render every failure as `code: null, message: null`, hiding the real
    // cause. (incur's error envelope has no slot for processLog, so the step
    // trail is only surfaced on success.)
    return this.c.error({
      code,
      message,
      ...(opts?.retryable ? { retryable: true } : {}),
      ...(opts?.cta ? { cta: opts.cta } : {}),
    })
  }
}
