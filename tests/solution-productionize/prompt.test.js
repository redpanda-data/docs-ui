'use strict'
/**
 * The prompt the Take this to production card copies for a coding agent
 * (buildProductionizePrompt in src/js/33-solution-productionize.js), and the
 * plain-text rules every productionize string follows.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

const { spawnSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..', '..')
const prod = require('../../src/js/33-solution-productionize.js')

function loadEsm (relPath) {
  const filename = path.join(ROOT, relPath)
  const { code } = esbuild.transformSync(fs.readFileSync(filename, 'utf8'), { format: 'cjs', loader: 'js' })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(code, filename)
  return mod.exports
}

const modes = loadEsm('src/js/react/chatModes.js')

const META = {
  origin: 'https://deploy-preview-1--docs.example.test',
  slug: 'multiplayer-gaming',
  title: 'Keep a live leaderboard current as game events stream in',
  version: 'v1.0.0',
  verifiedVersion: '26.2.1',
}
const COMPANION = `${META.origin}/solutions/${META.slug}/agent-companion.md`
const COPIED = `${COMPANION}?from=prompt`
const HANDOFF = `${COMPANION}?from=handoff`

test('the prompt points at this origin\'s companion, and nowhere else', () => {
  const prompt = prod.buildProductionizePrompt(META, 'prompt')
  assert.ok(prompt.startsWith(`# Take this design to production: ${META.title}\n`))
  assert.ok(prompt.includes(`"${META.title}" (version v1.0.0, verified against Redpanda 26.2.1)`))
  assert.ok(prompt.includes('Do not copy the reference system.'))
  const urls = prompt.match(/https?:\/\/[^\s`']+/g)
  assert.deepEqual(urls, [COPIED], 'the companion is the only URL')
})

test('the companion URL says which hand-off it came from', () => {
  // The docs-site fetch counter tells these from the skill's bare fetch.
  const copied = prod.buildProductionizePrompt(META, 'prompt')
  const handoff = prod.buildProductionizePrompt(META, 'handoff')
  assert.ok(copied.includes(`\`curl -sf '${COPIED}'\``), 'Copy prompt marks from=prompt')
  assert.ok(handoff.includes(`\`curl -sf '${HANDOFF}'\``), 'the Ask AI hand-off marks from=handoff')
  assert.ok(!copied.includes('from=handoff') && !handoff.includes('from=prompt'))
  assert.equal(handoff, copied.split(COPIED).join(HANDOFF), 'the marker is the only difference')
  // Without a source, the bare URL, unquoted.
  assert.ok(prod.buildProductionizePrompt(META).includes(`\`curl -sf ${COMPANION}\`.`))
  assert.deepEqual(prod.buildProductionizePrompt(META).match(/https?:\/\/[^\s`']+/g), [COMPANION])
  // The page copies from=prompt and hands from=handoff to the banner.
  const page = fs.readFileSync(path.join(ROOT, 'src/js/33-solution-productionize.js'), 'utf8')
  assert.ok(page.includes("var prompt = buildProductionizePrompt(meta, 'prompt')"))
  assert.ok(page.includes("agentPrompt: buildProductionizePrompt(meta, 'handoff'),"))
})

// The command as the agent runs it: the backticked curl in the prompt.
function curlCommand (prompt) {
  const m = /`(curl -sf [^`]+)`/.exec(prompt)
  assert.ok(m, 'the prompt carries a curl command')
  return m[1]
}

const zsh = ['/bin/zsh', '/usr/bin/zsh', '/usr/local/bin/zsh', '/opt/homebrew/bin/zsh'].find((p) => fs.existsSync(p))

test('the marked curl command is single-quoted, so zsh does not glob the ?', () => {
  for (const from of ['prompt', 'handoff']) {
    const cmd = curlCommand(prod.buildProductionizePrompt(META, from))
    assert.equal(cmd, `curl -sf '${COMPANION}?from=${from}'`)
  }
})

test('zsh expands the marked command to curl and the URL, with no "no matches found"', { skip: zsh ? false : 'zsh is not installed' }, () => {
  for (const from of ['prompt', 'handoff']) {
    const cmd = curlCommand(prod.buildProductionizePrompt(META, from))
    // print -r -- shows the words zsh would pass to curl; no fetch runs.
    const run = spawnSync(zsh, ['-fc', 'print -r -- ' + cmd], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    assert.doesNotMatch(run.stderr, /no matches found/)
    assert.equal(run.stdout, `curl -sf ${COMPANION}?from=${from}\n`)
  }
})

test('the prompt is a pointer: the skill, else the companion\'s How to use this', () => {
  const prompt = prod.buildProductionizePrompt(META, 'prompt')
  assert.ok(prompt.includes('If the `redpanda-solutions` skill is available, use it.'))
  // One plain command (an allow rule for curl matches it), -f so a 404
  // fails, what failure looks like, and what to do when curl is not allowed.
  assert.ok(prompt.includes(`with this one command, exactly as written, with no pipes, redirects, \`cd\`, or temporary directories: \`curl -sf '${COPIED}'\`.`))
  assert.ok(prompt.includes('If curl exits non-zero, or its output does not start with `# Agent companion:`, the download failed'))
  assert.ok(prompt.includes('If you cannot run curl, ask me to paste the file.'))
  assert.ok(!/curl -s /.test(prompt), 'no curl without -f')
  assert.ok(prompt.trimEnd().endsWith('Then follow the companion\'s "How to use this" section.'))
})

test('the prompt carries no procedure of its own', () => {
  const prompt = prod.buildProductionizePrompt(META)
  // The steps, the constraints, and the docs sources live in the companion.
  assert.doesNotMatch(prompt, /^\d+\. /m, 'no numbered steps')
  assert.doesNotMatch(prompt, /^## /m, 'no sections')
  assert.doesNotMatch(prompt, /approval|Adapt|Acceptance|invent|throughput|llms\.txt|MCP/i)
})

test('no placeholder is left unfilled, with or without a verified version', () => {
  for (const meta of [META, Object.assign({}, META, { verifiedVersion: '' })]) {
    const prompt = prod.buildProductionizePrompt(meta)
    assert.doesNotMatch(prompt, /<[a-zA-Z][^>\n]*>/, 'an unfilled <placeholder>')
    assert.doesNotMatch(prompt, /undefined|null/)
  }
  const unverified = prod.buildProductionizePrompt(Object.assign({}, META, { verifiedVersion: '' }))
  assert.ok(unverified.includes(`"${META.title}" (version v1.0.0).`))
})

test('the origin\'s trailing slash does not double up', () => {
  const prompt = prod.buildProductionizePrompt(Object.assign({}, META, { origin: META.origin + '/' }))
  assert.ok(prompt.includes(COMPANION))
  assert.ok(!prompt.includes('test//solutions'))
})

test('no em dashes in the prompt, the mode prompt, or the card', () => {
  const card = fs.readFileSync(path.join(ROOT, 'src/partials/solution-productionize.hbs'), 'utf8')
  const strings = [
    prod.buildProductionizePrompt(META),
    modes.PRODUCTIONIZE_INSTRUCTIONS,
    modes.productionizeContext({ title: 'T', solution: 's', guide: { sections: [{ section: 'Adapt', text: 'x' }], topics: ['A'], steps: 2, rules: '1. R' } }),
    modes.MODES.productionize.note,
    card.replace(/\{\{!--[\s\S]*?--\}\}/g, ''),
  ]
  for (const s of strings) assert.ok(!s.includes('—'), s.slice(0, 80))
})

test('the drawer and the page send the same opener', () => {
  const page = fs.readFileSync(path.join(ROOT, 'src/js/33-solution-productionize.js'), 'utf8')
  assert.equal(modes.productionizeOpener({ title: META.title }), `Help me take this design to production: ${META.title}.`)
  assert.equal(modes.productionizeOpener({}), 'Help me take this solution to production.')
  assert.ok(page.includes("'Help me take this design to production: ' + meta.title + '.'"))
  assert.ok(modes.isModeThread(modes.productionizeOpener({ title: META.title })))
})
