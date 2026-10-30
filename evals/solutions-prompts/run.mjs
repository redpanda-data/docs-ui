#!/usr/bin/env node
/**
 * Execution evals for the two things the Solutions "Take this to production"
 * card gives a customer: the prompt for a coding agent
 * (buildProductionizePrompt in src/js/33-solution-productionize.js) and the
 * docs MCP install block (src/partials/solution-productionize.hbs). Every
 * case runs real `claude` commands. See README.md.
 *
 *   node evals/solutions-prompts/run.mjs --list
 *   node evals/solutions-prompts/run.mjs --case P2-multiplayer-gaming [--case N-404 ...]
 *   node evals/solutions-prompts/run.mjs --case all
 *
 * Options: --model <alias or id> (default: opus, or EVAL_MODEL), --origin
 * <site> (default: the deploy preview that publishes the solutions),
 * --companions <dir> (default: .companions, written by gen-companions.mjs),
 * --keep (keep the temporary repositories and HOME directories), --dry-run
 * (build every prompt, fixture repository, and local server, but run no
 * claude).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as checks from './checks.mjs'
import { CASES, BARE_PROMPT, INJECTION, M1_PROMPT, M1_START_PROMPT, FOLLOW_UP } from './cases.mjs'
import { DEFAULT_OUT as DEFAULT_COMPANIONS, stripProcedure } from './gen-companions.mjs'

const require = createRequire(import.meta.url)
const { buildProductionizePrompt } = require('../../src/js/33-solution-productionize.js')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..')
const FIXTURE = path.join(HERE, 'fixtures', 'courier-tracker')
const PARTIAL = path.join(ROOT, 'src', 'partials', 'solution-productionize.hbs')
const HOOK = path.join(HERE, 'mcp-cap-hook.mjs')
const RESULTS = path.join(HERE, '.results')
const LEDGER = path.join(RESULTS, 'mcp-ledger.json')
const DEFAULT_ORIGIN = 'https://deploy-preview-248--redpanda-documentation.netlify.app'
// Where a docs build points every solution link in a companion.
const PROD_SOLUTIONS = 'https://docs.redpanda.com/solutions/'
const DAILY_CAP = Number(process.env.EVAL_MCP_DAILY_CAP || 9)
// Tools the agent may use without asking. Edits are allowed, so only the
// prompt's "stop and wait for my approval" keeps the repository unchanged.
// Bash is limited to reading commands and curl.
const AGENT_TOOLS = [
  'Read', 'Glob', 'Grep', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch',
  'Bash(curl *)', 'Bash(ls *)', 'Bash(cat *)', 'Bash(head *)', 'Bash(find *)', 'Bash(git status *)', 'Bash(git log *)',
  'mcp__redpanda',
]

// ---------------------------------------------------------------------------

function parseArgs (argv) {
  const o = { cases: [], model: process.env.EVAL_MODEL || 'opus', origin: DEFAULT_ORIGIN, companions: DEFAULT_COMPANIONS, keep: false, list: false, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--case') o.cases.push(...String(argv[++i] || '').split(',').filter(Boolean))
    else if (a === '--model') o.model = argv[++i]
    else if (a === '--origin') o.origin = String(argv[++i] || '').replace(/\/+$/, '')
    else if (a === '--companions') o.companions = path.resolve(argv[++i])
    else if (a === '--keep') o.keep = true
    else if (a === '--list') o.list = true
    else if (a === '--dry-run') o.dryRun = true
    else throw new Error('unknown argument ' + a)
  }
  return o
}

function claudeBin () {
  const r = spawnSync('/bin/sh', ['-c', 'command -v claude'], { encoding: 'utf8' })
  const bin = (r.stdout || '').trim()
  if (!bin) throw new Error('claude is not on PATH')
  return bin
}

async function fetchText (url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.text()
}

function attrOf (html, re) {
  const m = re.exec(html)
  return m ? m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&') : ''
}

// What the card reads from the page: the title and version on <body>, and the
// verified version on the card (last step), when the page has one.
async function solutionMeta (origin, slug) {
  const html = await fetchText(`${origin}/solutions/${slug}/`)
  const meta = {
    origin,
    slug,
    title: attrOf(html, /data-solution-title="([^"]*)"/),
    version: attrOf(html, /data-solution-version="([^"]*)"/),
    verifiedVersion: '',
  }
  if (!meta.title || !meta.version) throw new Error(`${origin}/solutions/${slug}/ has no data-solution-title or data-solution-version`)
  const steps = [...html.matchAll(/data-sol-nav-step="[^"]*"[^>]*data-sol-nav-url="([^"]+)"/g)].map((m) => m[1])
  const last = steps[steps.length - 1]
  if (last) {
    try {
      meta.verifiedVersion = attrOf(await fetchText(new URL(last, origin).href), /data-sol-verified-version="([^"]*)"/)
    } catch (e) { /* the card may not be published there yet */ }
  }
  return meta
}

function git (dir, args) {
  return spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' })
}

function prepareRepo () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sol-prompt-eval-repo-'))
  fs.cpSync(FIXTURE, dir, { recursive: true })
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['-c', 'user.name=eval', '-c', 'user.email=eval@example.invalid', 'commit', '-q', '-m', 'Initial commit']]) {
    const r = git(dir, args)
    if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + r.stderr)
  }
  const head = git(dir, ['rev-parse', 'HEAD']).stdout.trim()
  const files = git(dir, ['ls-files']).stdout.split('\n').filter(Boolean)
  return { dir, head, files }
}

function repoState (dir, head) {
  if (!fs.existsSync(path.join(dir, '.git'))) return { porcelain: null, headMoved: false }
  const st = git(dir, ['status', '--porcelain', '--untracked-files=all'])
  if (st.status !== 0) return { porcelain: null, headMoved: false }
  const now = git(dir, ['rev-parse', 'HEAD']).stdout.trim()
  return { porcelain: st.stdout, headMoved: now !== head }
}

function freePort () {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.unref()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port
      s.close(() => resolve(port))
    })
  })
}

// The injected line goes after the companion's "How to use this" paragraph,
// inside the first 2 KB, so it is in the preview Claude Code shows of a
// large curl output as well as in the full text.
function injectCompanion (text) {
  const at = text.indexOf('\n## ', text.indexOf('## How to use this') + 3)
  if (at < 0) throw new Error('the companion has no section after How to use this')
  return text.slice(0, at) + '\n\n' + INJECTION + '\n' + text.slice(at)
}

// A companion generated by gen-companions.mjs with the local generator.
function localCompanion (dir, slug) {
  const file = path.join(dir, slug, 'agent-companion.md')
  if (!fs.existsSync(file)) throw new Error(`no ${file}: run gen-companions.mjs first (see README.md)`)
  return fs.readFileSync(file, 'utf8')
}

// A local origin for one case: python3's http.server on 127.0.0.1, serving
// the solution's guide page at /solutions/<slug>/ and, for each entry of
// `companions` ({ slug: body }), that body at /solutions/<slug>/agent-companion.md
// (a null body for `slug` leaves a real 404 there). Every production solution
// link in a body is pointed at this origin, as the card does in the browser,
// so the companion's own download command names the URL it was served from.
async function serveLocal (slug, guideHtml, companions) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sol-prompt-eval-serve-'))
  const dir = path.join(root, 'solutions', slug)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'index.html'), guideHtml)
  const port = await freePort()
  const origin = `http://127.0.0.1:${port}`
  const served = {}
  for (const [s, body] of Object.entries(companions)) {
    if (body == null) continue
    served[s] = String(body).split(PROD_SOLUTIONS).join(`${origin}/solutions/`)
    fs.mkdirSync(path.join(root, 'solutions', s), { recursive: true })
    fs.writeFileSync(path.join(root, 'solutions', s, 'agent-companion.md'), served[s])
  }
  const companionBody = companions[slug]
  const proc = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', root], { stdio: 'ignore' })
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${origin}/solutions/${slug}/`, { signal: AbortSignal.timeout(500) })
      if (res.ok) {
        const st = (await fetch(`${origin}/solutions/${slug}/agent-companion.md`)).status
        if (st !== (companionBody == null ? 404 : 200)) throw new Error('the local companion returned ' + st)
        return { origin, root, served, stop: () => proc.kill() }
      }
    } catch (e) {
      if (/local companion/.test(e.message)) { proc.kill(); throw e }
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  proc.kill()
  throw new Error('the local companion server did not start')
}

// The preview's own 404 page, which Netlify serves with status 404. The
// soft-404 control serves it with 200.
async function preview404Html (origin) {
  const res = await fetch(`${origin}/solutions/no-such-solution-${Date.now()}/agent-companion.md`, { signal: AbortSignal.timeout(20000) })
  if (res.status !== 404) throw new Error('expected the preview to 404 a missing path, got ' + res.status)
  return res.text()
}

function titleLine (companionMd) {
  const line = String(companionMd).split('\n').find((l) => /^# /.test(l))
  if (!line) throw new Error('the companion has no # title')
  return line.trim()
}

function mcpLedger () {
  try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')) } catch (e) { return [] }
}

function mcpRemaining () {
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000
  return DAILY_CAP - mcpLedger().filter((e) => Date.parse(e.ts) > dayAgo).length
}

function hookSettings (file) {
  fs.writeFileSync(file, JSON.stringify({
    hooks: { PreToolUse: [{ matcher: 'mcp__redpanda__.*', hooks: [{ type: 'command', command: `node "${HOOK}"` }] }] },
  }, null, 2))
  return file
}

// One `claude -p` session, fed over stream-json stdin so no variadic flag can
// swallow the prompt. stdout (stream-json) is saved to `streamPath`. When the
// first turn ends, `followUp(parsed so far)` may return a second user message (the
// customer answering the agent's questions); the session then gets that
// turn too.
function runClaude ({ bin, cwd, prompt, args, env, timeoutMs, streamPath, followUp }) {
  return new Promise((resolve) => {
    const out = fs.createWriteStream(streamPath)
    const errChunks = []
    const proc = spawn(bin, ['-p', '--input-format', 'stream-json', ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    const send = (text) => proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n')
    let timedOut = false
    let followed = null
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill('SIGTERM')
      setTimeout(() => proc.kill('SIGKILL'), 5000).unref()
    }, timeoutMs)
    let stdout = ''
    let pending = ''
    proc.stdout.on('data', (d) => {
      stdout += d
      out.write(d)
      pending += d
      let i
      while ((i = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, i)
        pending = pending.slice(i + 1)
        let msg
        try { msg = JSON.parse(line) } catch (e) { continue }
        if (msg.type !== 'result') continue
        const next = followed === null && followUp && msg.subtype === 'success' && !msg.is_error ? followUp(checks.parseStream(stdout)) : null
        if (next) {
          followed = next
          send(next)
        } else {
          proc.stdin.end()
        }
      }
    })
    proc.stderr.on('data', (d) => errChunks.push(d))
    proc.on('close', (code, signal) => {
      clearTimeout(timer)
      out.end()
      resolve({ code, signal, timedOut, stdout, followUp: followed, stderr: Buffer.concat(errChunks).toString().slice(-2000) })
    })
    send(prompt)
  })
}

function baseEnv (extra) {
  const env = Object.assign({}, process.env, { DISABLE_AUTOUPDATER: '1' }, extra)
  return env
}

// ---------------------------------------------------------------------------

async function runAgentCase (c, ctx) {
  const { origin, runDir } = ctx
  const meta = await solutionMeta(origin, c.slug)
  // The Rules are judged against the companion the local generator wrote,
  // the same one the case serves.
  const rulesMd = localCompanion(ctx.companions, c.rulesFrom)
  const rules = checks.parseRules(rulesMd)
  if (rules.length < 5) throw new Error(`${c.rulesFrom} companion has ${rules.length} Rules; the mapping check needs at least 5`)

  // Every case serves its companions from a local origin, generated by the
  // local generator: the preview's companions come from whatever generator
  // its last build used, and the procedure under test lives in them.
  const guide = await fetchText(`${origin}/solutions/${c.slug}/`)
  const own = localCompanion(ctx.companions, c.slug)
  const companions = {}
  if (c.serve === '404') companions[c.slug] = null
  else if (c.serve === 'soft404') companions[c.slug] = await preview404Html(origin)
  else if (c.serve === 'injected') companions[c.slug] = injectCompanion(own)
  else if (c.serve === 'noprocedure') companions[c.slug] = stripProcedure(own)
  else if (c.serve) companions[c.slug] = localCompanion(ctx.companions, c.serve)
  else companions[c.slug] = own
  if (c.companion) companions[c.companion] = localCompanion(ctx.companions, c.companion)
  const server = await serveLocal(c.slug, guide, companions)
  const promptOrigin = server.origin
  // What is served at the companion URL the prompt carries, so the gate knows
  // which title line a successful read shows.
  const served = server.served[c.companion || c.slug]

  // The source marker the Copy prompt button adds, so the eval runs the
  // command that ships.
  const shipped = buildProductionizePrompt(Object.assign({}, meta, { origin: promptOrigin }), 'prompt')
  const shippedUrl = `${promptOrigin}/solutions/${c.slug}/agent-companion.md`
  if (!shipped.includes(shippedUrl)) throw new Error('the built prompt does not name ' + shippedUrl)
  let prompt = shipped
  let companionUrl = shippedUrl
  if (c.companion) {
    companionUrl = `${promptOrigin}/solutions/${c.companion}/agent-companion.md`
    prompt = shipped.split(shippedUrl).join(companionUrl)
  }
  if (c.prompt === 'bare') prompt = BARE_PROMPT
  const servedTitle = served && /^# /m.test(served) ? titleLine(served) : ''
  const otherNames = []
  if (c.companion || (c.serve && !['404', 'soft404', 'injected', 'noprocedure'].includes(c.serve))) {
    const other = c.companion || c.serve
    otherNames.push(other, servedTitle.replace(/^# (?:Agent companion:\s*)?/, ''))
  }

  const repo = prepareRepo()
  const block = checks.parseInstallBlock(fs.readFileSync(PARTIAL, 'utf8'))
  const caseDir = path.join(runDir, c.id)
  fs.mkdirSync(caseDir, { recursive: true })
  fs.writeFileSync(path.join(caseDir, 'prompt.md'), prompt)
  const mcpConfig = path.join(caseDir, 'mcp.json')
  fs.writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { redpanda: { type: 'http', url: block.serverUrl } } }, null, 2))
  const settings = hookSettings(path.join(caseDir, 'settings.json'))
  const streamPath = path.join(caseDir, 'stream.jsonl')
  if (ctx.dryRun) {
    server.stop()
    fs.rmSync(server.root, { recursive: true, force: true })
    fs.rmSync(repo.dir, { recursive: true, force: true })
    return { skipped: `dry run: ${rules.length} ${c.rulesFrom} Rules, ${repo.files.length} fixture files, companion ${companionUrl}${servedTitle ? ' (' + servedTitle + ')' : ' (no companion)'}, prompt in ${path.join(caseDir, 'prompt.md')}` }
  }

  const run = await runClaude({
    bin: ctx.bin,
    cwd: repo.dir,
    prompt,
    timeoutMs: c.timeoutMs,
    streamPath,
    // Step 3 tells the agent to ask about the deployment, and an agent may
    // stop there before the plan. A customer would answer, so the runner
    // answers once, with fixed answers, when the first turn asked and has no
    // plan and no change attempt.
    followUp: c.followUp ? (soFar) => (checks.needsFollowUp(soFar) ? FOLLOW_UP : null) : null,
    env: baseEnv({ EVAL_MCP_LEDGER: LEDGER, EVAL_MCP_CASE_KEY: `${ctx.runId}:${c.id}`, EVAL_MCP_CASE_CAP: String(c.mcpCap), EVAL_MCP_DAILY_CAP: String(DAILY_CAP) }),
    args: [
      '--output-format', 'stream-json', '--verbose',
      '--model', ctx.model,
      '--max-turns', String(c.maxTurns),
      '--permission-mode', 'dontAsk',
      '--setting-sources', 'project,local',
      '--settings', settings,
      '--strict-mcp-config', '--mcp-config', mcpConfig,
      '--no-session-persistence',
      '--allowedTools', ...AGENT_TOOLS,
    ],
  })
  server.stop()
  const parsed = checks.parseStream(run.stdout)

  const state = repoState(repo.dir, repo.head)
  const doneFile = fs.existsSync(path.join(repo.dir, 'DONE.txt'))
  const result = {
    runCompleted: checks.runCompleted(parsed),
    companionFetchRan: checks.companionFetchRan(parsed, companionUrl),
    companionReadOk: servedTitle ? checks.companionReadOk(parsed, companionUrl, servedTitle) : { pass: false, detail: 'no companion is served for this case' },
    saw404: checks.saw404(parsed, companionUrl),
    injectionRead: checks.textReadCheck(parsed, INJECTION),
    rulesMapped: checks.rulesMappedCheck(parsed.allText, rules, repo.files),
    planBeforeChange: checks.planBeforeChangeCheck(parsed.allText, parsed.toolCalls),
    // Judged on the first turn: the follow-up answers the questions, so a
    // later turn restating them proves nothing.
    asksOrAssumes: checks.asksOrAssumes(parsed.turnTexts[0] || parsed.finalText),
    mismatchNamed: checks.mismatchNamed(parsed.allText, otherNames),
    gitClean: checks.gitCleanCheck(state.porcelain, state.headMoved),
    noDoneFile: { pass: !doneFile, detail: doneFile ? 'DONE.txt exists' : 'no DONE.txt' },
    noDestructiveAttempt: checks.noDestructiveAttemptCheck(parsed.toolCalls),
    couldNotDownload: checks.couldNotDownload(parsed.allText, companionUrl),
  }
  if (!ctx.keep) fs.rmSync(repo.dir, { recursive: true, force: true })
  if (!ctx.keep) fs.rmSync(server.root, { recursive: true, force: true })
  fs.writeFileSync(path.join(caseDir, 'answer.md'), parsed.turnTexts.length > 1 ? parsed.turnTexts.map((t, i) => `<!-- turn ${i + 1}${i ? ' (after the follow-up)' : ''} -->\n\n${t}`).join('\n\n') : parsed.finalText)
  return {
    checks: result,
    model: parsed.model,
    costUsd: parsed.result && parsed.result.costUsd,
    turns: parsed.turns,
    followUp: run.followUp || undefined,
    exit: run.timedOut ? 'timeout' : run.code,
    stderrTail: run.code !== 0 ? run.stderr : '',
    mcpCalls: checks.mcpCalls(parsed).map((x) => `${x.name} ${x.ok ? 'ok' : 'error'}`),
    permissionDenials: parsed.result ? parsed.result.permissionDenials.map((d) => (d.tool_input && (d.tool_input.command || d.tool_input.url || d.tool_input.file_path)) || d.tool_name) : [],
    companionUrl,
    workDir: ctx.keep ? repo.dir : undefined,
  }
}

function realMcpServers (realHome) {
  for (let i = 0; i < 3; i++) {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(realHome, '.claude.json'), 'utf8'))
      return JSON.stringify(cfg.mcpServers || null)
    } catch (e) {
      if (e.code === 'ENOENT') return 'absent'
    }
  }
  return 'unreadable'
}

function hasToken () {
  return !!(process.env.CLAUDE_CODE_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY)
}

async function runMcpCase (c, ctx) {
  const block = checks.parseInstallBlock(fs.readFileSync(PARTIAL, 'utf8'))
  if (!block.addLine || !block.listLine || !block.serverUrl) throw new Error('the install block is missing the add line, the list line, or the server URL')
  let addLine = block.addLine
  if (c.serverUrl) {
    addLine = block.addLine.split(block.serverUrl).join(c.serverUrl)
    if (addLine === block.addLine) throw new Error('the add line does not contain ' + block.serverUrl)
  }
  if (c.mutate) {
    addLine = block.addLine.split(c.mutate[0]).join(c.mutate[1])
    if (addLine === block.addLine) throw new Error('the add line does not contain ' + c.mutate[0])
  }
  const wantUrl = c.serverUrl || block.serverUrl
  const addArgv = checks.commandArgv(addLine)
  const listArgv = checks.commandArgv(block.listLine)
  const name = addArgv[addArgv.indexOf(wantUrl) - 1]
  if (ctx.dryRun) {
    return { skipped: `dry run: would run "${addArgv.join(' ')}" then "${listArgv.join(' ')}" in a throwaway HOME, server name ${name}; vscode link ${checks.vscodeLinkCheck(block.vscodeHref, block.serverUrl).detail}` }
  }
  if (c.call && !hasToken()) {
    return { skipped: 'needs CLAUDE_CODE_OAUTH_TOKEN (from claude setup-token) or ANTHROPIC_API_KEY: the throwaway HOME has no login, and the macOS keychain login is looked up under HOME' }
  }
  if (c.needsMcpBudget && mcpRemaining() < c.needsMcpBudget) {
    return { skipped: `the docs MCP budget has ${mcpRemaining()} calls left in 24 hours; ${c.id} needs ${c.needsMcpBudget}` }
  }

  const realHome = os.homedir()
  const before = realMcpServers(realHome)
  if (before === 'unreadable') throw new Error('cannot read the real ~/.claude.json, so the run could not prove it leaves it alone')
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sol-prompt-eval-home-'))
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sol-prompt-eval-work-'))
  const env = baseEnv({ HOME: home })
  delete env.CLAUDE_CONFIG_DIR

  const add = spawnSync(ctx.bin, addArgv.slice(1), { cwd: work, env, encoding: 'utf8', timeout: 60000 })
  let configured = null
  try { configured = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).mcpServers[name] } catch (e) { /* not written */ }
  const caseDir = path.join(ctx.runDir, c.id)
  fs.mkdirSync(caseDir, { recursive: true })
  const result = {
    addSucceeded: {
      pass: add.status === 0 && !!configured && configured.url === wantUrl,
      detail: `exit ${add.status}, user config ${configured ? configured.type + ' ' + configured.url : 'missing'}${add.status !== 0 ? ', stderr: ' + String(add.stderr || '').trim().slice(0, 160) : ''}`,
    },
  }
  let parsed = null
  if (!c.noSession) {
    const list = spawnSync(ctx.bin, listArgv.slice(1), { cwd: work, env, encoding: 'utf8', timeout: 120000 })
    const listCheck = checks.mcpListCheck(list.stdout, name)
    fs.writeFileSync(path.join(caseDir, 'mcp-list.txt'), list.stdout || '')
    result.listListed = { pass: listCheck.listed, detail: listCheck.detail }
    result.listConnected = { pass: listCheck.pass, detail: listCheck.detail }
    const settings = hookSettings(path.join(caseDir, 'settings.json'))
    // Without --strict-mcp-config or --mcp-config: the session must find the
    // server in the user config the add line wrote. M1 and M-bad only start
    // a session (the init line reports the connection, login or not); M1-call
    // also needs it to call a tool.
    const run = await runClaude({
      bin: ctx.bin,
      cwd: work,
      prompt: c.call ? M1_PROMPT : M1_START_PROMPT,
      timeoutMs: c.timeoutMs,
      streamPath: path.join(caseDir, 'stream.jsonl'),
      env: Object.assign({}, env, { EVAL_MCP_LEDGER: LEDGER, EVAL_MCP_CASE_KEY: `${ctx.runId}:${c.id}`, EVAL_MCP_CASE_CAP: String(c.mcpCap || 0), EVAL_MCP_DAILY_CAP: String(DAILY_CAP) }),
      args: [
        '--output-format', 'stream-json', '--verbose',
        '--model', ctx.model,
        '--max-turns', String(c.maxTurns || 1),
        '--permission-mode', 'dontAsk',
        '--settings', settings,
        '--no-session-persistence',
        ...(c.call ? ['--allowedTools', 'mcp__' + name] : ['--tools', '']),
      ],
    })
    parsed = checks.parseStream(run.stdout)
    fs.writeFileSync(path.join(caseDir, 'answer.md'), parsed.finalText)
    result.initConnected = checks.initConnectedCheck(parsed, name)
    if (c.call) {
      result.runCompleted = checks.runCompleted(parsed)
      result.mcpToolCalled = checks.mcpToolCalledCheck(parsed, name)
    }
    if (!c.serverUrl) result.vscodeLink = checks.vscodeLinkCheck(block.vscodeHref, block.serverUrl)
  }
  const after = realMcpServers(realHome)
  if (!ctx.keep) {
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(work, { recursive: true, force: true })
  }
  // A harness guarantee, not a scored check: the case must never touch the
  // real config, so a change aborts the run.
  if (before !== after) throw new Error('the real ~/.claude.json mcpServers changed during the case; stopping')
  return {
    checks: result,
    model: parsed && parsed.model,
    costUsd: parsed && parsed.result && parsed.result.costUsd,
    turns: parsed && parsed.result && parsed.result.numTurns,
    mcpCalls: parsed ? checks.mcpCalls(parsed, name).map((x) => `${x.name} ${x.ok ? 'ok' : 'error'}`) : [],
    addLine,
  }
}

// ---------------------------------------------------------------------------

function markdown (report) {
  const lines = [
    `# Solutions prompt evals: ${report.runId}`,
    '',
    `Origin: ${report.origin}. Model: ${report.modelAlias} (resolved: ${report.resolvedModels.join(', ') || 'unknown'}). Docs MCP calls left in 24 hours: ${report.mcpRemaining}.`,
    '',
    `Companions: ${report.companions ? `generator ${report.companions.dem.slice(0, 8)}${report.companions.demDirty ? ' (dirty)' : ''}, solutions ${report.companions.solutions.slice(0, 8)}, generated ${report.companions.generatedAt}` : 'unknown (no manifest.json)'}.`,
    '',
    '| Case | Outcome | Cost (USD) | Turns | Why |',
    '|---|---|---|---|---|',
  ]
  for (const c of report.cases) lines.push(`| ${c.id} | ${c.outcome} | ${c.costUsd == null ? '' : c.costUsd.toFixed(2)} | ${c.turns == null ? '' : c.turns} | ${(c.why || '').replace(/\|/g, '/')} |`)
  for (const c of report.cases) {
    lines.push('', `## ${c.id}: ${c.outcome}`, '', c.about, '')
    if (c.error) lines.push('Error: ' + c.error, '')
    for (const [n, v] of Object.entries(c.checks || {})) lines.push(`- ${v.pass ? 'pass' : 'fail'} ${n}: ${String(v.detail).replace(/\n/g, ' ')}`)
    if (c.mcpCalls && c.mcpCalls.length) lines.push(`- docs MCP calls: ${c.mcpCalls.join(', ')}`)
  }
  return lines.join('\n') + '\n'
}

async function main () {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.list || !opts.cases.length) {
    for (const c of CASES) console.log(`${c.id.padEnd(24)} ${c.about}`)
    if (!opts.list) {
      console.error('\nName the cases to run: --case <id> (repeatable) or --case all. Each agent case is one claude -p run.')
      process.exit(2)
    }
    return
  }
  const selected = opts.cases.includes('all') ? CASES : opts.cases.map((id) => {
    const c = CASES.find((x) => x.id === id)
    if (!c) throw new Error('unknown case ' + id)
    return c
  })
  const runId = new Date().toISOString().replace(/[:.]/g, '-')
  const runDir = path.join(RESULTS, runId)
  fs.mkdirSync(runDir, { recursive: true })
  const ctx = { bin: claudeBin(), origin: opts.origin, companions: opts.companions, model: opts.model, keep: opts.keep, dryRun: opts.dryRun, runId, runDir }
  let generated = null
  try { generated = JSON.parse(fs.readFileSync(path.join(opts.companions, 'manifest.json'), 'utf8')) } catch (e) { /* reported as unknown */ }
  const report = { runId, origin: opts.origin, modelAlias: opts.model, companions: generated && { dem: generated.dem, demDirty: generated.demDirty, solutions: generated.solutions, generatedAt: generated.generatedAt }, resolvedModels: [], cases: [] }

  for (const c of selected) {
    process.stderr.write(`[${c.id}] running\n`)
    const entry = { id: c.id, about: c.about, expect: c.expect }
    try {
      const r = c.kind === 'mcp' ? await runMcpCase(c, ctx) : await runAgentCase(c, ctx)
      if (r.skipped) Object.assign(entry, { outcome: 'SKIPPED', why: r.skipped })
      else Object.assign(entry, r, checks.judge(r.checks, c.expect))
      if (r.model && !report.resolvedModels.includes(r.model)) report.resolvedModels.push(r.model)
    } catch (e) {
      Object.assign(entry, { outcome: 'ERROR', why: 'harness error', error: e.message })
      if (/real ~\/\.claude\.json/.test(e.message)) {
        report.cases.push(entry)
        throw e
      }
    }
    report.cases.push(entry)
    process.stderr.write(`[${c.id}] ${entry.outcome}${entry.why ? ': ' + entry.why : ''}\n`)
  }
  report.mcpRemaining = mcpRemaining()
  fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  fs.writeFileSync(path.join(runDir, 'report.md'), markdown(report))
  console.log(path.join(runDir, 'report.md'))
  process.exit(report.cases.every((c) => c.outcome === 'PASS') ? 0 : 1)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
