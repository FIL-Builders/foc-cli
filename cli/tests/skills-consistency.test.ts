import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import packageJson from '../package.json' with { type: 'json' }

// The skills ship inside the npm package (see package.json "files") and are
// installed standalone via skills.sh/ClawHub, so their frontmatter must track
// the CLI release: same version, same license, and any `foc-cli@x.y.z` pin
// example in the docs must reference the version actually being published.

const repoRoot = path.resolve(import.meta.dir, '../..')
const skillsDir = path.join(repoRoot, 'skills')

const skillDirs = readdirSync(skillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)

function parseFrontmatter(source: string): Record<string, string> {
  // Tolerate CRLF line endings and YAML-quoted scalars so an editor or OS
  // change doesn't silently break the consistency gate.
  const block = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!block) return {}
  const fields: Record<string, string> = {}
  for (const line of block[1].split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.+)$/)
    if (match) {
      let value = match[2].trim()
      const quote = value[0]
      if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
        value = value.slice(1, -1)
      }
      fields[match[1]] = value
    }
  }
  return fields
}

describe('skills stay in sync with the published CLI package', () => {
  test('at least the foc-cli and foc-docs skills exist', () => {
    expect(skillDirs).toContain('foc-cli')
    expect(skillDirs).toContain('foc-docs')
  })

  for (const name of skillDirs) {
    const skillPath = path.join(skillsDir, name, 'SKILL.md')
    const source = readFileSync(skillPath, 'utf8')
    const frontmatter = parseFrontmatter(source)

    test(`${name}: frontmatter name matches its folder`, () => {
      expect(frontmatter.name).toBe(name)
    })

    test(`${name}: description is present and substantial`, () => {
      expect(frontmatter.description ?? '').not.toBe('')
      expect((frontmatter.description ?? '').length).toBeGreaterThan(100)
    })

    test(`${name}: version matches package.json (${packageJson.version})`, () => {
      expect(frontmatter.version).toBe(packageJson.version)
    })

    test(`${name}: license matches package.json (${packageJson.license})`, () => {
      expect(frontmatter.license).toBe(packageJson.license)
    })
  }

  test('every foc-cli@x.y.z pin in skills and README matches package.json', () => {
    const docs = [
      path.join(repoRoot, 'README.md'),
      ...skillDirs.flatMap((name) => {
        const dir = path.join(skillsDir, name)
        return readdirSync(dir, { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
          .map((entry) => path.join(entry.parentPath, entry.name))
      }),
    ]

    const mismatches: string[] = []
    for (const file of docs) {
      const content = readFileSync(file, 'utf8')
      for (const match of content.matchAll(/foc-cli@(\d+\.\d+\.\d+)/g)) {
        if (match[1] !== packageJson.version) {
          mismatches.push(
            `${path.relative(repoRoot, file)}: foc-cli@${match[1]}`
          )
        }
      }
    }

    expect(mismatches).toEqual([])
  })
})
