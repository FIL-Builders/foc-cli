import { z } from 'incur'
import packageJson from '../../package.json' with { type: 'json' }
import config from '../config.ts'
import { commandOutput, OutputContext } from '../output.ts'

const DOCS_HOST = 'docs.filecoin.cloud'
const LLMS_TXT_URL = `https://${DOCS_HOST}/llms.txt`
const MAX_HEADER_DEPTH = 4 // #### max — skip ##### and deeper

/**
 * `--url` is restricted to the official docs host so the command stays a
 * docs fetcher rather than a general-purpose HTTP client. Accepts a full
 * docs.filecoin.cloud URL or a bare docs path (e.g.
 * "developer-guides/synapse.md"), resolved against the host. Returns null
 * for anything else.
 */
function resolveDocsUrl(input: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    let parsed: URL
    try {
      parsed = new URL(input)
    } catch {
      return null
    }
    if (parsed.hostname !== DOCS_HOST) return null
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    parsed.protocol = 'https:'
    parsed.pathname = normalizeDocsPath(parsed.pathname)
    return parsed.toString()
  }
  // Belt-and-suspenders: the hardcoded origin already prevents cross-host
  // escapes; this just rejects traversal-looking inputs (percent-decoded so
  // %2e%2e doesn't slip through).
  let decoded: string
  try {
    decoded = decodeURIComponent(input)
  } catch {
    return null
  }
  if (decoded.includes('..')) return null
  const parsed = new URL(`https://${DOCS_HOST}/${input.replace(/^\/+/, '')}`)
  parsed.pathname = normalizeDocsPath(parsed.pathname)
  return parsed.toString()
}

/**
 * The docs site serves every page twice: rendered HTML at the pretty path
 * ("developer-guides/synapse/") and clean markdown at the same path with `.md`.
 * Fetching the HTML variant buries an agent in sidebar markup, so pretty paths
 * are rewritten to their markdown mirror.
 */
function normalizeDocsPath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '')
  if (trimmed === '') return pathname // site root has no .md mirror
  const lastSegment = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  return lastSegment.includes('.') ? trimmed : `${trimmed}.md`
}

/**
 * Backstop: never hand rendered HTML to the caller — it's kilobytes of
 * sidebar markup with no doc content. Markdown mirrors never start with a
 * tag, so a leading '<' (or an html content-type) means the page has no
 * markdown mirror at this path.
 */
function isHtmlContent(resp: Response, body: string): boolean {
  const contentType = resp.headers.get('content-type') ?? ''
  return contentType.includes('text/html') || body.trimStart().startsWith('<')
}

interface DocEntry {
  title: string
  url: string
  description: string
  section: string
}

const SITEMAP_INDEX_URL = `https://${DOCS_HOST}/sitemap-index.xml`
const SITEMAP_URL = `https://${DOCS_HOST}/sitemap-0.xml`
// A broad term can match hundreds of the ~1,800 sitemap pages; cap what we
// return so the entry list stays consumable.
const MAX_DEEP_RESULTS = 20

/**
 * The curated llms.txt index is ~30 guide pages; the sitemap is the full site
 * (~1,800 pages) including the complete SDK API reference and changelogs.
 * Sitemap entries carry no descriptions, so titles/sections are derived from
 * the URL path and every URL is rewritten to its markdown mirror.
 */
function parseSitemap(xml: string): DocEntry[] {
  const entries: DocEntry[] = []
  for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    let parsed: URL
    try {
      parsed = new URL(match[1])
    } catch {
      continue
    }
    if (parsed.hostname !== DOCS_HOST) continue
    const segments = parsed.pathname.split('/').filter(Boolean)
    if (segments.length === 0) continue
    parsed.pathname = normalizeDocsPath(parsed.pathname)
    const meaningful = segments.filter((s) => s !== 'toc' && s !== 'namespaces')
    entries.push({
      title: meaningful[meaningful.length - 1] ?? segments[0],
      url: parsed.toString(),
      description: segments.join(' / '),
      section: segments[0],
    })
  }
  return entries
}

/**
 * All docs traffic identifies itself so the docs site's metrics can attribute
 * CLI/agent usage in server logs and analytics without any site-side changes:
 * a foc-cli User-Agent carrying the CLI version and the configured `source`
 * tag (the same attribution tag reported to Synapse; set via
 * `wallet init --source <name>`).
 */
function docsFetch(url: string): Promise<Response> {
  const source = config.get('source') ?? 'foc-cli'
  return fetch(url, {
    // The host allowlist is checked before the request; refusing to follow
    // redirects keeps it true END-TO-END — a 3xx surfaces as !resp.ok instead
    // of silently fetching wherever the redirect points.
    redirect: 'manual',
    headers: {
      'user-agent': `foc-cli/${packageJson.version} (+https://github.com/FIL-Builders/foc-cli; source=${source})`,
    },
  })
}

/**
 * Walk sitemap-index.xml so extra shards are picked up automatically; fall
 * back to the single known shard when the index is unavailable (today the
 * live site has exactly one shard).
 */
async function fetchSitemapEntries(): Promise<DocEntry[] | null> {
  const indexResp = await docsFetch(SITEMAP_INDEX_URL)
  if (indexResp.ok) {
    const shardUrls: string[] = []
    for (const match of (await indexResp.text()).matchAll(
      /<loc>([^<]+)<\/loc>/g
    )) {
      try {
        const parsed = new URL(match[1])
        if (parsed.hostname === DOCS_HOST && parsed.pathname.endsWith('.xml')) {
          shardUrls.push(parsed.toString())
        }
      } catch {
        // skip malformed shard URLs
      }
    }
    if (shardUrls.length > 0) {
      const entries: DocEntry[] = []
      for (const shardUrl of shardUrls) {
        const resp = await docsFetch(shardUrl)
        if (resp.ok) entries.push(...parseSitemap(await resp.text()))
      }
      if (entries.length > 0) return entries
    }
  }
  const resp = await docsFetch(SITEMAP_URL)
  if (!resp.ok) return null
  return parseSitemap(await resp.text())
}

/**
 * Parse llms.txt into entries, filtering out entries under headers deeper than maxDepth.
 * This removes the bulk of API reference entries (##### Functions, etc.)
 */
function parseLlmsTxt(
  text: string,
  maxDepth: number = MAX_HEADER_DEPTH
): DocEntry[] {
  const entries: DocEntry[] = []
  const lines = text.split('\n')
  let currentSection = ''
  let skipSection = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    // Track section headers and check depth
    const headerMatch = line.match(/^(#{1,6})\s+(.*)/)
    if (headerMatch) {
      const depth = headerMatch[1].length
      if (depth > maxDepth) {
        skipSection = true
        continue
      }
      skipSection = false
      currentSection = headerMatch[2]
      continue
    }

    if (skipSection) continue

    // Match markdown links: - [Title](url): Description
    const match = line.match(/^-\s*\[([^\]]+)\]\(([^)]+)\):?\s*(.*)/)
    if (match) {
      entries.push({
        title: match[1],
        url: match[2],
        description: match[3] || match[1],
        section: currentSection,
      })
    }
  }

  return entries
}

/**
 * Filter markdown content to only include sections up to maxDepth header level.
 * Strips everything under headers deeper than maxDepth.
 */
function filterMarkdownByDepth(
  markdown: string,
  maxDepth: number = MAX_HEADER_DEPTH
): string {
  const lines = markdown.split('\n')
  const result: string[] = []
  let skip = false

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,6})\s/)
    if (headerMatch) {
      const depth = headerMatch[1].length
      if (depth > maxDepth) {
        skip = true
        continue
      }
      skip = false
    }

    if (!skip) {
      result.push(line)
    }
  }

  return result
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function matchEntries(entries: DocEntry[], prompt: string): DocEntry[] {
  const terms = prompt
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2)

  const scored = entries.map((entry) => {
    const haystack =
      `${entry.title} ${entry.description} ${entry.section} ${entry.url}`.toLowerCase()
    let score = 0
    for (const term of terms) {
      // Exact word match in title gets bonus
      if (entry.title.toLowerCase().includes(term)) score += 3
      // URL path segments are strong signals
      if (entry.url.toLowerCase().includes(term)) score += 2
      // General match
      if (haystack.includes(term)) score += 1
    }
    return { entry, score }
  })

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.entry)
}

/**
 * Format matched entries as a compact text summary for LLM consumption.
 */
function formatEntriesSummary(entries: DocEntry[]): string {
  const bySection = new Map<string, DocEntry[]>()
  for (const e of entries) {
    const section = e.section || 'General'
    if (!bySection.has(section)) bySection.set(section, [])
    bySection.get(section)?.push(e)
  }

  const parts: string[] = []
  for (const [section, sectionEntries] of bySection) {
    parts.push(`## ${section}`)
    for (const e of sectionEntries) {
      parts.push(`- **${e.title}**: ${e.description}`)
      parts.push(`  URL: ${e.url}`)
    }
    parts.push('')
  }
  return parts.join('\n')
}

export const docsCommand = {
  description:
    'Fetch Filecoin Onchain Cloud documentation. Search the index with --prompt, or fetch a specific page with --url. Content is filtered to reduce size.',
  mcp: {
    annotations: { title: 'Search FOC documentation', readOnlyHint: true },
  },
  options: z.object({
    prompt: z
      .string()
      .optional()
      .describe(
        "What you're looking for — searches the docs index and returns matched entries. If only 1-3 matches, auto-fetches the top result."
      ),
    url: z
      .string()
      .optional()
      .describe(
        'Docs page to fetch: a full docs.filecoin.cloud URL or a path relative to it (e.g. developer-guides/synapse.md). Other hosts are rejected.'
      ),
    maxDepth: z
      .number()
      .int()
      .min(1)
      .max(6)
      .optional()
      .describe(
        'Maximum header depth to include, 1-6 (default 4 = ####). Use 6 for full detail, 2 for high-level overview only.'
      ),
    deep: z
      .boolean()
      .optional()
      .describe(
        'Search the full site sitemap (~1,800 pages incl. the complete SDK API reference and changelogs) instead of the ~30-page curated index. Also used automatically when the curated index has no matches.'
      ),
    debug: z.boolean().optional().describe('Enable debug mode'),
  }),
  output: commandOutput({
    source: z.string(),
    content: z.string(),
    matchedEntries: z
      .array(
        z.object({
          title: z.string(),
          url: z.string(),
          description: z.string(),
          section: z.string(),
        })
      )
      .optional(),
  }),
  examples: [
    {
      options: { prompt: 'upload files' },
      description: 'Find docs about uploading — auto-fetches if few matches',
    },
    {
      options: { prompt: 'split operations' },
      description: 'Find docs about split/manual upload workflows',
    },
    {
      options: { prompt: 'getPdpDataSet', deep: true },
      description:
        'Search the full sitemap — SDK API reference pages, changelogs',
    },
    {
      options: {
        url: 'developer-guides/storage/storage-operations.md',
      },
      description: 'Fetch a doc page by its docs path (filtered to #### depth)',
    },
    {
      options: {
        url: 'https://docs.filecoin.cloud/developer-guides/storage/storage-operations.md',
        maxDepth: 6,
      },
      description: 'Fetch a page with full detail (all header depths)',
    },
  ],
  async run(c: any) {
    const out = new OutputContext(c)
    const maxDepth = c.options.maxDepth ?? MAX_HEADER_DEPTH

    try {
      // If --url is provided, fetch that specific page with depth filtering
      if (c.options.url) {
        const docsUrl = resolveDocsUrl(c.options.url)
        if (!docsUrl) {
          return out.fail(
            'INVALID_DOCS_URL',
            `--url only accepts ${DOCS_HOST} pages. Pass a full https://${DOCS_HOST}/... URL or a docs path like developer-guides/synapse.md`
          )
        }
        out.step(`Fetching ${docsUrl}`)
        const resp = await docsFetch(docsUrl)
        if (!resp.ok) {
          return out.fail(
            'FETCH_FAILED',
            `Failed to fetch ${docsUrl}: ${resp.status} ${resp.statusText}`,
            {
              retryable: true,
              cta: {
                description: 'Try searching the docs index:',
                commands: [
                  {
                    command: 'docs',
                    options: { prompt: 'getting started' },
                    description: 'Search for getting started guides',
                  },
                ],
              },
            }
          )
        }

        const rawContent = await resp.text()
        if (isHtmlContent(resp, rawContent)) {
          return out.fail(
            'HTML_RESPONSE',
            `${docsUrl} returned HTML instead of markdown — this page has no markdown mirror. Search for the topic instead with --prompt.`,
            {
              cta: {
                description: 'Search the docs index:',
                commands: [
                  {
                    command: 'docs',
                    options: { prompt: 'getting started' },
                    description: 'Search for a topic instead of a URL',
                  },
                ],
              },
            }
          )
        }
        const content = filterMarkdownByDepth(rawContent, maxDepth)

        return out.done(
          {
            source: docsUrl,
            content,
          },
          {
            cta: {
              description:
                'Need more detail? Re-fetch with --maxDepth 6, or explore related docs:',
              commands: [
                ...(maxDepth < 6
                  ? [
                      {
                        command: 'docs',
                        options: { url: docsUrl, maxDepth: 6 },
                        description: 'Fetch this page with full detail',
                      },
                    ]
                  : []),
                {
                  command: 'docs',
                  options: { prompt: 'storage' },
                  description: 'Search for more storage docs',
                },
              ],
            },
          }
        )
      }

      // Default: fetch llms.txt index
      out.step('Fetching docs index')
      const resp = await docsFetch(LLMS_TXT_URL)
      if (!resp.ok) {
        return out.fail(
          'FETCH_FAILED',
          `Failed to fetch docs index: ${resp.status} ${resp.statusText}`,
          { retryable: true }
        )
      }

      const text = await resp.text()
      const allEntries = parseLlmsTxt(text, maxDepth)

      // If --prompt is provided, search and potentially auto-fetch
      if (c.options.prompt) {
        out.step(`Searching for "${c.options.prompt}"`)
        let matched: DocEntry[]
        if (c.options.deep) {
          const sitemapEntries = await fetchSitemapEntries()
          if (!sitemapEntries) {
            return out.fail(
              'FETCH_FAILED',
              `Failed to fetch the site sitemap at ${SITEMAP_URL}`,
              { retryable: true }
            )
          }
          matched = matchEntries(sitemapEntries, c.options.prompt).slice(
            0,
            MAX_DEEP_RESULTS
          )
        } else {
          matched = matchEntries(allEntries, c.options.prompt)
          if (matched.length === 0) {
            // The curated index is only ~30 guide pages; before giving up,
            // search the full sitemap (API reference, changelogs, ...).
            out.step('No curated matches — searching the full sitemap')
            const sitemapEntries = await fetchSitemapEntries()
            if (!sitemapEntries) {
              // A failed sitemap fetch must not masquerade as "no matches" —
              // that would tell the agent the topic doesn't exist.
              return out.fail(
                'FETCH_FAILED',
                `No curated matches and the site sitemap could not be fetched (${SITEMAP_INDEX_URL})`,
                { retryable: true }
              )
            }
            matched = matchEntries(sitemapEntries, c.options.prompt).slice(
              0,
              MAX_DEEP_RESULTS
            )
          }
        }

        if (matched.length === 0) {
          // No matches — return compact index for browsing
          const summary = formatEntriesSummary(allEntries)
          return out.done(
            {
              source: LLMS_TXT_URL,
              content: summary,
              matchedEntries: allEntries,
            },
            {
              cta: {
                description: `No matches for "${c.options.prompt}". Browse these pages:`,
                commands: allEntries.slice(0, 5).map((e) => ({
                  command: 'docs',
                  options: { url: e.url },
                  description: `${e.title}: ${e.description}`,
                })),
              },
            }
          )
        }

        // Auto-fetch: if 1-3 matches, fetch the top result directly
        if (matched.length <= 3) {
          const topEntry = matched[0]
          out.step(`Auto-fetching top match: ${topEntry.title}`)

          const pageResp = await docsFetch(topEntry.url)
          // An HTML body means this page has no markdown mirror — treat it
          // like a failed fetch and fall through to the entry list rather
          // than handing the agent sidebar markup.
          const rawContent = pageResp.ok ? await pageResp.text() : null
          if (rawContent !== null && !isHtmlContent(pageResp, rawContent)) {
            const content = filterMarkdownByDepth(rawContent, maxDepth)

            // Include other matches as CTAs
            const otherMatches = matched.slice(1).map((e) => ({
              command: 'docs',
              options: { url: e.url },
              description: `${e.title}: ${e.description}`,
            }))

            return out.done(
              {
                source: topEntry.url,
                content,
                matchedEntries: matched,
              },
              {
                cta: {
                  description:
                    matched.length > 1
                      ? `Also matched ${matched.length - 1} other page(s):`
                      : 'Explore more:',
                  commands: [
                    ...otherMatches,
                    ...(maxDepth < 6
                      ? [
                          {
                            command: 'docs',
                            options: { url: topEntry.url, maxDepth: 6 },
                            description: 'Re-fetch with full detail',
                          },
                        ]
                      : []),
                    {
                      command: 'docs',
                      options: { prompt: 'storage' },
                      description: 'Search for more docs',
                    },
                  ],
                },
              }
            )
          }
          // If fetch fails, fall through to returning entry list
        }

        // Multiple matches — return compact entry list (not full llms.txt!)
        const summary = formatEntriesSummary(matched)

        const ctaCommands = matched.slice(0, 5).map((e) => ({
          command: 'docs',
          options: { url: e.url },
          description: `${e.title}: ${e.description}`,
        }))

        return out.done(
          {
            source: LLMS_TXT_URL,
            content: summary,
            matchedEntries: matched,
          },
          {
            cta: {
              description: `Found ${matched.length} relevant page(s). Fetch one:`,
              commands: ctaCommands,
            },
          }
        )
      }

      // No prompt — return compact index summary (not raw llms.txt)
      const summary = formatEntriesSummary(allEntries)

      const ctaCommands = allEntries.slice(0, 5).map((e) => ({
        command: 'docs',
        options: { url: e.url },
        description: `${e.title}: ${e.description}`,
      }))

      return out.done(
        {
          source: LLMS_TXT_URL,
          content: summary,
          matchedEntries: allEntries,
        },
        {
          cta: {
            description: 'Fetch a specific page or search:',
            commands: [
              ...ctaCommands,
              {
                command: 'docs',
                options: { prompt: 'upload storage' },
                description: 'Or search with --prompt',
              },
            ],
          },
        }
      )
    } catch (error) {
      if (c.options.debug) console.error(error)
      return out.fail('DOCS_FETCH_FAILED', (error as Error).message, {
        retryable: true,
      })
    }
  },
}
