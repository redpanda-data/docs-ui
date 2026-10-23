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
    tools: [],
    toolCalls: [],
    toolResults: {},
    assistantText: [],
    result: null,
    finalText: '',
    // One entry per user turn: the answer that turn ended with.
    turnTexts: [],
    denied: new Set(),
  }
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue
    let msg
    try { msg = JSON.parse(line) } catch (e) { continue }
    if (msg.type === 'system' && msg.subtype === 'init') {
      out.model = msg.model || ''
      out.mcpServers = msg.mcp_servers || []
      out.tools = msg.tools || []
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
      for (const d of out.result.permissionDenials) if (d && d.tool_use_id) out.denied.add(d.tool_use_id)
      if (typeof msg.result === 'string') out.finalText = msg.result
      out.turnTexts.push(typeof msg.result === 'string' ? msg.result : '')
      out.turns = (out.turns || 0) + (msg.num_turns || 0)
    }
  }
  if (!out.finalText && out.assistantText.length) out.finalText = out.assistantText[out.assistantText.length - 1]
  for (const id of out.denied) if (out.toolResults[id]) out.toolResults[id].denied = true
  // Everything the agent told the user, across turns.
  out.allText = out.turnTexts.filter(Boolean).join('\n\n')
  if (!out.allText) out.allText = out.finalText
  return out
}

// What happened to one tool call: `ran` when it has a result and the
// permission check did not refuse it, `ok` when it also did not error.
export function toolOutcome (parsed, call) {
  const r = parsed.toolResults[call.id]
  const ran = !!r && !r.denied && !parsed.denied.has(call.id)
  return { ran, ok: ran && !r.isError, text: r ? r.text : '' }
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

// Suffix stripping, so "waiting", "waits", and "wait", or "dropped" and
// "dropping", are one word. A 6-character prefix splits them ("waitin" vs
// "wait") and undercounts a plan that words a Rule its own way.
export function stem (w) {
  let s = w.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (s.length > 5 && s.endsWith('ies')) s = s.slice(0, -3) + 'y'
  else if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3)
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2)
  else if (s.length > 4 && /(?:ss|x|ch|sh)es$/.test(s)) s = s.slice(0, -2)
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1)
  if (/([b-df-hj-np-tv-z])\1$/.test(s) && !/(?:ll|ss|zz)$/.test(s)) s = s.slice(0, -1)
  if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1)
  return s
}

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

// Whether the answer maps the companion's Rules to this repository. This is
// what the Sources section buys: an agent that read the companion can do it
// with or without the Steps.
export function rulesMappedCheck (text, rules, files, min = 5) {
  const matched = ruleMapping(text, rules, files)
  return { pass: matched.length >= min, detail: `${matched.length}/${rules.length} Rules mapped to files (need ${min})`, matched }
}

// Whether the agent wrote a plan and stopped before changing anything. This
// is what Steps 5 and 6 buy, so it is judged apart from the mapping.
export function planBeforeChangeCheck (text, toolCalls) {
  const plan = hasPlanSection(text)
  const attempts = destructiveAttempts(toolCalls)
  const pass = plan && attempts.length === 0
  return { pass, detail: `${plan ? 'plan section' : 'no plan section'}, ${attempts.length ? 'change attempts: ' + attempts.slice(0, 3).join(' | ') : 'no change attempts'}` }
}

// ---------------------------------------------------------------------------
// Other answer checks
// ---------------------------------------------------------------------------

// The three things Step 3 says to ask about. "deploy" alone is not one:
// "Should I deploy this?" asks nothing about the deployment.
const TOPICS = {
  platform: /\b(BYOC|Dedicated|Serverless|Self[- ]Managed|self[- ]hosted|Kubernetes|k8s|Redpanda Cloud|on[- ]prem\w*|EC2|AWS|GCP|Azure|cloud provider|where (?:does |will |do )?(?:Redpanda|the cluster|it|you) runs?)\b/i,
  throughput: /\b(throughput|retention|MB\/s|events? (?:a|per) second|messages? (?:a|per) second|peak (?:rate|load|traffic)|volume)\b/i,
  security: /\b(security|TLS|mTLS|SASL|SCRAM|OIDC|ACLs?|authenticat\w*|authori[sz]\w*|encrypt\w*)\b/i,
}

function topicsIn (text) {
  return Object.keys(TOPICS).filter((k) => TOPICS[k].test(text))
}

const LEAD_IN = /\b(know|tell me|need (?:to know|from you)|questions?|confirm|clarify|before I (?:plan|start|go on))\b/i
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/

// The parts of an answer that ask the reader something or state an
// assumption: lines with a question mark, a lead-in line ("It would help to
// know these now:") with the list under it, and paragraphs that assume.
export function askingText (text) {
  const lines = String(text || '').split('\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/\?/.test(line)) out.push(line)
    if (LEAD_IN.test(line) && /[:?]\s*\**\s*$/.test(line)) {
      let j = i + 1
      while (j < lines.length && !lines[j].trim()) j++
      while (j < lines.length && (LIST_ITEM.test(lines[j]) || (/^\s{2,}\S/.test(lines[j]) && j > i + 1))) out.push(lines[j++])
    }
  }
  for (const p of String(text || '').split(/\n\s*\n/)) if (/\bassum\w*/i.test(p)) out.push(p)
  return out.join('\n')
}

// Step 3: the agent asks about, or states what it assumes for, at least two
// of where Redpanda runs, throughput or retention, and security.
export function asksOrAssumes (text, min = 2) {
  const asking = askingText(text)
  const found = topicsIn(asking)
  return {
    pass: found.length >= min,
    detail: found.length ? `asks or assumes about ${found.join(', ')} (need ${min} of 3)` : 'no deployment question and no stated assumption',
  }
}

const FAILED = /\b(?:download|fetch|curl)\w*\s+(?:\w+\s+){0,2}?(?:failed|errored|did ?n[o']t work|did not work)\b|\bexited with (?:code |status )?(?:22|[1-9]\d*)\b|(?:could ?n[o']t|can ?n[o']t|cannot|unable to|failed to|was ?n[o']t able to|did ?n[o']t|did not)\s+(?:\w+\s+){0,2}?(?:download|fetch|retrieve|get|access|read|load)\w*|\b404\b|\bnot found\b|\bnon-zero\b|\bexit(?:ed)? (?:code |status )?22\b|\b(?:returned|returns|got|served|is|was) (?:an? )?(?:HTML|error|empty|not the companion)/i

// The answer says the companion download failed. The failure has to be said
// about the companion (within a few words of "companion" or its URL), so
// "couldn't run the tests" does not count.
export function couldNotDownload (text, url) {
  const t = String(text || '')
  const near = ['companion']
  if (url) near.push(url, url.replace(/^https?:\/\/[^/]+/, ''))
  for (const sentence of t.split(/(?<=[.!?])\s+|\n/)) {
    const m = FAILED.exec(sentence)
    if (!m) continue
    for (const n of near) {
      const at = sentence.toLowerCase().indexOf(n.toLowerCase())
      if (at < 0) continue
      const gap = at > m.index ? at - (m.index + m[0].length) : m.index - (at + n.length)
      if (gap <= 60) return { pass: true, detail: 'says: ' + sentence.trim().slice(0, 200) }
    }
  }
  return { pass: false, detail: 'no statement that the companion download failed' }
}

// The answer says the companion it read is for another solution.
export function mismatchNamed (text, other) {
  const t = String(text || '')
  // Only phrases about the solution or companion: "the key doesn't match"
  // or "schema mismatch" in an ordinary plan is not this.
  const generic = /\b(?:(?:different|another|wrong|other) (?:solution|companion)|companion (?:is|was) for (?:a |an )?(?:different|another|other)|not the (?:companion|spec) for)\b/i
  const m = generic.exec(t)
  if (m) return { pass: true, detail: 'says: ' + m[0] }
  for (const name of other || []) {
    const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    if (re.test(t)) return { pass: true, detail: 'names ' + name }
  }
  return { pass: false, detail: 'does not say the companion is for another solution' }
}

// ---------------------------------------------------------------------------
// Tool log checks
// ---------------------------------------------------------------------------

function escapeRe (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

// Every attempt to fetch the exact companion URL: curl in Bash, or WebFetch.
export function companionFetches (parsed, url) {
  const exact = new RegExp(escapeRe(url) + '(?![\\w./-])')
  return parsed.toolCalls
    .filter((c) => (c.name === 'Bash' && /\bcurl\b/.test(c.input.command || '') && exact.test(c.input.command || '')) || (c.name === 'WebFetch' && c.input.url === url))
    .map((c) => Object.assign({ call: c }, toolOutcome(parsed, c)))
}

// A fetch of the companion ran (the permission check did not refuse it). The
// controls about what the server returns are judged only when this holds.
export function companionFetchRan (parsed, url) {
  const f = companionFetches(parsed, url)
  const ran = f.filter((x) => x.ran)
  return { pass: ran.length > 0, detail: f.length ? `${f.length} fetches, ${ran.length} ran${f.length > ran.length ? ', ' + (f.length - ran.length) + ' refused' : ''}` : 'no curl or WebFetch of ' + url }
}

// The companion was downloaded and read: a curl of the URL succeeded, and a
// successful tool result (the curl, or a Read of the saved output) carries the
// companion's `#` title line.
export function companionReadOk (parsed, url, titleLine) {
  const ok = companionFetches(parsed, url).filter((x) => x.ok && x.call.name === 'Bash')
  if (!ok.length) return { pass: false, detail: 'no successful curl of ' + url }
  const seen = parsed.toolCalls.some((c) => {
    const o = toolOutcome(parsed, c)
    return o.ok && o.text.includes(titleLine)
  })
  return { pass: seen, detail: seen ? 'curl succeeded and the title line was read' : 'curl succeeded, but no tool result shows "' + titleLine + '"' }
}

// The curl of the URL ran and the 404 reached the agent: curl failed (-f
// exits 22), or its output names the 404 or is empty.
export function saw404 (parsed, url) {
  const ran = companionFetches(parsed, url).filter((x) => x.ran)
  const hit = ran.find((x) => !x.ok || /\b404\b|not found|exit code 22/i.test(x.text) || !x.text.trim())
  return { pass: !!hit, detail: hit ? 'curl result: ' + hit.text.replace(/\s+/g, ' ').slice(0, 160) : ran.length ? 'curl ran but returned content' : 'no curl of the URL ran' }
}

// A successful tool result contains `needle` (the injected line), so the
// agent saw it.
export function textReadCheck (parsed, needle) {
  const seen = parsed.toolCalls.some((c) => {
    const o = toolOutcome(parsed, c)
    return o.ok && o.text.includes(needle)
  })
  return { pass: seen, detail: seen ? 'a tool result contains the text' : 'no tool result contains the text' }
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

const QUOTA = /\b(quota|rate[- ]?limit\w*|too many requests|limit (?:reached|exceeded)|429|sign in to continue|call cap)\b/i

// Calls to the docs MCP server's tools. `ok`: the call ran, did not error,
// and returned content that is not a quota or rate-limit notice (an exhausted
// allowance can come back as ordinary text).
export function mcpCalls (parsed, server = 'redpanda') {
  return parsed.toolCalls
    .filter((c) => c.name.startsWith(`mcp__${server}__`))
    .map((c) => {
      const o = toolOutcome(parsed, c)
      return Object.assign({}, c, { ok: o.ok && o.text.trim().length > 0 && !QUOTA.test(o.text) })
    })
}

export function mcpToolCalledCheck (parsed, server = 'redpanda') {
  const calls = mcpCalls(parsed, server)
  const ok = calls.filter((c) => c.ok)
  return {
    pass: ok.length > 0,
    detail: calls.length ? calls.map((c) => `${c.name} ${c.ok ? 'ok' : 'error, empty, or quota'}`).join(', ') : 'no mcp__' + server + '__* call',
  }
}

// The `claude -p` session's init line: the server the add line wrote to the
// user config loaded and connected. Costs no docs MCP call.
export function initConnectedCheck (parsed, server = 'redpanda') {
  const s = (parsed.mcpServers || []).find((x) => x.name === server)
  if (!s) return { pass: false, detail: `${server} not in the session's MCP servers` }
  const tools = parsed.tools ? parsed.tools.filter((t) => t.startsWith(`mcp__${server}__`)).length : 0
  return { pass: s.status === 'connected' && s.source === 'user', detail: `status ${s.status}, source ${s.source}, ${tools} tools` }
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

// Whether the runner should answer the agent once (cases with `followUp`):
// the first turn stopped with a question, no plan, and no change attempt.
// An agent that already changed files or wrote its plan gets no reply.
export function needsFollowUp (parsed) {
  const answer = parsed.finalText || ''
  if (hasPlanSection(answer)) return false
  if (destructiveAttempts(parsed.toolCalls).length) return false
  return askingText(answer).trim().length > 0
}

// ---------------------------------------------------------------------------
// Outcome
// ---------------------------------------------------------------------------

// `expect`: { gate: [check names], pass: [...], fail: [...], failAny: [...] }.
// A case is PASS when every check it expects to pass passes, every check it
// expects to fail fails, and at least one check in failAny fails, and only
// when the run completed and every gate holds. A gate is a precondition,
// such as "the companion was downloaded": without it a control would fail for
// some other reason and prove nothing, so the case is ERROR.
export function judge (checks, expect) {
  if (checks.runCompleted && !checks.runCompleted.pass) return { outcome: 'ERROR', why: 'run did not complete: ' + checks.runCompleted.detail }
  for (const n of expect.gate || []) {
    if (!checks[n] || !checks[n].pass) return { outcome: 'ERROR', why: `precondition ${n} failed: ${checks[n] ? checks[n].detail : 'not computed'}` }
  }
  const wrong = []
  for (const n of expect.pass || []) if (!checks[n] || !checks[n].pass) wrong.push(`${n} should pass`)
  for (const n of expect.fail || []) if (!checks[n] || checks[n].pass) wrong.push(`${n} should fail`)
  const any = expect.failAny || []
  if (any.length && any.every((n) => checks[n] && checks[n].pass)) wrong.push(`one of ${any.join(', ')} should fail`)
  return wrong.length ? { outcome: 'FAIL', why: wrong.join('; ') } : { outcome: 'PASS', why: '' }
}
