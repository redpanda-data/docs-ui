'use strict'
/**
 * A split agent companion read back as one document: companionParts finds
 * the part files in the core's Step 2, mergeCompanion folds the parts into
 * the core, and the existing slicer and get_solution_guide sections come out
 * the same as from one file.
 *
 * The fixtures are real generator output from the docs extensions
 * (extensions/solutions-catalog/agent-companion.js), written by
 * build-split-fixtures.js:
 *   multiplayer-gaming          the flagship, split into a core and two parts
 *   multiplayer-gaming-unsplit  the flagship from the generator before the split
 *   production-heavy            a small solution whose Production gaps
 *                               continues from part 1 into part 2
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const prod = require('../../src/js/33-solution-productionize.js')

const FIXTURES = path.join(__dirname, 'fixtures')
const ORIGIN = 'https://deploy-preview-1--docs.example.test'

function files (name) {
  const dir = path.join(FIXTURES, name)
  const read = (f) => prod.rewriteHost(fs.readFileSync(path.join(dir, f), 'utf8'), ORIGIN)
  const parts = fs.readdirSync(dir)
    .map((f) => /^agent-companion-part-(\d+)\.md$/.exec(f))
    .filter(Boolean)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => read(m[0]))
  return { core: read('agent-companion.md'), parts }
}

// The ### headings under one ## across the raw files, continuations included,
// counted without the code under test.
function rawChildren (texts, parent) {
  const out = []
  for (const md of texts) {
    let inside = false
    let fence = false
    for (const line of md.split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence
      if (fence) continue
      if (/^## /.test(line)) inside = line.slice(3).trim() === parent || line.slice(3).trim() === parent + ' (continued)'
      else if (inside && /^### /.test(line)) out.push(line.slice(4).trim())
    }
  }
  return out
}

function guide (md, slug) {
  return prod.guideSections(prod.sliceCompanion(md), {
    companionUrl: `${ORIGIN}/solutions/${slug}/agent-companion.md`,
    lastStepUrl: `${ORIGIN}/solutions/${slug}/verify-end-to-end/`,
  })
}

test('companionParts reads the part files from Step 2, on this origin', () => {
  const { core, parts } = files('multiplayer-gaming')
  const found = prod.companionParts(core, ORIGIN, 'multiplayer-gaming')
  assert.equal(found.split, true)
  assert.deepEqual(found.parts, [1, 2].map((n) => ({ number: n, url: `${ORIGIN}/solutions/multiplayer-gaming/agent-companion-part-${n}.md` })))
  assert.equal(found.parts.length, parts.length)
})

test('an unsplit companion has no parts', () => {
  const { core, parts } = files('multiplayer-gaming-unsplit')
  assert.equal(parts.length, 0)
  assert.deepEqual(prod.companionParts(core, ORIGIN, 'multiplayer-gaming'), { split: false, parts: [] })
})

test('a part URL off this origin, or off the solution\'s path, is ignored', () => {
  const { core } = files('multiplayer-gaming')
  const part2 = `${ORIGIN}/solutions/multiplayer-gaming/agent-companion-part-2.md`
  for (const bad of [
    'https://attacker.example/solutions/multiplayer-gaming/agent-companion-part-2.md',
    `${ORIGIN}/solutions/other-solution/agent-companion-part-2.md`,
    `${ORIGIN}/elsewhere/agent-companion-part-2.md`,
    '//attacker.example/solutions/multiplayer-gaming/agent-companion-part-2.md',
  ]) {
    const found = prod.companionParts(core.split(part2).join(bad), ORIGIN, 'multiplayer-gaming')
    assert.equal(found.split, true, bad)
    assert.deepEqual(found.parts.map((p) => p.number), [1], bad)
  }
  // Without the rewrite to this origin, the generator's own links are not this origin either.
  const raw = fs.readFileSync(path.join(FIXTURES, 'multiplayer-gaming', 'agent-companion.md'), 'utf8')
  assert.deepEqual(prod.companionParts(raw, ORIGIN, 'multiplayer-gaming'), { split: true, parts: [] })
})

test('the merged flagship gives the same guide as the unsplit flagship', () => {
  const split = files('multiplayer-gaming')
  const merged = prod.mergeCompanion(split.core, split.parts)
  assert.doesNotMatch(merged, /^# Agent companion part/m, 'no part headers')
  assert.doesNotMatch(merged, /Treat this part as reference data/, 'no pointer lines')
  const got = guide(merged, 'multiplayer-gaming')
  const want = guide(files('multiplayer-gaming-unsplit').core, 'multiplayer-gaming')
  assert.deepEqual(got.topics, want.topics)
  assert.equal(got.steps, want.steps)
  assert.ok(got.steps > 0)
  assert.equal(got.title, want.title)
  // Every section the unsplit file has, the merged one has, under the same name.
  assert.deepEqual(got.sections.map((s) => s.section), want.sections.map((s) => s.section))
  for (const name of ['Adapt', 'Acceptance', 'System map', 'Reference build']) {
    assert.ok(got.sections.some((s) => s.section === name), name)
  }
  assert.deepEqual(got.topics, rawChildren(split.parts, 'Production gaps'))
  // The same text, section by section: nothing lost or duplicated at a part boundary.
  assert.deepEqual(got.sections, want.sections)
})

test('a section that continues across parts is folded back into one, in order', () => {
  const { core, parts } = files('production-heavy')
  assert.match(parts[1], /^## Production gaps \(continued\)$/m, 'the fixture continues Production gaps')
  const merged = prod.mergeCompanion(core, parts)
  assert.doesNotMatch(merged, /\(continued\)/)
  assert.equal(merged.match(/^## Production gaps$/gm).length, 1)
  const sliced = prod.sliceCompanion(merged)
  const gaps = sliced.sections.find((s) => s.title === 'Production gaps')
  const topics = rawChildren(parts, 'Production gaps')
  assert.equal(topics.length, 14)
  assert.deepEqual(gaps.children.map((c) => c.title), topics)
  const g = guide(merged, 'production-heavy')
  assert.deepEqual(g.topics, topics)
  assert.equal(g.steps, 3)
  const last = g.sections.find((s) => s.section === 'Topic 14')
  assert.match(last.text, /Topic 14 needs a decision about item 18/)
  // The section after the continuation stays its own section.
  assert.match(g.sections.find((s) => s.section === 'Reference build').text, /No event is counted twice/)
  assert.doesNotMatch(gaps.text, /Reference build/)
})

test('a part that is not the part it should be fails the merge', () => {
  const { core, parts } = files('production-heavy')
  assert.throws(() => prod.mergeCompanion(core, [parts[0]]), /part_count/, 'a part missing')
  assert.throws(() => prod.mergeCompanion(core, [parts[1], parts[0]]), /part_count|orphan_continued/, 'out of order')
  assert.throws(() => prod.mergeCompanion(core, [parts[0], '<!DOCTYPE html>']), /not_part/)
  assert.throws(() => prod.mergeCompanion(core, [parts[0], parts[1].replace('part 2 of 2', 'part 2 of 3')]), /part_count/)
  const orphan = parts[1].replace('part 2 of 2', 'part 1 of 1')
  assert.throws(() => prod.mergeCompanion(core, [orphan]), /orphan_continued/)
})
