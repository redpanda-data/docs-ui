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

test('the prompt points at this origin\'s companion and guide', () => {
  const prompt = prod.buildProductionizePrompt(META)
  assert.ok(prompt.startsWith(`# Take this design to production: ${META.title}\n`))
  assert.ok(prompt.includes(`- Agent companion, the spec for this work: ${COMPANION}\n`))
  assert.ok(prompt.includes(`- Human guide: ${META.origin}/solutions/${META.slug}/\n`))
  assert.ok(prompt.includes(`"${META.title}" (version v1.0.0, verified against Redpanda 26.2.1)`))
  assert.ok(!prompt.includes('docs.redpanda.com/solutions/'), 'no production solution link')
})

test('the agent downloads the companion with curl and checks its version', () => {
  const prompt = prod.buildProductionizePrompt(META)
  // One plain command (an allow rule for curl matches it), -f so a 404
  // fails, what failure looks like, and what to do when curl is not allowed.
  assert.ok(prompt.includes(`Download it in full with this one command, exactly as written, with no pipes, redirects, \`cd\`, or temporary directories: \`curl -sf ${COMPANION}\`.`))
  assert.ok(prompt.includes('If curl exits non-zero, or its output does not start with `# Agent companion:`, the download failed.'))
  assert.ok(prompt.includes('If you cannot run curl, ask me to paste the file.'))
  assert.ok(!/curl -s /.test(prompt), 'no curl without -f')
  assert.match(prompt, /^1\. Download the companion\. If you cannot, stop and tell me\. Do not work from memory\. Confirm the companion names version v1\.0\.0\.$/m)
  // The docs MCP server is for product details; it never serves the companion.
  assert.match(prompt, /It cannot return this solution's companion\./)
})

test('the prompt asks for a plan and an approval before any change', () => {
  const prompt = prod.buildProductionizePrompt(META)
  const steps = prompt.split('\n').filter((l) => /^\d+\. /.test(l))
  assert.equal(steps.length, 7)
  assert.match(steps[4], /^5\. Write a plan before you change anything/)
  assert.match(steps[5], /^6\. Stop and wait for my approval\./)
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
