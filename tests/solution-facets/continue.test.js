/**
 * Continue where you left off on the solutions landing page, and the
 * per-card progress in the grid: one rule for both.
 *
 *   Completed    every step done; bar full on the grid card, not listed to
 *                resume (there is nothing left to do)
 *   In progress  some steps done; bar and "n of M steps", listed to resume
 *   (opened)     a step was opened, nothing marked done: not listed at all;
 *                a visit is browsing, not starting
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

test('a solution only opened, nothing done, is not listed: browsing is not starting', () => {
  const { r } = landing({ g: progress([], 'create-topics') })
  assert.equal(r.continueSection.hidden, true, 'no Continue learning section for a visit alone')
  assert.doesNotMatch(r.continueGrid.innerHTML, /Started/)
})

test('some steps done is "In progress" with a bar and the count', () => {
  const { r } = landing({ g: progress(['start'], 'start') })
  const html = r.continueGrid.innerHTML
  assert.match(html, /<span class="sol-rec-eyebrow">In progress<\/span>/)
  assert.match(html, /width:33%/)
  assert.match(html, /1 of 3 steps/)
  assert.match(html, /href="\/solutions\/g\/create-topics\/"/, 'the first step not done')
})

test('every step done is not listed to resume, and its grid card shows a full bar', () => {
  const { r } = landing({ g: progress(['start', 'create-topics', 'build'], 'build') })
  assert.equal(r.continueSection.hidden, true, 'nothing to resume')
  assert.equal(r.continueGrid.innerHTML, '')
  const card = landingWithSlot({ g: progress(['start', 'create-topics', 'build'], 'build') })
  assert.equal(card.slot.hidden, false)
  assert.equal(card.text.textContent, '3 of 3 steps')
  assert.equal(card.r.cards[0].querySelector('[data-sol-card-progress-fill]').style.width, '100%')
})

test('no record means no section at all', () => {
  const { r } = landing({})
  assert.equal(r.continueSection.hidden, true)
})

test('the grid card follows the same rule: a visit alone shows nothing, "In progress" shows the bar', () => {
  const visited = landingWithSlot({ g: progress([], 'build') })
  assert.equal(visited.slot.hidden, true, 'opened, nothing done: no progress row')

  const going = landingWithSlot({ g: progress(['start', 'create-topics'], 'create-topics') })
  assert.equal(going.slot.hidden, false)
  assert.equal(going.bar.hidden, false)
  assert.equal(going.text.textContent, '2 of 3 steps')

  const none = landingWithSlot({})
  assert.equal(none.slot.hidden, true, 'a solution never opened shows no progress row')
})

// ---------------------------------------------------------------------------
// Resume rendering: structure, link target, order, escaping, live updates
// ---------------------------------------------------------------------------

test('each unfinished solution is one list item holding one real link', () => {
  const { r } = landing({ g: progress(['start'], 'start') })
  const html = r.continueGrid.innerHTML
  assert.equal((html.match(/<li>/g) || []).length, 1)
  assert.match(html, /^<li><a class="sol-rec-card" href="[^"]+"[^>]*>.*<\/a><\/li>$/)
  assert.match(html, /<span class="sol-rec-title">G<\/span>/, 'the title')
  assert.match(html, /Next: Step 2 create-topics/, 'names the step the link opens')
})

test('the link opens the current step while it is not done, else the first step not done', () => {
  // Read ahead to step three without marking step two: resume on three.
  const ahead = landing({ g: progress(['start'], 'build') }).r.continueGrid.innerHTML
  assert.match(ahead, /href="\/solutions\/g\/build\/"/)
  // currentStep is the step just marked: move on to the first one not done.
  const marked = landing({ g: progress(['start'], 'start') }).r.continueGrid.innerHTML
  assert.match(marked, /href="\/solutions\/g\/create-topics\/"/)
  // An unknown currentStep (a step since removed) falls back the same way.
  const stale = landing({ g: progress(['start'], 'gone') }).r.continueGrid.innerHTML
  assert.match(stale, /href="\/solutions\/g\/create-topics\/"/)
})

test('the most recently updated solution comes first, finished ones are left out', () => {
  const records = ['a', 'b', 'c'].map(record)
  const store = {
    a: Object.assign(progress(['start'], 'start'), { updatedAt: 10 }),
    b: Object.assign(progress(['start', 'create-topics', 'build'], 'build'), { updatedAt: 30 }),
    c: Object.assign(progress(['start'], 'start'), { updatedAt: 20 }),
  }
  const r = run({ records, facets: {}, api: { getState: () => ({ solutions: store }) } })
  const ids = (r.continueGrid.innerHTML.match(/data-solution-id="([^"]+)"/g) || []).map((m) => m.slice(18, -1))
  assert.deepEqual(ids, ['c', 'a'])
})

test('a solution the catalog does not list is skipped, and catalog text is escaped', () => {
  const evil = Object.assign(record('g'), { title: '<img src=x onerror=alert(1)>' })
  const r = run({ records: [evil], facets: {}, api: { getState: () => ({ solutions: { g: progress(['start'], 'start'), unknown: progress(['start'], 'start') } }) } })
  const html = r.continueGrid.innerHTML
  assert.doesNotMatch(html, /<img/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.doesNotMatch(html, /unknown/)
})

test('the section redraws when the progress store changes (signed-in progress loading)', () => {
  let store = {}
  const listeners = []
  const r = run({ records: [record('g')], facets: {}, api: { getState: () => ({ solutions: store }) }, onWindowEvent: (type, fn) => { if (type === 'docs-solutions:change') listeners.push(fn) } })
  assert.equal(r.continueSection.hidden, true)
  store = { g: progress(['start'], 'start') }
  listeners.forEach((fn) => fn({}))
  assert.equal(r.continueSection.hidden, false)
  store = {}
  listeners.forEach((fn) => fn({}))
  assert.equal(r.continueSection.hidden, true, 'hidden again once there is nothing to resume')
})
