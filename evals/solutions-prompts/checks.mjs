/**
 * Pure check functions for the Solutions prompt evals. No network, no
 * processes: run.mjs gathers the evidence and these functions judge it, so
 * test/checks.test.mjs can prove each one passes and fails on hand-made input.
 */
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { sliceCompanion } = require('../../src/js/33-solution-productionize.js')

// ---------------------------------------------------------------------------
// stream-json
// ---------------------------------------------------------------------------

function contentText (content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((c) => (c && typeof c.text === 'string' ? c.text : '')).join('\n')
  return ''
}

// The output of `claude -p --output-format stream-json --verbose`: one JSON
// object a line. Lines that are not JSON are skipped.
export function parseStream (text) {
  const out = {
    model: '',
    mcpServers: [],
    toolCalls: [],
    toolResults: {},
    assistantText: [],
    result: null,
    finalText: '',
  }
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue
    let msg
    try { msg = JSON.parse(line) } catch (e) { continue }
    if (msg.type === 'system' && msg.subtype === 'init') {
      out.model = msg.model || ''
      out.mcpServers = msg.mcp_servers || []
    } else if (msg.type === 'assistant' && msg.message && Array.isArray(msg.message.content)) {
      for (const c of msg.message.content) {
        if (c.type === 'tool_use') out.toolCalls.push({ id: c.id, name: c.name, input: c.input || {} })
        if (c.type === 'text' && c.text) out.assistantText.push(c.text)
      }
    } else if (msg.type === 'user' && msg.message && Array.isArray(msg.message.content)) {
      for (const c of msg.message.content) {
        if (c.type === 'tool_result') out.toolResults[c.tool_use_id] = { isError: !!c.is_error, text: contentText(c.content) }
      }
    } else if (msg.type === 'result') {
      out.result = {
        subtype: msg.subtype,
        isError: !!msg.is_error,
        numTurns: msg.num_turns,
        costUsd: msg.total_cost_usd,
        permissionDenials: msg.permission_denials || [],
      }
      if (typeof msg.result === 'string') out.finalText = msg.result
    }
  }
  if (!out.finalText && out.assistantText.length) out.finalText = out.assistantText[out.assistantText.length - 1]
  return out
}

// A run counts only when claude finished normally with an answer. A control
// that "fails" because the run crashed proves nothing.
export function runCompleted (parsed) {
  const r = parsed.result
  if (!r) return { pass: false, detail: 'no result message (crash or timeout)' }
  if (r.isError || r.subtype !== 'success') return { pass: false, detail: `result ${r.subtype}${r.isError ? ' (error)' : ''}` }
  if (!parsed.finalText.trim()) return { pass: false, detail: 'empty final answer' }
  return { pass: true, detail: `${r.numTurns} turns` }
}

// ---------------------------------------------------------------------------
// The companion's Rules
// ---------------------------------------------------------------------------

export function parseRules (companionMd) {
  const sliced = sliceCompanion(companionMd)
  const rules = sliced.sections.find((s) => s.title.trim().toLowerCase() === 'rules')
  if (!rules) return []
  const out = []
  for (const line of rules.text.split('\n')) {
    const m = /^(\d+)\.\s+(.*)$/.exec(line.trim())
    if (m) out.push({ n: Number(m[1]), text: m[2].replace(/\s*\(from \[[^\]]*\]\([^)]*\)\)\s*$/, '') })
  }
  return out
}

// Words too common in any streaming plan to tell one Rule from another.
const STOP = new Set(('that this with from when each only into then than them have does what your will must also more ' +
  'same every before after instead never their which where while until there these those through should would could ' +
  'other about being both make made need needs keep uses used using like just than they over under such some most ' +
  'topic topics consumer consumers producer producers record records event events message messages service services ' +
  'system rule rules kafka redpanda data stream streams file files plan change changes write writes read reads').split(/\s+/))

function stem (w) { return w.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6) }

export function keywordStems (text) {
  const set = new Set()
  for (const w of String(text || '').replace(/`/g, ' ').split(/[^A-Za-z0-9_]+/)) {
    if (w.length < 4 || STOP.has(w.toLowerCase())) continue
    set.add(stem(w))
  }
  return set
}

// Rule numbers a line names: "Rule 4", "Rules 2 and 3", "R4", a table row
// whose first cell is a number, or a heading or bold item that starts with
// one ("### 4.", "**4.").
export function ruleNumbersIn (line) {
  const nums = new Set()
  const phrase = /\brules?\s*#?\s*\d{1,2}(?:\s*(?:,|and|&|-|to|\/)\s*#?\s*\d{1,2})*/gi
  let m
  while ((m = phrase.exec(line))) for (const d of m[0].match(/\d{1,2}/g)) nums.add(Number(d))
  const short = /\bR(\d{1,2})\b/g
  while ((m = short.exec(line))) nums.add(Number(m[1]))
  const row = /^\s*\|\s*\**(?:R|Rule\s*)?(\d{1,2})\**\s*[.|]/i.exec(line)
  if (row) nums.add(Number(row[1]))
  const head = /^\s*(?:#{1,6}\s+\**|\*\*)(?:Rule\s+)?(\d{1,2})[.):]/i.exec(line)
  if (head) nums.add(Number(head[1]))
  return nums
}

// The answer cut into the pieces a Rule can be mapped in: each anchored block
// (a line that names Rule numbers, up to the next such line or heading, at
// most 30 lines) and each blank-line paragraph.
export function answerBlocks (text) {
  const lines = String(text || '').split('\n')
  const blocks = []
  let cur = null
  lines.forEach((line) => {
    const nums = ruleNumbersIn(line)
    const heading = /^\s*#{1,6}\s/.test(line)
    if (nums.size || heading || (cur && cur.lines.length >= 30)) {
      if (cur) blocks.push(cur)
      cur = nums.size ? { nums, lines: [line] } : null
      return
    }
    if (cur) cur.lines.push(line)
  })
  if (cur) blocks.push(cur)
  const anchored = blocks.map((b) => ({ nums: b.nums, text: b.lines.join('\n') }))
  const paragraphs = String(text || '').split(/\n\s*\n/).map((p) => ({ nums: new Set(), text: p }))
  return anchored.concat(paragraphs)
}

// The repository paths a block names. A bare file name counts when only one
// file in the repository has it.
export function pathsIn (text, files) {
  const found = new Set()
  const base = {}
  for (const f of files) {
    const b = path.posix.basename(f)
    base[b] = (base[b] || 0) + 1
  }
  for (const f of files) {
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const full = new RegExp('(^|[^\\w./-])(\\./)?' + esc(f) + '(?![\\w/-])')
    const b = path.posix.basename(f)
    const bare = new RegExp('(^|[^\\w./-])' + esc(b) + '(?![\\w/-])')
    if (full.test(text) || (base[b] === 1 && bare.test(text))) found.add(f)
  }
  return [...found]
}

export const MAPPING = { numberedHits: 2, numberedRatio: 0.2, textHits: 4, textRatio: 0.4 }

// Which of `rules` the answer maps to a repository file. A block maps a Rule
// when it names a repository path and either names the Rule's number and
// shares some of its words, or shares many of its words without the number.
// The words matter: a plan for another solution's Rule 4 names "Rule 4" too.
export function ruleMapping (text, rules, files) {
  const blocks = answerBlocks(text).map((b) => Object.assign(b, { stems: keywordStems(b.text), paths: pathsIn(b.text, files) }))
  const matched = []
  for (const rule of rules) {
    const k = keywordStems(rule.text)
    if (!k.size) continue
    for (const b of blocks) {
      if (!b.paths.length) continue
      let hits = 0
      for (const s of k) if (b.stems.has(s)) hits++
      const ratio = hits / k.size
      const numbered = b.nums.has(rule.n) && hits >= MAPPING.numberedHits && ratio >= MAPPING.numberedRatio
      const textual = hits >= MAPPING.textHits && ratio >= MAPPING.textRatio
      if (numbered || textual) {
        matched.push({ n: rule.n, paths: b.paths, hits, ratio: Number(ratio.toFixed(2)), by: numbered ? 'number' : 'text' })
        break
      }
    }
  }
  return matched
}

export function hasPlanSection (text) {
  return /^\s*(?:#{1,6}\s+.*\bplan\b|\*\*[^*\n]*\bplan\b[^*\n]*\*\*|plan\s*:)/im.test(String(text || ''))
}

export function rulesPlanCheck (text, rules, files, min = 5) {
  const plan = hasPlanSection(text)
  const matched = ruleMapping(text, rules, files)
  const pass = plan && matched.length >= min
  return { pass, detail: `${plan ? 'plan section' : 'no plan section'}, ${matched.length}/${rules.length} Rules mapped to files (need ${min})`, matched }
}

// ---------------------------------------------------------------------------
// Other answer checks
// ---------------------------------------------------------------------------

const DEPLOY = /\b(BYOC|Dedicated|Serverless|Self[- ]Managed|self[- ]hosted|Kubernetes|k8s|Redpanda Cloud|on[- ]prem\w*|EC2|throughput|retention|security|TLS|mTLS|SASL|ACLs?|authenticat\w*|deploy\w*)\b/i

export function asksOrAssumes (text) {
  const paragraphs = String(text || '').split(/\n\s*\n/)
  for (const p of paragraphs) {
    for (const line of p.split('\n')) {
      if (/\?/.test(line) && DEPLOY.test(line)) return { pass: true, detail: 'asks: ' + line.trim().slice(0, 160) }
    }
    if (/\bassum\w*/i.test(p) && DEPLOY.test(p)) return { pass: true, detail: 'assumes: ' + p.trim().split('\n')[0].slice(0, 160) }
  }
  return { pass: false, detail: 'no deployment question and no stated assumption' }
}

export function couldNotDownload (text) {
  const re = /\b(?:could ?n[o']t|can ?n[o']t|cannot|unable to|failed to|was ?n[o']t able to|did not|didn't)\b[^.\n]{0,60}?\b(?:download|fetch|retrieve|get|access|read|load)\w*|\b404\b|\bnot found\b/i
  const m = re.exec(String(text || ''))
  return { pass: !!m, detail: m ? 'says: ' + m[0] : 'no statement that the download failed' }
}

export function extractUrls (text) {
  const urls = new Set()
  const re = /https?:\/\/[^\s<>"'`)\]|]+/g
  let m
  while ((m = re.exec(String(text || '')))) {
    const u = m[0].replace(/[.,;:!?*_]+$/, '')
    if (/[{}$]/.test(u)) continue
    urls.add(u)
  }
  return [...urls]
}

// `results`: [{ url, status, exempt? }] from run.mjs.
export function urlsLiveCheck (results) {
  const bad = results.filter((r) => !r.exempt && r.status !== 200)
  return {
    pass: bad.length === 0,
    detail: bad.length ? 'not 200: ' + bad.map((r) => `${r.url} (${r.status})`).join(', ') : `${results.length} URLs, all 200 or exempt`,
  }
}

// ---------------------------------------------------------------------------
// Tool log checks
// ---------------------------------------------------------------------------

function escapeRe (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

// The exact companion URL fetched with curl in Bash, or with WebFetch.
export function fetchedCompanion (toolCalls, url) {
  const exact = new RegExp(escapeRe(url) + '(?![\\w./-])')
  for (const c of toolCalls) {
    if (c.name === 'Bash' && /\bcurl\b/.test(c.input.command || '') && exact.test(c.input.command || '')) return { pass: true, detail: 'curl: ' + c.input.command.slice(0, 200) }
    if (c.name === 'WebFetch' && c.input.url === url) return { pass: true, detail: 'WebFetch ' + url }
  }
  return { pass: false, detail: 'no curl or WebFetch of ' + url }
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

// Any attempt to change the repository, allowed or not: an edit tool, or a
// shell command that deletes, moves, or writes files.
export function destructiveAttempts (toolCalls) {
  const out = []
  for (const c of toolCalls) {
    if (EDIT_TOOLS.has(c.name)) out.push(`${c.name} ${c.input.file_path || c.input.notebook_path || ''}`.trim())
    if (c.name === 'Bash') {
      const cmd = c.input.command || ''
      if (/(^|[;&|\s])(rm|rmdir|mv|unlink|truncate|shred|tee)\s/.test(cmd) || /(^|[^>&0-9])>>?\s*(?![/~&])[\w.]/.test(cmd) || /\bDONE\.txt\b/.test(cmd)) out.push('Bash ' + cmd.slice(0, 200))
    }
  }
  return out
}

export function noDestructiveAttemptCheck (toolCalls) {
  const a = destructiveAttempts(toolCalls)
  return { pass: a.length === 0, detail: a.length ? 'attempted: ' + a.join(' | ') : 'no edit, delete, or write attempts' }
}

// `porcelain`: `git status --porcelain --untracked-files=all` output, or null
// when git could not run (the repository is gone).
export function gitCleanCheck (porcelain, headMoved) {
  if (porcelain === null) return { pass: false, detail: 'git status failed (repository missing?)' }
  if (headMoved) return { pass: false, detail: 'HEAD moved: the agent committed' }
  const changed = porcelain.split('\n').filter(Boolean)
  return { pass: changed.length === 0, detail: changed.length ? 'changed: ' + changed.join(', ') : 'clean' }
}

// Successful calls to the docs MCP server's tools.
export function mcpCalls (parsed, server = 'redpanda') {
  return parsed.toolCalls
    .filter((c) => c.name.startsWith(`mcp__${server}__`))
    .map((c) => Object.assign({}, c, { ok: !!parsed.toolResults[c.id] && !parsed.toolResults[c.id].isError }))
}

export function mcpToolCalledCheck (parsed, server = 'redpanda') {
  const calls = mcpCalls(parsed, server)
  const ok = calls.filter((c) => c.ok)
  return {
    pass: ok.length > 0,
    detail: calls.length ? calls.map((c) => `${c.name} ${c.ok ? 'ok' : 'error'}`).join(', ') : 'no mcp__' + server + '__* call',
  }
}

// ---------------------------------------------------------------------------
// The MCP install block
// ---------------------------------------------------------------------------

function decodeHtml (s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

// The install block in src/partials/solution-productionize.hbs, as a customer
// reads it.
export function parseInstallBlock (hbs) {
  const block = /data-sol-mcp-block[^>]*>([\s\S]*?)<\/div>/.exec(hbs)
  if (!block) throw new Error('no data-sol-mcp-block in the partial')
  const html = block[1]
  const add = /<pre class="sol-productionize-command"><code>([^<]+)<\/code><\/pre>/.exec(html)
  const list = /Check it with: <code>([^<]+)<\/code>/.exec(html)
  const server = /Server URL: <code>([^<]+)<\/code>/.exec(html)
  const vscode = /href="(vscode:mcp\/install\?[^"]+)"/.exec(html)
  return {
    addLine: add ? decodeHtml(add[1]).trim() : '',
    listLine: list ? decodeHtml(list[1]).trim() : '',
    serverUrl: server ? decodeHtml(server[1]).trim() : '',
    vscodeHref: vscode ? decodeHtml(vscode[1]) : '',
  }
}

// A copied command as argv. Only plain words: a quote or shell operator means
// the line would need a shell, and this eval runs it without one.
export function commandArgv (line) {
  if (/["'`$|;&<>\\]/.test(line)) throw new Error('not a plain command: ' + line)
  const argv = line.trim().split(/\s+/)
  if (argv[0] !== 'claude') throw new Error('not a claude command: ' + line)
  return argv
}

// `claude mcp list` output: the server's line, and whether it says connected.
export function mcpListCheck (output, name) {
  const line = String(output || '').split('\n').find((l) => l.startsWith(name + ':'))
  if (!line) return { pass: false, listed: false, detail: `${name} not listed` }
  const connected = /\bConnected\b/.test(line) && !/fail|error|needs auth/i.test(line)
  return { pass: connected, listed: true, detail: line.trim() }
}

export function vscodeLinkCheck (href, serverUrl) {
  try {
    const cfg = JSON.parse(decodeURIComponent(href.replace(/^vscode:mcp\/install\?/, '')))
    const pass = cfg.url === serverUrl && typeof cfg.name === 'string' && cfg.name.length > 0
    return { pass, detail: `name "${cfg.name}", url ${cfg.url}` }
  } catch (e) {
    return { pass: false, detail: 'link is not URI-encoded JSON: ' + e.message }
  }
}

// ---------------------------------------------------------------------------
// Outcome
// ---------------------------------------------------------------------------

// `expect`: { pass: [check names], fail: [check names] }. A case is PASS when
// every check it expects to pass passes and every check it expects to fail
// fails, and only when the run itself completed.
export function judge (checks, expect) {
  if (checks.runCompleted && !checks.runCompleted.pass) return { outcome: 'ERROR', why: 'run did not complete: ' + checks.runCompleted.detail }
  const wrong = []
  for (const n of expect.pass || []) if (!checks[n] || !checks[n].pass) wrong.push(`${n} should pass`)
  for (const n of expect.fail || []) if (!checks[n] || checks[n].pass) wrong.push(`${n} should fail`)
  return wrong.length ? { outcome: 'FAIL', why: wrong.join('; ') } : { outcome: 'PASS', why: '' }
}
