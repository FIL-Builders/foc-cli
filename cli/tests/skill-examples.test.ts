import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createCommand } from '../src/commands/dataset/create.ts'
import { detailsCommand } from '../src/commands/dataset/details.ts'
import { listCommand as datasetListCommand } from '../src/commands/dataset/list.ts'
import { terminateCommand } from '../src/commands/dataset/terminate.ts'
import { docsCommand } from '../src/commands/docs.ts'
import { downloadCommand } from '../src/commands/download.ts'
import { multiUploadCommand } from '../src/commands/multi-upload.ts'
import { listCommand as pieceListCommand } from '../src/commands/piece/list.ts'
import { removeCommand } from '../src/commands/piece/remove.ts'
import { listCommand as providerListCommand } from '../src/commands/provider/list.ts'
import { uploadCommand } from '../src/commands/upload.ts'
import { balanceCommand } from '../src/commands/wallet/balance.ts'
import { costsCommand } from '../src/commands/wallet/costs.ts'
import { depositCommand } from '../src/commands/wallet/deposit.ts'
import { fundCommand } from '../src/commands/wallet/fund.ts'
import { initCommand } from '../src/commands/wallet/init.ts'
import { summaryCommand } from '../src/commands/wallet/summary.ts'
import { withdrawCommand } from '../src/commands/wallet/withdraw.ts'

/**
 * Every command example in the skills, checked against the real command
 * definitions.
 *
 * The skills are the interface an agent reads before it runs anything, and a
 * wrong flag there is not a typo — it is a command the agent will confidently
 * issue and a failure it has no way to attribute. Drift is only ever found by
 * someone running the example, which is exactly the moment it costs the most.
 *
 * The command schemas are the source of truth, imported rather than shelled
 * out to, so this runs with no build step and fails on the change that
 * introduces the drift rather than at publish time.
 *
 * The same check runs over the CLI's own `examples`, because help is a skill
 * too: `--withCDN true` shipped in six of them, and the boolean rule below is
 * the reason it was wrong.
 */

const repoRoot = path.resolve(import.meta.dir, '../..')
const skillsDir = path.join(repoRoot, 'skills')

type CommandDef = { args?: any; options?: any; examples?: any[] }

const COMMANDS: Record<string, CommandDef> = {
  'dataset create': createCommand,
  'dataset details': detailsCommand,
  'dataset list': datasetListCommand,
  'dataset terminate': terminateCommand,
  'piece list': pieceListCommand,
  'piece remove': removeCommand,
  'provider list': providerListCommand,
  'wallet balance': balanceCommand,
  'wallet costs': costsCommand,
  'wallet deposit': depositCommand,
  'wallet fund': fundCommand,
  'wallet init': initCommand,
  'wallet summary': summaryCommand,
  'wallet withdraw': withdrawCommand,
  docs: docsCommand,
  download: downloadCommand,
  'multi-upload': multiUploadCommand,
  upload: uploadCommand,
}

/** Built-in flags incur accepts on every command. */
const GLOBAL_BOOL = new Set([
  'help',
  'version',
  'schema',
  'json',
  'llms',
  'llmsFull',
  'fullOutput',
  'tokenCount',
  'mcp',
  'debug',
])
const GLOBAL_VALUE = new Set([
  'format',
  'filterOutput',
  'tokenLimit',
  'tokenOffset',
])
/** Short flags that take a value, so the next token is not a positional. */
const SHORT_VALUE = new Set(['c', 'o', 'd'])

const toCamel = (s: string) =>
  s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())

function shapeOf(schema: any): Record<string, any> {
  return schema?.shape ?? {}
}

/** Zod treats a field that accepts `undefined` as optional. */
function isOptional(field: any): boolean {
  return field?.safeParse?.(undefined).success === true
}

function optionType(def: CommandDef, name: string): string | null {
  const field = shapeOf(def.options)[name]
  if (!field) return null
  // Unwrap optional/default wrappers to reach the primitive.
  let inner = field
  for (let i = 0; i < 5 && inner?._zod?.def?.innerType; i++) {
    inner = inner._zod.def.innerType
  }
  return inner?._zod?.def?.type ?? null
}

/** Shell-ish tokenizer that honours quotes, so "two words" stays one token. */
type Token = { value: string; quoted: boolean }

function tokenize(line: string): Token[] {
  const out: Token[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  for (const m of line.matchAll(re)) {
    out.push({
      value: m[1] ?? m[2] ?? m[3] ?? '',
      quoted: m[1] !== undefined || m[2] !== undefined,
    })
  }
  return out
}

/** Problems with one invocation, as human-readable strings. */
function checkInvocation(commandPath: string, body: Token[]) {
  const def = COMMANDS[commandPath]
  const problems: string[] = []
  const positionals: string[] = []
  let introspection = false
  if (!def) return problems

  for (let i = 0; i < body.length; i++) {
    const token = body[i]
    if (!token) continue
    const t = token.value
    if (token.quoted) {
      positionals.push(t)
      continue
    }
    // A synopsis placeholder (`[--prompt <text>]`), not a real argument.
    if (t.startsWith('[') || t.startsWith('<')) {
      introspection = true
      continue
    }
    if (t.startsWith('--')) {
      const [rawName = '', inline] = t.slice(2).split('=')
      const name = toCamel(rawName)
      if (['help', 'schema', 'llms', 'llmsFull', 'version'].includes(name)) {
        introspection = true
      }
      const declared = optionType(def, name)
      if (!declared && !GLOBAL_BOOL.has(name) && !GLOBAL_VALUE.has(name)) {
        problems.push(`unknown flag --${rawName}`)
        continue
      }
      if (inline !== undefined) continue
      const type = declared ?? (GLOBAL_BOOL.has(name) ? 'boolean' : 'string')
      const next = body[i + 1]
      if (type === 'boolean') {
        // The parser never reads a boolean's value from the next token, so a
        // trailing word is left over as a positional — and `--flag false`
        // enables the flag. Only `--flag=false` disables it.
        if (
          next &&
          !next.value.startsWith('-') &&
          !next.value.startsWith('[')
        ) {
          problems.push(
            `--${rawName} is a switch but is followed by "${next.value}", which becomes a stray positional (use --${rawName} alone, or --${rawName}=false)`
          )
          positionals.push(next.value)
          i++
        }
      } else if (next && !next.value.startsWith('-')) {
        i++
      }
    } else if (t.startsWith('-') && t.length > 1) {
      if (t === '-h') introspection = true
      const next = body[i + 1]
      if (SHORT_VALUE.has(t.slice(1)) && next && !next.value.startsWith('-'))
        i++
    } else {
      positionals.push(t)
    }
  }

  if (introspection) return problems

  const argShape = shapeOf(def.args)
  const argNames = Object.keys(argShape)
  const required = argNames.filter((n) => !isOptional(argShape[n]))
  if (positionals.length < required.length) {
    problems.push(
      `needs <${required.join('> <')}> but got ${positionals.length} positional(s)`
    )
  }
  if (positionals.length > argNames.length) {
    problems.push(
      `takes ${argNames.length} positional(s) but got ${positionals.length} [${positionals.join(' | ')}] — extras are silently dropped`
    )
  }
  return problems
}

/** Resolve `foc-cli <a> <b> …` to a known command path, or null. */
function resolveCommand(words: Token[]): string | null {
  const first = words[0]?.value
  const second = words[1]?.value
  if (first && second && COMMANDS[`${first} ${second}`]) {
    return `${first} ${second}`
  }
  if (first && COMMANDS[first]) return first
  return null
}

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => path.join(e.parentPath, e.name))
}

describe('skill examples match the real command definitions', () => {
  test('every command module is registered here', () => {
    // A new command that nobody adds to COMMANDS would be silently exempt from
    // every check below, which is the one way this gate fails open.
    const modules = readdirSync(path.join(repoRoot, 'cli/src/commands'), {
      recursive: true,
      withFileTypes: true,
    }).filter(
      (e) => e.isFile() && e.name.endsWith('.ts') && e.name !== 'index.ts'
    )
    expect(Object.keys(COMMANDS).length).toBe(modules.length)
  })

  test('no skill example uses an unknown flag, drops a required arg, or mis-passes a switch', () => {
    const problems: string[] = []
    for (const file of markdownFiles(skillsDir)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        const clean = line.replace(/^\s*[$>]\s*/, '').trim()
        if (!/^(npx\s+)?foc-cli(@[\w.-]+)?\s/.test(clean)) return
        const tokens = tokenize((clean.split(/\s+#/)[0] ?? '').trim())
        const words =
          tokens[0]?.value === 'npx' ? tokens.slice(2) : tokens.slice(1)
        const commandPath = resolveCommand(words)
        if (!commandPath) return // mcp/skills/completions, or prose
        const body = words.slice(commandPath.split(' ').length)
        for (const problem of checkInvocation(commandPath, body)) {
          problems.push(
            `${path.relative(repoRoot, file)}:${index + 1} [${commandPath}] ${problem}\n    ${clean}`
          )
        }
      })
    }
    expect(problems).toEqual([])
  })

  test("the CLI's own help examples are runnable", () => {
    const problems: string[] = []
    for (const [commandPath, def] of Object.entries(COMMANDS)) {
      for (const example of def.examples ?? []) {
        // incur renders an example as `<args…> --opt value`, and a `true`
        // value becomes the literal word `true` rather than a bare switch.
        const parts: string[] = []
        for (const value of Object.values(example.args ?? {})) {
          parts.push(String(value))
        }
        for (const [key, value] of Object.entries(example.options ?? {})) {
          parts.push(`--${key} ${value}`)
        }
        const rendered = parts.join(' ')
        for (const problem of checkInvocation(
          commandPath,
          tokenize(rendered)
        )) {
          problems.push(
            `${commandPath}: ${problem}\n    foc-cli ${commandPath} ${rendered}`
          )
        }
      }
    }
    expect(problems).toEqual([])
  })
})
