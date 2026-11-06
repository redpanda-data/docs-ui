#!/usr/bin/env node
'use strict'
/**
 * Write the split and unsplit agent companion fixtures in fixtures/ for
 * split.test.js and visibility.test.js, from the docs extensions' own
 * generator (extensions/solutions-catalog/agent-companion.js), so the tests
 * read real generator output rather than hand-written companions.
 *
 *   node tests/solution-productionize/build-split-fixtures.js <split-dem> <unsplit-dem>
 *
 * <split-dem> is a checkout of docs-extensions-and-macros whose generator
 * writes part files (d046509 or later); <unsplit-dem> is one from before the
 * split (26dbd84), which writes one file. Both must have the flagship
 * fixture at __tests__/fixtures/solutions/multiplayer-gaming.
 *
 * Fixtures written, each as agent-companion.md and agent-companion-part-<n>.md:
 *   multiplayer-gaming/          the flagship, split
 *   multiplayer-gaming-unsplit/  the flagship, one file
 *   production-heavy/            a small solution whose Production gaps is too
 *                                big for one part, so it continues across parts
 */
const fs = require('node:fs')
const path = require('node:path')

const OUT = path.join(__dirname, 'fixtures')
const [splitDem, unsplitDem] = process.argv.slice(2)
if (!splitDem || !unsplitDem) {
  console.error('usage: build-split-fixtures.js <split-dem> <unsplit-dem>')
  process.exit(1)
}

function generator (dem) {
  return require(path.resolve(dem, 'extensions/solutions-catalog/agent-companion.js')).generateAgentCompanion
}

function flagship (dem) {
  const dir = path.resolve(dem, '__tests__/fixtures/solutions/multiplayer-gaming')
  const pages = {}
  for (const f of fs.readdirSync(path.join(dir, 'pages'))) {
    if (f.endsWith('.adoc')) pages[f.replace(/\.adoc$/, '')] = fs.readFileSync(path.join(dir, 'pages', f), 'utf8')
  }
  return { slug: 'multiplayer-gaming', pages, verifyScript: fs.readFileSync(path.join(dir, 'verify.sh'), 'utf8') }
}

// Three steps with rules, the last carrying a Production considerations
// section of fourteen topics, about 28,000 characters in all, and a verify
// script, so Reference build follows the continued Production gaps.
function productionHeavy () {
  const step = (title, rule, extra = '') => `= ${title}\n:page-layout: solution-step\n:page-solution-rule: ${rule}\n:page-solution-adapt: Find where ${title.toLowerCase()} happens.\n\n== Why this approach\n\nReason for ${title}.\n${extra}`
  const topic = (n) => {
    const sentences = []
    for (let k = 1; k <= 18; k++) sentences.push(`Topic ${n} needs a decision about item ${k}, measured against the target's own load before it ships.`)
    return `=== Topic ${n}\n\n${sentences.slice(0, 9).join(' ')}\n\n${sentences.slice(9).join(' ')}\n`
  }
  const topics = []
  for (let n = 1; n <= 14; n++) topics.push(topic(n))
  const index = [
    '= Production heavy',
    ':page-layout: solution',
    ':page-solution-version: v1.0.0',
    ':page-solution-steps: ingest, transform, verify-end-to-end',
    '',
    'A small solution with a large production section.',
    '',
    'After completing this solution, you will be able to:',
    '',
    '* Move events through two stages',
    '',
    '== What you build',
    '',
    'Two stages and a check.',
    '',
  ].join('\n')
  return {
    slug: 'production-heavy',
    verifyScript: '#!/usr/bin/env bash\n# 1. Every event reaches the sink.\necho ok\n# 2. No event is counted twice.\necho ok\n',
    pages: {
      index,
      ingest: step('Ingest', 'Key every event by its source.'),
      transform: step('Transform', 'Make each transform idempotent.'),
      'verify-end-to-end': step('Verify end to end', 'Check counts at both ends.', `\n== Production considerations\n\nWhat changes in production.\n\n${topics.join('\n')}`),
    },
  }
}

function write (name, result) {
  const dir = path.join(OUT, name)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'agent-companion.md'), result.markdown)
  for (const p of result.parts || []) fs.writeFileSync(path.join(dir, p.fileName), p.markdown)
  const parts = (result.parts || []).map((p) => `${p.fileName} (${p.sections.join('; ')})`)
  console.log(`${name}: core ${result.markdown.length} characters${parts.length ? ', ' + parts.join(', ') : ', no parts'}`)
}

const split = generator(splitDem)
write('multiplayer-gaming', split(flagship(splitDem)))
write('multiplayer-gaming-unsplit', generator(unsplitDem)(flagship(unsplitDem)))
const heavy = split(productionHeavy())
if (!heavy.parts.some((p) => /^## Production gaps \(continued\)$/m.test(p.markdown))) {
  console.error('production-heavy: Production gaps did not continue across parts; make the topics longer')
  process.exit(1)
}
write('production-heavy', heavy)
