'use strict'
/**
 * Where the step pages put the quiz and the production card, from the
 * templates and the split-after-section helper:
 *  - the card goes directly after Production considerations, wherever that
 *    section is, and at the end of the content without it;
 *  - the quiz button under the step is a secondary button with an icon, the
 *    same partial as the rail's copy;
 *  - the overview says what the steps hold besides the build.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const split = require('../../src/helpers/split-after-section.js')
const quiz = require('../../src/js/27-solution-quiz-source.js')

const sect = (id, body = '<p>x</p>') => `<div class="sect1">\n<h2 id="${id}"><a class="anchor" href="#${id}"></a>T</h2>\n<div class="sectionbody">${body}<div class="sect2"><h3 id="${id}-a">A</h3></div></div>\n</div>\n`

test('split-after-section splits after the named section, before the next one', () => {
  const html = '<div id="preamble"></div>' + sect('in-production') + sect('production-considerations') + sect('extend-this-solution') + sect('clean-up')
  const { before, after } = split(html, 'production-considerations')
  assert.ok(before.endsWith(sect('production-considerations')))
  assert.ok(after.startsWith('<div class="sect1">\n<h2 id="extend-this-solution"'))
  assert.equal(before + after, html)
})

test('split-after-section puts a last section\'s insert ahead of the footnotes', () => {
  const notes = '<div id="footnotes">\n<hr>\n</div>'
  const html = sect('clean-up') + sect('production-considerations') + notes
  const { before, after } = split(html, 'production-considerations')
  assert.equal(after, notes)
  assert.equal(split(sect('clean-up') + sect('production-considerations'), 'production-considerations').after, '')
})

test('split-after-section without the section leaves everything before the insert', () => {
  const html = sect('clean-up')
  assert.deepEqual(split(html, 'production-considerations'), { before: html, after: '' })
  assert.deepEqual(split(undefined, 'x'), { before: '', after: '' })
  // A sect2 with the id is not a top-level section.
  assert.equal(split(sect('clean-up', '<div class="sect2"><h3 id="production-considerations">P</h3></div>'), 'production-considerations').after, '')
})

test('the quiz never reads the production card as part of the step', () => {
  assert.ok(quiz.SKIP_SECTIONS.includes('take-to-production'))
  assert.match(read('src/partials/solution-productionize.hbs'), /<section class="sect1 [^"]*"[^>]*>\s*<h2 id="take-to-production"/)
})

test('the quiz button under the step is a secondary button with an icon, shared with the rail', () => {
  const actions = read('src/partials/solution-step-actions.hbs')
  assert.match(actions, /\{\{> solution-quiz-button class='sol-btn'\}\}/)
  const button = read('src/partials/solution-quiz-button.hbs')
  assert.match(button, /<button type="button" class="\{\{class\}\}" data-sol-quiz /)
  assert.match(button, /<svg [^>]*aria-hidden="true"/)
  assert.match(button, /<span data-sol-quiz-label>Quiz me on this step<\/span>/)
  assert.match(button, / hidden>/, 'hidden until the script decides')
  assert.match(read('src/partials/solution-step-rail-actions.hbs'), /\{\{> solution-quiz-button class='sol-btn sol-btn--sm sol-rail-action' placement='rail'\}\}/)
  const layout = read('src/layouts/solution-step.hbs')
  const at = (s) => layout.indexOf(s)
  assert.ok(at('<div class="sol-rail-body">') < at('{{> solution-rail-tools') && at('{{> solution-rail-tools') < at('{{> toc}}'),
    'the rail tools are in the rail body, above On this page')
  assert.match(layout, /\{\{> solution-rail-tools [^}]*step=true\}\}/)
  const tools = read('src/partials/solution-rail-tools.hbs')
  assert.ok(tools.indexOf('{{> solution-progress') < tools.indexOf('{{> solution-step-rail-actions'), 'under Your progress')
})

test('the overview says each step ends with a quiz and the last plans production', () => {
  assert.match(read('src/partials/solution-steps.hbs'),
    /<p class="sol-steps-note">Each step ends with a short quiz to check your understanding, and the last step helps you plan the production rollout with Ask AI or your coding agent\.<\/p>/)
})
