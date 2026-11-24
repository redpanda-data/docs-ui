'use strict'
/**
 * Where the solution pages put the quiz and the production card, from the
 * templates:
 *  - the card follows the introduction of the Take it to production page, and on a step
 *    only at the end of a last step with no next (a solution built without
 *    that page);
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
const quiz = require('../../src/js/27-solution-quiz-source.js')

test('the card follows the production page introduction, and is on a step only without a next', () => {
  const production = read('src/layouts/solution-production.hbs')
  assert.match(production, /\{\{\{intro\.before\}\}\}\s*\{\{> solution-productionize solution=\(parse-json @root\.page\.attributes\.solution\) title='Plan it for your system'\}\}\s*\{\{\{intro\.after\}\}\}/)
  const step = read('src/layouts/solution-step.hbs')
  assert.match(step, /\{\{\{page\.contents\}\}\}[\s\S]*\{\{#unless page\.attributes\.solution-next-url\}\}\s*\{\{> solution-productionize solution=\(parse-json page\.attributes\.solution\)\}\}\s*\{\{\/unless\}\}/)
  assert.doesNotMatch(step, /split-after-section/)
  assert.equal(fs.existsSync(path.join(ROOT, 'src/helpers/split-after-section.js')), false)
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

test('the overview says each step ends with a quiz and names Take it to production', () => {
  const steps = read('src/partials/solution-steps.hbs')
  assert.match(steps,
    /<p class="sol-steps-note">Each step ends with a short quiz to check your understanding\. After the last step, <a href="\{\{\{relativize solution\.production\.url\}\}\}">\{\{solution\.production\.title\}\}<\/a> lists what to change for production and helps you plan the rollout with Ask AI or your coding agent\.<\/p>/)
  // A solution built without the production page keeps the older line.
  assert.match(steps,
    /<p class="sol-steps-note">Each step ends with a short quiz to check your understanding, and the last step helps you plan the production rollout with Ask AI or your coding agent\.<\/p>/)
})
