/**
 * Continue learning on the solutions landing page, and the per-card progress
 * in the grid: one rule for both.
 *
 *   Completed    every step done; bar full
 *   In progress  some steps done; bar and "n of M steps"
 *   Started      a step was opened, nothing marked done; "Next: <step>" and
 *                no bar
 *
 * Opening a step creates the progress record (28-solution-progress.js
 * setCurrent), so "In progress, 0 of 9" was what every reader who had only
 * looked at a step used to see.
 */
const assert = require('node:assert/strict')
const test = require('node:test')

const { run } = require('./run')
const { el } = require('../solution-progress/helpers/dom')

const STEPS = ['start', 'create-topics', 'build'].map((id, i) => ({
  id, title: 'Step ' + (i + 1) + ' ' + id, url: '/solutions/g/' + id + '/', order: i + 1,
}))

function record (id) {
  return {
    id,
    title: id.toUpperCase(),
    url: '/solutions/' + id + '/',
    status: 'published',
    difficulty: 'beginner',
    categories: [],
    technologies: [],
    platforms: [],
    useCases: [],
    industries: [],
    steps: STEPS,
  }
}

function progress (done, currentStep) {
  const steps = {}
  done.forEach((id, i) => { steps[id] = { done: true, at: i + 1 } })
  return { currentStep: currentStep || null, updatedAt: 1, steps, completedSteps: done }
}

function landing (store) {
  return { r: run({ records: [record('g')], facets: {}, api: { getState: () => ({ solutions: store }) } }) }
}

// The same, with each card's progress slot in place, as solution-card.hbs
// renders it.
function landingWithSlot (store) {
  const r = run({
    records: [record('g')],
    facets: {},
    api: { getState: () => ({ solutions: store }) },
    cardChildren: () => {
      const bar = el('div', { class: 'sol-bar sol-bar--sm' }, [el('div', { class: 'sol-bar-fill', 'data-sol-card-progress-fill': '' })])
      const text = el('span', { 'data-sol-card-progress-text': '' })
      return [el('div', { 'data-sol-card-progress': '', hidden: '' }, [bar, text])]
    },
  })
  const slot = r.cards[0].querySelector('[data-sol-card-progress]')
  return { r, slot, bar: slot.querySelector('.sol-bar'), text: slot.querySelector('[data-sol-card-progress-text]') }
}

test('a visited solution with nothing done is "Started", names the next step, and draws no bar', () => {
  const { r } = landing({ g: progress([], 'create-topics') })
  assert.equal(r.continueSection.hidden, false)
  const html = r.continueGrid.innerHTML
  assert.match(html, /<span class="sol-rec-eyebrow">Started<\/span>/)
  assert.doesNotMatch(html, /In progress/)
  assert.match(html, /Next: Step 2 create-topics/, 'where the reader stopped reading')
  assert.match(html, /href="\/solutions\/g\/create-topics\/"/)
  assert.doesNotMatch(html, /sol-bar/, 'no 0% bar')
  assert.doesNotMatch(html, /0 of 3/)
})

test('some steps done is "In progress" with a bar and the count', () => {
  const { r } = landing({ g: progress(['start'], 'start') })
  const html = r.continueGrid.innerHTML
  assert.match(html, /<span class="sol-rec-eyebrow">In progress<\/span>/)
  assert.match(html, /width:33%/)
  assert.match(html, /1 of 3 steps/)
  assert.match(html, /href="\/solutions\/g\/create-topics\/"/, 'the first step not done')
})

test('every step done is "Completed" with a full bar', () => {
  const { r } = landing({ g: progress(['start', 'create-topics', 'build'], 'build') })
  const html = r.continueGrid.innerHTML
  assert.match(html, /<span class="sol-rec-eyebrow">Completed<\/span>/)
  assert.match(html, /width:100%/)
  assert.match(html, /href="\/solutions\/g\/"/, 'back to the overview')
})

test('no record means no section at all', () => {
  const { r } = landing({})
  assert.equal(r.continueSection.hidden, true)
})

test('the grid card follows the same rule: "Started" hides the bar, "In progress" shows it', () => {
  const started = landingWithSlot({ g: progress([], 'build') })
  assert.equal(started.slot.hidden, false)
  assert.equal(started.bar.hidden, true)
  assert.equal(started.text.textContent, 'Next: Step 3 build')

  const going = landingWithSlot({ g: progress(['start', 'create-topics'], 'create-topics') })
  assert.equal(going.bar.hidden, false)
  assert.equal(going.text.textContent, '2 of 3 steps')

  const none = landingWithSlot({})
  assert.equal(none.slot.hidden, true, 'a solution never opened shows no progress row')
})
