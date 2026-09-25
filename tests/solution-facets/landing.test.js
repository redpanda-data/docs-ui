/**
 * The solutions landing page beyond the facet axes: what search matches,
 * the live filter counts, stale URL values, the empty catalog, and which
 * technology chips a card spends its three slots on.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const Handlebars = require('handlebars')

const { run } = require('./run')
const { renderCard, attributesOf } = require('./render')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const helper = (name) => require(path.join(ROOT, 'src/helpers', name + '.js'))

function record (id, extra) {
  return Object.assign({
    id,
    title: id.toUpperCase(),
    url: '/solutions/' + id + '/',
    status: 'published',
    difficulty: 'intermediate',
    description: '',
    categories: [],
    technologies: [],
    platforms: [],
    useCases: [],
    industries: [],
    steps: [],
  }, extra || {})
}

const RECORDS = [
  record('cdc-to-lakehouse', {
    title: 'Stream database changes into a lakehouse',
    description: 'Capture every row change and land it in Iceberg tables.',
    platforms: ['self-managed'],
    useCases: ['Change data capture'],
    technologies: ['Redpanda', 'Debezium'],
  }),
  record('multiplayer-gaming', {
    title: 'Multiplayer game events with a live leaderboard',
    description: 'Drive a live leaderboard from game events on Android and iOS.',
    platforms: ['cloud', 'self-managed'],
    useCases: ['Real-time analytics'],
    industries: ['Gaming'],
    technologies: ['Redpanda', 'Go', 'Kubernetes'],
  }),
  record('microservices', {
    title: 'Decouple services with events',
    platforms: ['cloud'],
    useCases: ['Event-driven microservices'],
    technologies: ['Redpanda'],
  }),
]

const FACETS = {
  useCases: [
    { value: 'Change data capture', count: 1 },
    { value: 'Event-driven microservices', count: 1 },
    { value: 'Real-time analytics', count: 1 },
  ],
  industries: [{ value: 'Gaming', count: 1 }],
  platforms: [{ value: 'cloud', count: 2 }, { value: 'self-managed', count: 2 }],
  categories: [],
  technologies: [],
  difficulty: [],
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

test('search finds a solution by its slug, which is how readers name them ("cdc")', () => {
  const r = run({ records: RECORDS, facets: FACETS })
  r.search('cdc')
  assert.deepEqual(r.shown(), ['cdc-to-lakehouse'], 'the slug is the only place "cdc" appears')
})

test('search matches the platforms a solution runs on', () => {
  const r = run({ records: RECORDS, facets: FACETS })
  r.search('cloud')
  assert.deepEqual(r.shown(), ['multiplayer-gaming', 'microservices'])
})

test('search matches at the start of a word, not anywhere inside one', () => {
  const r = run({ records: RECORDS, facets: FACETS })
  r.search('droid')
  assert.deepEqual(r.shown(), [], '"droid" is inside "Android", not at a word start')
  r.search('android')
  assert.deepEqual(r.shown(), ['multiplayer-gaming'])
  r.search('lake')
  assert.deepEqual(r.shown(), ['cdc-to-lakehouse'], 'a word prefix still matches')
  r.search('ake')
  assert.deepEqual(r.shown(), [])
})

test('without the embedded catalog, search still covers the slug and platforms from the card', () => {
  const r = run({ records: RECORDS, facets: FACETS, noCatalog: true })
  r.search('cdc')
  assert.deepEqual(r.shown(), ['cdc-to-lakehouse'])
  r.search('cloud')
  assert.deepEqual(r.shown(), ['multiplayer-gaming', 'microservices'])
})

test('search treats punctuation as a word break, and knows k8s', () => {
  const r = run({ records: RECORDS, facets: FACETS })
  r.search('event-driven')
  assert.deepEqual(r.shown(), ['microservices'])
  r.search('event driven')
  assert.deepEqual(r.shown(), ['microservices'])
  r.search('k8s')
  assert.deepEqual(r.shown(), ['multiplayer-gaming'], 'from the Kubernetes technology')
})

// ---------------------------------------------------------------------------
// live counts
// ---------------------------------------------------------------------------

test('filter counts follow the search and the other groups, and zero options dim', () => {
  const r = run({ records: RECORDS, facets: FACETS })
  assert.deepEqual(r.option('platform', 'cloud'), { count: '2', dimmed: false }, 'with nothing selected, the count is every card')
  assert.deepEqual(r.option('industry', 'Gaming'), { count: '1', dimmed: false })

  r.check('use-case', 'Change data capture')
  assert.deepEqual(r.option('platform', 'cloud'), { count: '0', dimmed: true }, 'the cdc solution is self-managed only')
  assert.deepEqual(r.option('platform', 'self-managed'), { count: '1', dimmed: false })
  assert.deepEqual(r.option('industry', 'Gaming'), { count: '0', dimmed: true })
  // A group's own counts ignore its own selection, so the other use cases
  // still say what ticking them as well would add.
  assert.deepEqual(r.option('use-case', 'Real-time analytics'), { count: '1', dimmed: false })

  r.search('lakehouse')
  assert.deepEqual(r.option('use-case', 'Real-time analytics'), { count: '0', dimmed: true }, 'the search narrows the counts too')
  assert.deepEqual(r.option('use-case', 'Change data capture'), { count: '1', dimmed: false })
})

test('a ticked option is never dimmed, even when it matches nothing', () => {
  const r = run({ records: RECORDS, facets: FACETS })
  r.check('industry', 'Gaming')
  r.check('use-case', 'Change data capture')
  assert.deepEqual(r.shown(), [])
  assert.equal(r.option('industry', 'Gaming').dimmed, false)
  assert.equal(r.option('use-case', 'Change data capture').dimmed, false)
})

// ---------------------------------------------------------------------------
// the URL
// ---------------------------------------------------------------------------

test('a URL value with no checkbox is dropped, not applied invisibly', () => {
  const r = run({ records: RECORDS, facets: FACETS, search: '?industry=Retail&use-case=Real-time+analytics&q=game' })
  assert.deepEqual(r.shown(), ['multiplayer-gaming'], 'Retail would otherwise empty the page with nothing ticked')
  assert.equal(r.active.textContent, '2', 'the search and the one real value')
  assert.equal(r.url(), '/solutions/?q=game&use-case=Real-time+analytics', 'the stale value is gone from the address bar')
})

test('a URL whose values all exist is left alone', () => {
  const r = run({ records: RECORDS, facets: FACETS, search: '?industry=Gaming' })
  assert.deepEqual(r.shown(), ['multiplayer-gaming'])
  assert.equal(r.url(), null, 'no rewrite when nothing was dropped')
})

// ---------------------------------------------------------------------------
// an empty catalog
// ---------------------------------------------------------------------------

test('with no cards at all, the "no solutions match your filters" state stays hidden', () => {
  const r = run({ records: [], facets: {} })
  assert.equal(r.empty.hidden, true)
  assert.equal(r.count.textContent, '0 solutions')
})

function renderLanding (catalog) {
  const hbs = Handlebars.create()
  ;['eq', 'ne', 'lt', 'gt', 'and', 'or', 'format-duration', 'format-release-date', 'relativize', 'get-solutions-catalog', 'get-header-color', 'without'].forEach((name) => {
    hbs.registerHelper(name, helper(name))
  })
  // The page chrome is not under test.
  ;['head', 'head-component-color', 'header', 'nav', 'toolbar', 'breadcrumbs', 'feedback-footer', 'tracking-pixel', 'footer', 'chat-panel'].forEach((name) => {
    hbs.registerPartial(name, '')
  })
  ;['solutions-filters', 'solutions-grid', 'solution-card'].forEach((name) => {
    hbs.registerPartial(name, read('src/partials/' + name + '.hbs'))
  })
  const page = {
    title: 'Redpanda Solutions',
    layout: 'solutions-home',
    url: '/solutions/',
    component: { name: 'solutions', title: 'Solutions' },
    attributes: { 'solutions-catalog': JSON.stringify(catalog) },
    contents: '',
  }
  return hbs.compile(read('src/layouts/solutions-home.hbs'))({ page })
}

test('a catalog with no solutions shows "none published yet", not the filters empty state', () => {
  const html = renderLanding({ solutions: [], facets: {} })
  assert.match(html, /No solutions published yet/)
  assert.doesNotMatch(html, /No solutions match your filters/)
  assert.doesNotMatch(html, /data-sol-results/, 'no grid, no filters, nothing for the engine to drive')
  assert.doesNotMatch(html, /data-sol-filters/)
})

test('a catalog with solutions renders the grid under a hidden "All solutions" h2', () => {
  const html = renderLanding({ solutions: RECORDS, facets: FACETS })
  assert.doesNotMatch(html, /No solutions published yet/)
  assert.match(html, /<h2 class="visually-hidden">All solutions<\/h2>/)
  assert.ok(html.indexOf('All solutions</h2>') < html.indexOf('<h3 class="sol-card-title">'), 'the h2 comes before the first card h3')
  assert.equal((html.match(/\sdata-sol-card\s/g) || []).length, 3)
})

// ---------------------------------------------------------------------------
// card chips
// ---------------------------------------------------------------------------

function chipsOf (html) {
  return (html.match(/sol-chip--tech">[^<]*/g) || []).map((m) => m.replace('sol-chip--tech">', ''))
}

test('card chips skip a technology every solution has', () => {
  const root = { page: { attributes: { 'solutions-catalog': JSON.stringify({ solutions: RECORDS }) } } }
  const html = renderCard(Object.assign({ solution: RECORDS[1] }, root))
  assert.deepEqual(chipsOf(html), ['Go', 'Kubernetes'], 'Redpanda is on all three and narrows nothing')
  assert.deepEqual(chipsOf(renderCard(Object.assign({ solution: RECORDS[2] }, root))), [], 'a card whose only technology is universal shows no chip row')
  assert.equal(attributesOf(html)['data-technologies'], 'Redpanda|Go|Kubernetes', 'filtering still sees every technology')
})

test('with no catalog to compare against, a card keeps all its chips', () => {
  assert.deepEqual(chipsOf(renderCard({ solution: RECORDS[1] })), ['Redpanda', 'Go', 'Kubernetes'])
})

// ---------------------------------------------------------------------------
// Continue learning
// ---------------------------------------------------------------------------

test('"Continue" goes to the first step not done, not the step last visited', () => {
  const steps = ['one', 'two', 'three'].map((id, i) => ({ id, title: id, url: '/solutions/g/' + id + '/', order: i + 1 }))
  const records = [record('g', { steps })]
  const progress = {
    currentStep: 'two', // just finished step two, so the last visited step is two
    updatedAt: 1,
    steps: { one: { done: true, at: 1 }, two: { done: true, at: 2 } },
    completedSteps: ['one', 'two'],
  }
  const api = { getState: () => ({ solutions: { g: progress } }) }
  const r = run({ records, facets: {}, api })
  assert.equal(r.continueSection.hidden, false)
  assert.match(r.continueGrid.innerHTML, /href="\/solutions\/g\/three\/"/)

  // An un-marked earlier step comes first, whatever the order they were done in.
  const gap = Object.assign({}, progress, { steps: { one: { done: false, at: 3 }, two: { done: true, at: 2 } }, completedSteps: ['two'] })
  const r2 = run({ records, facets: {}, api: { getState: () => ({ solutions: { g: gap } }) } })
  assert.match(r2.continueGrid.innerHTML, /href="\/solutions\/g\/one\/"/)
})
