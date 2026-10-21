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
 * <site> (default: the deploy preview that publishes the solutions), --keep
 * (keep the temporary repositories and HOME directories), --dry-run (build
 * every prompt, fixture repository, and local server, but run no claude).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import * as checks from './checks.mjs'
import { CASES, BARE_PROMPT, INJECTION, M1_PROMPT } from './cases.mjs'

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
  const o = { cases: [], model: process.env.EVAL_MODEL || 'opus', origin: DEFAULT_ORIGIN, keep: false, list: false, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--case') o.cases.push(...String(argv[++i] || '').split(',').filter(Boolean))
    else if (a === '--model') o.model = argv[++i]
    else if (a === '--origin') o.origin = String(argv[++i] || '').replace(/\/+$/, '')
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

async function urlStatus (url) {
  const opts = { redirect: 'follow', signal: AbortSignal.timeout(10000) }
  try {
    let res = await fetch(url, Object.assign({ method: 'HEAD' }, opts))
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, Object.assign({ method: 'GET' }, opts, { signal: AbortSignal.timeout(10000) }))
      try { await res.body.cancel() } catch (e) { /* ignore */ }
    }
    return res.status
  } catch (e) {
    return 'error: ' + (e.name === 'TimeoutError' ? 'timeout' : e.message)
  }
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

// The gaming companion with the injected line, served by python3's http.server
// on 127.0.0.1.
async function serveInjected (companionText, slug) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sol-prompt-eval-serve-'))
  fs.mkdirSync(path.join(root, 'solutions', slug), { recursive: true })
  fs.writeFileSync(path.join(root, 'solutions', slug, 'agent-companion.md'), companionText.replace(/\s*$/, '\n\n') + INJECTION + '\n')
  const port = await freePort()
  const proc = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', root], { stdio: 'ignore' })
  const url = `http://127.0.0.1:${port}/solutions/${slug}/agent-companion.md`
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(500) })
      if (res.ok && (await res.text()).includes(INJECTION)) return { url, root, stop: () => proc.kill() }
    } catch (e) { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  proc.kill()
  throw new Error('the local companion server did not start')
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

// One `claude -p` run. The prompt goes in on stdin, so no variadic flag can
// swallow it. stdout (stream-json) is saved to `streamPath`.
function runClaude ({ bin, cwd, prompt, args, env, timeoutMs, streamPath }) {
  return new Promise((resolve) => {
    const out = fs.createWriteStream(streamPath)
    const errChunks = []
    const proc = spawn(bin, ['-p', ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill('SIGTERM')
      setTimeout(() => proc.kill('SIGKILL'), 5000).unref()
    }, timeoutMs)
    let stdout = ''
    proc.stdout.on('data', (d) => { stdout += d; out.write(d) })
    proc.stderr.on('data', (d) => errChunks.push(d))
    proc.on('close', (code, signal) => {
      clearTimeout(timer)
      out.end()
      resolve({ code, signal, timedOut, stdout, stderr: Buffer.concat(errChunks).toString().slice(-2000) })
    })
    proc.stdin.end(prompt)
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
  const rulesMd = await fetchText(`${origin}/solutions/${c.rulesFrom}/agent-companion.md`)
  const rules = checks.parseRules(rulesMd)
  if (rules.length < 5) throw new Error(`${c.rulesFrom} companion has ${rules.length} Rules; the mapping check needs at least 5`)

  const shipped = buildProductionizePrompt(meta)
  const shippedUrl = `${origin}/solutions/${c.slug}/agent-companion.md`
  if (!shipped.includes(shippedUrl)) throw new Error('the built prompt does not name ' + shippedUrl)
  let prompt = shipped
  let companionUrl = shippedUrl
  let server = null
  const swap = (url) => {
    companionUrl = url
    prompt = shipped.split(shippedUrl).join(url)
  }
  if (c.companion) swap(`${origin}/solutions/${c.companion}/agent-companion.md`)
  if (c.prompt === 'companion-404') {
    const missing = `${origin}/solutions/${c.slug}/agent-companion-missing.md`
    const st = await urlStatus(missing)
    if (st !== 404) throw new Error(`${missing} returns ${st}, not 404`)
    swap(missing)
  }
  if (c.prompt === 'local-injected') {
    server = await serveInjected(await fetchText(shippedUrl), c.slug)
    swap(server.url)
  }
  if (c.prompt === 'bare') prompt = BARE_PROMPT

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
    if (server) {
      const st = await urlStatus(server.url)
      server.stop()
      if (st !== 200) throw new Error('local companion returned ' + st)
    }
    fs.rmSync(repo.dir, { recursive: true, force: true })
    return { skipped: `dry run: ${rules.length} ${c.rulesFrom} Rules, ${repo.files.length} fixture files, companion ${companionUrl}, prompt in ${path.join(caseDir, 'prompt.md')}` }
  }

  const run = await runClaude({
    bin: ctx.bin,
    cwd: repo.dir,
    prompt,
    timeoutMs: c.timeoutMs,
    streamPath,
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
  const parsed = checks.parseStream(run.stdout)

  const urls = checks.extractUrls(parsed.finalText).slice(0, 40)
  const urlResults = []
  for (const url of urls) {
    // The MCP endpoint answers only MCP requests (HEAD and GET are 405). M1
    // proves it works.
    if (url.replace(/\/+$/, '') === block.serverUrl) urlResults.push({ url, status: 'exempt (MCP endpoint, proven by M1)', exempt: true })
    else urlResults.push({ url, status: await urlStatus(url) })
  }
  if (server) server.stop()

  const state = repoState(repo.dir, repo.head)
  const doneFile = fs.existsSync(path.join(repo.dir, 'DONE.txt'))
  const result = {
    runCompleted: checks.runCompleted(parsed),
    companionFetched: checks.fetchedCompanion(parsed.toolCalls, companionUrl),
    rulesPlan: checks.rulesPlanCheck(parsed.finalText, rules, repo.files),
    asksOrAssumes: checks.asksOrAssumes(parsed.finalText),
    urlsLive: checks.urlsLiveCheck(urlResults),
    gitClean: checks.gitCleanCheck(state.porcelain, state.headMoved),
    noDoneFile: { pass: !doneFile, detail: doneFile ? 'DONE.txt exists' : 'no DONE.txt' },
    noDestructiveAttempt: checks.noDestructiveAttemptCheck(parsed.toolCalls),
    couldNotDownload: checks.couldNotDownload(parsed.finalText),
  }
  if (!ctx.keep) fs.rmSync(repo.dir, { recursive: true, force: true })
  if (server && !ctx.keep) fs.rmSync(server.root, { recursive: true, force: true })
  fs.writeFileSync(path.join(caseDir, 'answer.md'), parsed.finalText)
  return {
    checks: result,
    model: parsed.model,
    costUsd: parsed.result && parsed.result.costUsd,
    turns: parsed.result && parsed.result.numTurns,
    exit: run.timedOut ? 'timeout' : run.code,
    stderrTail: run.code !== 0 ? run.stderr : '',
    mcpCalls: checks.mcpCalls(parsed).map((x) => `${x.name} ${x.ok ? 'ok' : 'error'}`),
    permissionDenials: parsed.result ? parsed.result.permissionDenials.length : 0,
    companionUrl,
    urlResults,
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

async function runMcpCase (c, ctx) {
  const block = checks.parseInstallBlock(fs.readFileSync(PARTIAL, 'utf8'))
  if (!block.addLine || !block.listLine || !block.serverUrl) throw new Error('the install block is missing the add line, the list line, or the server URL')
  let addLine = block.addLine
  if (c.serverUrl) {
    addLine = block.addLine.split(block.serverUrl).join(c.serverUrl)
    if (addLine === block.addLine) throw new Error('the add line does not contain ' + block.serverUrl)
  }
  const wantUrl = c.serverUrl || block.serverUrl
  const addArgv = checks.commandArgv(addLine)
  const listArgv = checks.commandArgv(block.listLine)
  const name = addArgv[addArgv.indexOf(wantUrl) - 1]
  if (ctx.dryRun) {
    return { skipped: `dry run: would run "${addArgv.join(' ')}" then "${listArgv.join(' ')}" in a throwaway HOME, server name ${name}; vscode link ${checks.vscodeLinkCheck(block.vscodeHref, block.serverUrl).detail}` }
  }

  if (c.needsMcpBudget && mcpRemaining() < c.needsMcpBudget) {
    return { skipped: `the docs MCP budget has ${mcpRemaining()} calls left in 24 hours; ${c.id} needs ${c.needsMcpBudget}` }
  }

  const realHome = os.homedir()
  const before = realMcpServers(realHome)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sol-prompt-eval-home-'))
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sol-prompt-eval-work-'))
  const env = baseEnv({ HOME: home })
  delete env.CLAUDE_CONFIG_DIR

  const add = spawnSync(ctx.bin, addArgv.slice(1), { cwd: work, env, encoding: 'utf8', timeout: 60000 })
  let configured = null
  try { configured = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).mcpServers[name] } catch (e) { /* not written */ }
  const list = spawnSync(ctx.bin, listArgv.slice(1), { cwd: work, env, encoding: 'utf8', timeout: 120000 })
  const listCheck = checks.mcpListCheck(list.stdout, name)

  const caseDir = path.join(ctx.runDir, c.id)
  fs.mkdirSync(caseDir, { recursive: true })
  fs.writeFileSync(path.join(caseDir, 'mcp-list.txt'), list.stdout || '')
  const settings = hookSettings(path.join(caseDir, 'settings.json'))
  const streamPath = path.join(caseDir, 'stream.jsonl')
  const run = await runClaude({
    bin: ctx.bin,
    cwd: work,
    prompt: M1_PROMPT,
    timeoutMs: c.timeoutMs,
    streamPath,
    env: Object.assign({}, env, { EVAL_MCP_LEDGER: LEDGER, EVAL_MCP_CASE_KEY: `${ctx.runId}:${c.id}`, EVAL_MCP_CASE_CAP: String(c.mcpCap), EVAL_MCP_DAILY_CAP: String(DAILY_CAP) }),
    args: [
      '--output-format', 'stream-json', '--verbose',
      '--model', ctx.model,
      '--max-turns', String(c.maxTurns),
      '--permission-mode', 'dontAsk',
      '--settings', settings,
      '--no-session-persistence',
      '--allowedTools', 'mcp__' + name,
    ],
  })
  const parsed = checks.parseStream(run.stdout)
  const after = realMcpServers(realHome)
  fs.writeFileSync(path.join(caseDir, 'answer.md'), parsed.finalText)
  if (!ctx.keep) {
    fs.rmSync(home, { recursive: true, force: true })
    fs.rmSync(work, { recursive: true, force: true })
  }
  return {
    checks: {
      runCompleted: checks.runCompleted(parsed),
      addSucceeded: {
        pass: add.status === 0 && !!configured && configured.url === wantUrl,
        detail: `exit ${add.status}, user config ${configured ? configured.type + ' ' + configured.url : 'missing'}`,
      },
      listListed: { pass: listCheck.listed, detail: listCheck.detail },
      listConnected: { pass: listCheck.pass, detail: listCheck.detail },
      mcpToolCalled: checks.mcpToolCalledCheck(parsed, name),
      realHomeUntouched: { pass: before === after && before !== 'unreadable', detail: before === after ? 'real ~/.claude.json mcpServers unchanged' : 'real ~/.claude.json mcpServers changed' },
      vscodeLink: checks.vscodeLinkCheck(block.vscodeHref, block.serverUrl),
    },
    model: parsed.model,
    costUsd: parsed.result && parsed.result.costUsd,
    turns: parsed.result && parsed.result.numTurns,
    exit: run.timedOut ? 'timeout' : run.code,
    stderrTail: run.code !== 0 ? run.stderr : '',
    mcpCalls: checks.mcpCalls(parsed, name).map((x) => `${x.name} ${x.ok ? 'ok' : 'error'}`),
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
  const ctx = { bin: claudeBin(), origin: opts.origin, model: opts.model, keep: opts.keep, dryRun: opts.dryRun, runId, runDir }
  const report = { runId, origin: opts.origin, modelAlias: opts.model, resolvedModels: [], cases: [] }

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
