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

// ---------------------------------------------------------------------------
// search: aliases, short words, step titles
// ---------------------------------------------------------------------------

const SEARCH_RECORDS = [
  record('disaster-recovery', {
    title: 'Fail over to a standby cluster',
    description: 'Keep a disaster recovery copy of every topic with Shadowing.',
    technologies: ['Kubernetes'],
    steps: [{ id: 'verify-end-to-end', title: 'Verify the failover', url: '/s/dr/verify/' }],
  }),
  record('multiplayer-gaming', {
    title: 'Keep a live leaderboard current',
    description: 'Drive a leaderboard from game events that have scores.',
    steps: [{ id: 'scale-and-replay', title: 'Scale out and replay the match', url: '/s/mpg/replay/' }],
  }),
  record('sports-data-fanout', {
    title: 'Fan one sports feed out',
    description: 'High availability is not the point here.',
    steps: [{ id: 'replay-a-fixture', title: 'Replay a fixture', url: '/s/sports/replay/' }],
  }),
  record('kafka-migration', {
    title: 'Migrate from Apache Kafka',
    description: 'Move topics, groups and schemas.',
    categories: ['Schema Registry'],
    steps: [{ id: 'finish-cutover', title: 'Finish the cutover', url: '/s/kafka/cutover/' }],
  }),
  record('cdc-to-lakehouse', {
    title: 'Stream database changes into a lakehouse',
    description: 'Change data capture from Postgres into Iceberg.',
  }),
]

test('"dr" and "ha" are whole words, found through the aliases, never as a prefix', () => {
  const r = run({ records: SEARCH_RECORDS, facets: {} })
  r.search('dr')
  assert.deepEqual(r.shown(), ['disaster-recovery'], 'not "Drive" in the gaming description')
  r.search('DR')
  assert.deepEqual(r.shown(), ['disaster-recovery'], 'case-folded')
  r.search('ha')
  assert.deepEqual(r.shown(), ['sports-data-fanout'], 'from "High availability", not "have" or "Shadowing"')
  r.search('sr')
  assert.deepEqual(r.shown(), ['kafka-migration'], 'from the Schema Registry category')
  r.search('cdc')
  assert.deepEqual(r.shown(), ['cdc-to-lakehouse'])
})

test('step titles are searchable', () => {
  const r = run({ records: SEARCH_RECORDS, facets: {} })
  r.search('replay')
  assert.deepEqual(r.shown(), ['multiplayer-gaming', 'sports-data-fanout'])
  r.search('cutover')
  assert.deepEqual(r.shown(), ['kafka-migration'])
})

test('the search box says what it searches, briefly', () => {
  const { renderFilters } = require('./render')
  assert.match(renderFilters({ catalog: { facets: {} } }), /placeholder="Search solutions"/)
})

// ---------------------------------------------------------------------------
// deep links
// ---------------------------------------------------------------------------

test('a deep link matches a value regardless of case or punctuation, and the URL takes the real spelling', () => {
  const r = run({ records: RECORDS, facets: FACETS, search: '?use-case=change-data-capture' })
  assert.deepEqual(r.shown(), ['cdc-to-lakehouse'])
  assert.equal(r.url(), '/solutions/?use-case=Change+data+capture')
  assert.equal(r.dropped.hidden, true, 'nothing was ignored')
})

test('an unknown deep-link value is named in the results, and the note clears on the next change', () => {
  const r = run({ records: RECORDS, facets: FACETS, search: '?industry=Retail&industry=Gaming' })
  assert.deepEqual(r.shown(), ['multiplayer-gaming'])
  assert.equal(r.dropped.hidden, false)
  assert.equal(r.dropped.textContent, 'Ignored unknown filter: Retail')
  r.check('platform', 'cloud')
  assert.equal(r.dropped.hidden, true)

  const cleared = run({ records: RECORDS, facets: FACETS, search: '?industry=Retail' })
  assert.equal(cleared.dropped.hidden, false)
  cleared.clickClear()
  assert.equal(cleared.dropped.hidden, true, 'Clear filters clears it too')
})

// ---------------------------------------------------------------------------
// screen-reader counts
// ---------------------------------------------------------------------------

test('each option speaks its live count as words, and "no matches" when it would empty the grid', () => {
  const r = run({ records: RECORDS, facets: FACETS })
  assert.equal(r.spoken('platform', 'cloud'), '(2 matching)')
  r.check('use-case', 'Change data capture')
  assert.equal(r.spoken('platform', 'cloud'), '(no matches)')
  assert.equal(r.spoken('platform', 'self-managed'), '(1 matching)')
})

// ---------------------------------------------------------------------------
// the landing layout
// ---------------------------------------------------------------------------

test('the hero is the h1 and one lede from the page description, with no eyebrow', () => {
  const hbs = Handlebars.create()
  ;['eq', 'ne', 'lt', 'gt', 'and', 'or', 'format-duration', 'format-release-date', 'relativize', 'get-solutions-catalog', 'get-header-color', 'without', 'detag'].forEach((name) => {
    hbs.registerHelper(name, helper(name))
  })
  ;['head', 'head-component-color', 'header', 'nav', 'toolbar', 'breadcrumbs', 'feedback-footer', 'tracking-pixel', 'footer', 'chat-panel', 'solutions-grid', 'solution-card'].forEach((name) => {
    hbs.registerPartial(name, '')
  })
  const page = {
    title: 'Redpanda Solutions',
    description: 'Complete, runnable systems built on Redpanda, step by step.',
    layout: 'solutions-home',
    attributes: { 'solutions-catalog': JSON.stringify({ solutions: RECORDS, facets: FACETS }) },
    contents: '',
  }
  const html = hbs.compile(read('src/layouts/solutions-home.hbs'))({ page })
  assert.doesNotMatch(html, /sol-eyebrow/, 'the breadcrumb and h1 already name the page')
  assert.equal((html.match(/class="sol-lede"/g) || []).length, 1)
  assert.match(html, /<p class="sol-lede">Complete, runnable systems built on Redpanda, step by step.<\/p>/, 'the same sentence as the meta description')
  assert.match(html, /data-sol-filters-slot/, 'the narrow-screen slot is there')
  assert.doesNotMatch(html, /data-sol-filters-form/, 'the form itself is in the sidebar, not the main column')
})

test('the results can be skipped to, and both Clear buttons are there', () => {
  const html = renderLanding({ solutions: RECORDS, facets: FACETS })
  assert.match(html, /<div class="sol-results" id="sol-results" tabindex="-1" data-sol-results>/)
  assert.equal((html.match(/data-sol-filters-clear/g) || []).length, 2, 'next to the count and in the empty state')
  const { renderFilters } = require('./render')
  const filters = renderFilters({ catalog: { facets: FACETS } })
  assert.match(filters, /<form[^>]*>\s*<a class="sol-skip" href="#sol-results">Skip to results<\/a>/, 'the skip link is the first thing in the form')
})

test('hidden progress bars and the empty active-filter badge are really hidden', () => {
  // Both carry display:flex or inline-flex, which beats the UA [hidden] rule.
  const css = read('src/css/solutions.css')
  assert.match(css, /\.sol-filters-active\[hidden\],\s*\n\.sol-card-progress\[hidden\],[\s\S]*?\{\s*display: none;/)
})

// ---------------------------------------------------------------------------
// the embedded catalog and chips
// ---------------------------------------------------------------------------

function catalogOf (data) {
  const root = { page: { attributes: { 'solutions-catalog': JSON.stringify(data) } } }
  return helper('get-solutions-catalog')({ data: { root } })
}

test('the embedded catalog carries only what the landing script reads', () => {
  const withExtras = RECORDS.map((r) => Object.assign({}, r, {
    attachments: [{ name: 'a', url: '/a' }],
    relatedDocs: [{ title: 'd', url: '/d' }],
    verified: { runAt: '2026-09-13T02:14:07Z' },
    steps: [{ id: 's1', title: 'Step one', url: '/s1/', order: 1, duration: 5, files: ['x'] }],
  }))
  const json = JSON.parse(catalogOf({ solutions: withExtras, facets: FACETS }).json)
  assert.equal(json.facets, undefined)
  const first = json.solutions[0]
  assert.deepEqual(Object.keys(first).sort(), ['categories', 'description', 'difficulty', 'id', 'industries', 'platforms', 'steps', 'technologies', 'title', 'url', 'useCases'])
  assert.deepEqual(first.steps, [{ id: 's1', title: 'Step one', url: '/s1/' }])
})

test('universal technologies are computed over every record, drafts included', () => {
  const drafts = RECORDS.map((r) => Object.assign({}, r, { status: 'draft' }))
  const catalog = catalogOf({ solutions: drafts })
  assert.deepEqual(catalog.universalTechnologies, ['Redpanda'])
  catalog.all.forEach((r) => assert.equal(r.chipTechnologies.indexOf('Redpanda'), -1, r.id + ' shows no Redpanda chip'))
})

test('a published technologies facet decides what is universal', () => {
  // The extension leaves out of the facet every value all records carry.
  const catalog = catalogOf({
    solutions: RECORDS,
    facets: Object.assign({}, FACETS, { technologies: [{ value: 'Debezium', count: 1 }, { value: 'Go', count: 1 }, { value: 'Kubernetes', count: 1 }] }),
  })
  assert.deepEqual(catalog.universalTechnologies, ['Redpanda'])
})

test('card chips put the rarest technology first, so similar stacks look different', () => {
  const records = [
    record('gaming', { technologies: ['Redpanda', 'Go', 'Postgres', 'Protobuf'] }),
    record('sports', { technologies: ['Redpanda', 'Go', 'Postgres', 'Avro'] }),
    record('cdc', { technologies: ['Redpanda', 'MySQL', 'Iceberg'] }),
  ]
  const catalog = catalogOf({ solutions: records })
  const chips = {}
  catalog.all.forEach((r) => { chips[r.id] = r.chipTechnologies })
  // Counts: Protobuf, Avro, MySQL and Iceberg 1; Go and Postgres 2.
  assert.deepEqual(chips.gaming, ['Protobuf', 'Go', 'Postgres'])
  assert.deepEqual(chips.sports, ['Avro', 'Go', 'Postgres'])
  assert.deepEqual(chips.cdc, ['MySQL', 'Iceberg'], 'ties keep the authored order')
  const html = renderCard({ solution: catalog.all.find((r) => r.id === 'gaming') })
  assert.deepEqual(chipsOf(html), ['Protobuf', 'Go', 'Postgres'])
})

test('a card has an eyebrow only when it is featured', () => {
  const plain = renderCard({ solution: record('plain') })
  assert.doesNotMatch(plain, /sol-card-head/, 'a published, unfeatured card starts at its title')
  assert.match(renderCard({ solution: record('f', { featured: true }) }), /<span class="sol-card-eyebrow">Featured<\/span>/)
  const draft = renderCard({ solution: record('d', { status: 'draft' }) })
  assert.match(draft, /is-draft">Draft</)
  assert.doesNotMatch(draft, /sol-card-eyebrow/)
})

test('the filters sit in the sidebar when wide and above the grid, closed, when narrow', () => {
  const wide = run({ records: [], narrow: false })
  assert.equal(wide.filters.parentNode, wide.filtersHome, 'wide: in the sidebar')
  assert.equal(wide.filters.open, true)

  const page = run({ records: [], narrow: true })
  assert.equal(page.filters.parentNode, page.filtersSlot, 'narrow: above the grid')
  assert.equal(page.filters.open, false, 'narrow: closed')

  page.setNarrow(false)
  assert.equal(page.filters.parentNode, page.filtersHome, 'widened: back in the sidebar')
  assert.equal(page.filters.open, true, 'widened: open, since the sidebar has no summary')

  page.setNarrow(true)
  assert.equal(page.filters.parentNode, page.filtersSlot)
  assert.equal(page.filters.open, false, 'narrowed again with no reader choice: closed')
})

test('a reader who opened the narrow filters keeps them open across a resize', () => {
  const page = run({ records: [], narrow: true })
  page.clickSummary()
  assert.equal(page.filters.open, true)
  page.setNarrow(false)
  page.setNarrow(true)
  assert.equal(page.filters.parentNode, page.filtersSlot)
  assert.equal(page.filters.open, true, 'the reader opened them, so they stay open')
})
