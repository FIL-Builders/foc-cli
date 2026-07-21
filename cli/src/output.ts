import * as p from '@clack/prompts'
import { z } from 'incur'
import { isAgent } from './utils.ts'

type LogEntry = { step: string; status: 'done' | 'failed'; error?: string }

const processLogSchema = z
  .array(
    z.object({
      step: z.string(),
      status: z.enum(['done', 'failed']),
      error: z.string().optional(),
    })
  )
  .describe('Step-by-step trail of what the command did')

const ctaSchema = z
  .object({
    description: z.string().optional(),
    commands: z.array(
      z.object({
        command: z.string(),
        args: z.record(z.string(), z.any()).optional(),
        options: z.record(z.string(), z.any()).optional(),
        description: z.string(),
      })
    ),
  })
  .describe('Suggested follow-up commands')

/**
 * Wraps a command's output shape with the envelope fields every agent-mode
 * response actually carries: `processLog` (appended by OutputContext.done)
 * and `cta` (merged into the payload by incur when present). Declaring them
 * here keeps `--schema` truthful — a bare z.object emits
 * `additionalProperties: false`, which every real response would violate.
 */
export function commandOutput<T extends z.ZodRawShape>(shape: T) {
  return z.object({
    ...shape,
    processLog: processLogSchema.optional(),
    cta: ctaSchema.optional(),
  })
}

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
  private spinnerActive = false
  private lastStep: string | null = null
  private c: any

  constructor(c: any) {
    this.c = c
    this.agent = isAgent(c)
    this.spinner = this.agent ? null : p.spinner()
  }

  /**
   * Stop the live spinner, rendering the current step's label as its final
   * line. clack's stop() with no argument blanks the label — which both loses
   * the step text and, when info()/success() interleave with steps, leaves
   * orphan "◇" glyphs from spinners that were created but never started.
   */
  private stopSpinner() {
    if (this.spinnerActive) {
      this.spinner?.stop(this.lastStep ?? '')
      this.spinnerActive = false
    }
  }

  step(message: string) {
    if (
      this.log.length > 0 &&
      this.log[this.log.length - 1].status !== 'failed'
    ) {
      this.log[this.log.length - 1].status = 'done'
    }
    this.log.push({ step: message, status: 'done' })
    this.lastStep = message

    if (!this.agent) {
      if (this.spinnerActive) {
        this.spinner?.message(message)
      } else {
        this.spinner = p.spinner()
        this.spinner.start(message)
        this.spinnerActive = true
      }
    }
  }

  info(message: string) {
    if (!this.agent) {
      this.stopSpinner()
      p.log.info(message)
    }
  }

  success(message: string) {
    if (!this.agent) {
      this.stopSpinner()
      p.log.success(message)
    }
  }

  done(data: any, opts?: DoneOpts) {
    this.stopSpinner()
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

    this.stopSpinner()

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
