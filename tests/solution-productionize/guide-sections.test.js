'use strict'
/**
 * What get_solution_guide can hand the productionize planner, which has no
 * way to open a URL: the Production gaps overview (its text before the first
 * topic), What the system must do and Canonical docs, and every section in
 * full, a long one as sub-sections that each fit in one result.
 *
 * Fixtures:
 *   multiplayer-gaming-published  the flagship's companion as the docs preview
 *                                 published it (one file), with a per-service
 *                                 ACL table in the Production gaps overview
 *                                 and a System map and Reference build over
 *                                 the cap
 *   multiplayer-gaming            the flagship, split (build-split-fixtures.js)
 *   multiplayer-gaming-unsplit    the flagship, one file
 *   production-heavy              Production gaps continued across parts
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const esbuild = require('esbuild')

const ROOT = path.join(__dirname, '..', '..')
const FIXTURES = path.join(__dirname, 'fixtures')
const ORIGIN = 'https://deploy-preview-1--docs.example.test'

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
const tools = loadEsm('src/js/react/agentTools.js')
const CAP = tools.GUIDE_SECTION_MAX_CHARS

// A fixture as the page reads it: the core, merged with its parts if any.
function companion (name) {
  const dir = path.join(FIXTURES, name)
  const read = (f) => prod.rewriteHost(fs.readFileSync(path.join(dir, f), 'utf8'), ORIGIN)
  const parts = fs.readdirSync(dir)
    .map((f) => /^agent-companion-part-(\d+)\.md$/.exec(f))
    .filter(Boolean)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((m) => read(m[0]))
  const core = read('agent-companion.md')
  return parts.length ? prod.mergeCompanion(core, parts) : core
}

function guideFor (name) {
  const slug = name.replace(/-(published|unsplit)$/, '')
  return prod.guideSections(prod.sliceCompanion(companion(name)), {
    lastStepUrl: `${ORIGIN}/solutions/${slug}/verify-end-to-end/`,
    stepUrls: Array.from({ length: 12 }, (_, i) => `${ORIGIN}/solutions/${slug}/step-${i + 1}/`),
    companionUrl: `${ORIGIN}/solutions/${slug}/agent-companion.md`,
  })
}

function block (guide) {
  return modes.productionizeContext({ title: guide.title, solution: 's', guide })
}

// The text get_solution_guide adds after a section: everything past the
// section's own text.
function noteOf (hit, entry) {
  return hit.text.startsWith(entry.text) ? hit.text.slice(entry.text.length) : hit.text
}

const squash = (s) => String(s).replace(/\s+/g, '')
const FIXTURE_NAMES = ['multiplayer-gaming-published', 'multiplayer-gaming', 'multiplayer-gaming-unsplit', 'production-heavy']

test('the Production gaps overview is a section of its own, with the ACL table', () => {
  const guide = guideFor('multiplayer-gaming-published')
  const overview = guide.sections.find((s) => s.section === 'Production gaps: overview')
  assert.ok(overview, 'no Production gaps: overview')
  assert.match(overview.text, /\| Principal \| Allow \| Group \|/)
  assert.match(overview.text, /\| Leaderboard service \| Read on `game\.player-events`/)
  assert.doesNotMatch(overview.text, /^### /m, 'the overview stops at the first topic')
  assert.equal(overview.guide_url, `${ORIGIN}/solutions/multiplayer-gaming/verify-end-to-end/#production-considerations`)
  // Asked for by the section's own name, the overview comes back.
  const hit = tools.findGuideSection(guide, 'production gaps')
  assert.equal(hit.section, 'Production gaps: overview')
  assert.match(hit.text, /\| Principal \| Allow \| Group \|/)
  // No topic carries the table, so before this it was never returned.
  for (const topic of guide.topics) {
    assert.doesNotMatch(guide.sections.find((s) => s.section === topic).text, /\| Principal \|/, topic)
  }
})

test('What the system must do and Canonical docs are offered and listed in the prompt', () => {
  for (const name of FIXTURE_NAMES) {
    const guide = guideFor(name)
    const prompt = block(guide)
    for (const want of ['Production gaps: overview', 'What the system must do', 'Canonical docs']) {
      const hit = tools.findGuideSection(guide, want)
      if (want === 'Canonical docs' && name === 'production-heavy') {
        assert.equal(hit.error, 'not_found', 'production-heavy has no Canonical docs')
        continue
      }
      assert.ok(hit.text, `${name}: ${want}`)
      assert.ok(prompt.includes(want), `${name}: the prompt does not list ${want}`)
    }
  }
  assert.match(modes.PRODUCTIONIZE_INSTRUCTIONS, /"Production gaps: overview"/)
})

test('a section over the cap comes as sub-sections that each fit and together hold all of it', () => {
  let split = 0
  for (const name of FIXTURE_NAMES) {
    const guide = guideFor(name)
    const sliced = prod.sliceCompanion(companion(name))
    for (const top of sliced.sections) {
      const pieces = guide.sections.filter((s) => s.section === top.title || s.parent === top.title ||
        (s.part > 1 && s.section.startsWith(top.title + ' (part ')))
      if (!pieces.length) continue
      assert.equal(squash(pieces.map((s) => s.text).join('\n')), squash(top.text), `${name}: ${top.title} lost text`)
      if (top.text.length > CAP) {
        split++
        assert.ok(pieces.length > 1, `${name}: ${top.title} was not split`)
        if (top.children.length) {
          assert.equal(pieces[0].section, top.title + ': overview')
          for (const c of top.children) {
            assert.ok(pieces.some((s) => s.section === `${top.title}: ${c.title}`), `${name}: no ${top.title}: ${c.title}`)
          }
        }
      }
    }
    // Production gaps: the overview and the topics, each heading included.
    const gaps = sliced.sections.find((s) => s.title === 'Production gaps')
    const gapText = guide.sections.filter((s) => /^Production gaps: overview/.test(s.section) || guide.topics.some((t) =>
      s.section === t || s.section.startsWith(t + ' (part '))).map((s) => {
      const topic = guide.topics.find((t) => s.section === t)
      return topic ? `### ${topic}\n${s.text}` : s.text
    }).join('\n')
    assert.equal(squash(gapText), squash(gaps.text), `${name}: Production gaps lost text`)
    // Every section, every piece, as the tool returns it, fits.
    for (const s of guide.sections) {
      assert.ok(s.text.length <= prod.SECTION_SPLIT_AT, `${name}: ${s.section} is ${s.text.length}`)
      const hit = tools.findGuideSection(guide, s.section)
      assert.equal(hit.section, s.section)
      assert.ok(hit.text.length <= CAP, `${name}: ${s.section} returns ${hit.text.length}`)
      assert.ok(hit.text.startsWith(s.text), `${name}: ${s.section} was cut`)
    }
  }
  assert.ok(split >= 3, `only ${split} sections over the cap in the fixtures`)
})

test('the prompt lists the sub-sections of a split section, and its overview names them', () => {
  const guide = guideFor('multiplayer-gaming-published')
  const prompt = block(guide)
  for (const parent of ['System map', 'Reference build']) {
    const subs = guide.sections.filter((s) => s.parent === parent)
    assert.ok(subs.length > 1, parent)
    for (const s of subs) assert.ok(prompt.includes(s.section), `${parent}: the prompt does not list ${s.section}`)
    const hit = tools.findGuideSection(guide, parent)
    assert.equal(hit.section, parent + ': overview')
    for (const s of subs.slice(1)) assert.ok(hit.text.includes(`"${s.section}"`), `${parent} overview does not name ${s.section}`)
  }
})

test('no note get_solution_guide adds points at a URL', () => {
  for (const name of FIXTURE_NAMES) {
    const guide = guideFor(name)
    for (const s of guide.sections) {
      const note = noteOf(tools.findGuideSection(guide, s.section), s)
      assert.doesNotMatch(note, /https?:\/\/|www\.|\.md\b/, `${name}: ${s.section}: ${note}`)
    }
  }
  // A section with no ### and no blank lines still splits, and each part
  // names the next one.
  const one = { title: 'T', version: '', sections: [{ title: 'Adapt', text: 'word '.repeat(3000).trim(), intro: '', children: [] }] }
  const chained = prod.guideSections(one, { companionUrl: 'https://x.test/c.md' })
  assert.ok(chained.sections.length >= 3)
  chained.sections.forEach((s, i) => {
    const hit = tools.findGuideSection(chained, s.section)
    assert.ok(hit.text.length <= CAP)
    const note = noteOf(hit, s)
    assert.doesNotMatch(note, /https?:\/\//)
    if (i < chained.sections.length - 1) assert.ok(note.includes(`"${chained.sections[i + 1].section}"`), note)
  })
  assert.equal(squash(chained.sections.map((s) => s.text).join('')), squash(one.sections[0].text))
  // A section the slicer did not split is cut with a note that names no URL.
  const old = { sections: [{ section: 'Reference build', guide_url: 'https://x.test/c.md', text: 'x '.repeat(5000) }], companionUrl: 'https://x.test/c.md' }
  const hit = tools.findGuideSection(old, 'Reference build')
  assert.ok(hit.text.length <= CAP)
  assert.match(hit.text, /\[Section shortened/)
  assert.doesNotMatch(noteOf(hit, { text: '' }), /https?:\/\//)
})
