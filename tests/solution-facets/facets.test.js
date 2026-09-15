/**
 * Filtering the solutions landing page by industry and use case: the facets
 * get-solutions-catalog hands the templates, the two groups
 * solutions-filters.hbs renders, and the matching 29-solutions-home.js does
 * over them.
 *
 * The contract that ties the three together: solutions-catalog publishes an
 * EMPTY array for a facet that cannot narrow the catalogue (every solution
 * carries the same value, or there is only one value). Empty must survive all
 * the way to the page, or a filter group appears that filters nothing.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const { renderFilters, renderMeta, renderCard, attributesOf, checkboxesOf, legendsOf } = require('./render')
const { run } = require('./run')

const catalogHelper = require('../../src/helpers/get-solutions-catalog')
const ENGINE = fs.readFileSync(path.join(__dirname, '../../src/js/29-solutions-home.js'), 'utf8')

// A record as the extension publishes it, trimmed to what these tests touch.
function record (id, extra) {
  return Object.assign({
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
    steps: [],
  }, extra || {})
}

const RECORDS = [
  record('cdc', { useCases: ['Change data capture'], industries: [], technologies: ['Debezium'] }),
  record('lakehouse', { useCases: ['Data lakehouse', 'Change data capture'] }),
  record('gaming', { useCases: ['Real-time analytics'], industries: ['Gaming'] }),
]

// The facets as the extension would publish them for RECORDS.
const FACETS = {
  useCases: [
    { value: 'Change data capture', count: 2 },
    { value: 'Data lakehouse', count: 1 },
    { value: 'Real-time analytics', count: 1 },
  ],
  industries: [{ value: 'Gaming', count: 1 }],
  categories: [],
  technologies: [],
  difficulty: [],
  platforms: [],
}

// Runs the helper the way a page does: it reads the catalog off the component
// version attribute, as JSON.
function helper (catalog) {
  const root = { site: { components: { solutions: { name: 'solutions', latest: { asciidoc: { attributes: { 'solutions-catalog': JSON.stringify(catalog) } } } } } } }
  return catalogHelper({ data: { root } })
}

// ---------------------------------------------------------------------------
// get-solutions-catalog
// ---------------------------------------------------------------------------

test('an empty facet stays empty, because the extension dropped it on purpose', () => {
  const catalog = helper({ solutions: RECORDS, facets: FACETS })
  // difficulty is 'beginner' on all three, so it narrows nothing and the
  // extension published []. Deriving it back from the records here is exactly
  // the bug this asserts against.
  assert.deepEqual(catalog.facets.difficulty, [])
  assert.deepEqual(catalog.facets.categories, [])
  // Sanity: the same records with the facet absent instead of empty DO get it
  // derived, which is what keeps a hand-written catalog working.
  const derived = helper({ solutions: RECORDS, facets: { useCases: FACETS.useCases } })
  assert.deepEqual(derived.facets.difficulty, [{ value: 'beginner', count: 3 }])
})

test('use case and industry come through, busiest value first', () => {
  const catalog = helper({ solutions: RECORDS, facets: FACETS })
  assert.deepEqual(catalog.facets.useCases, [
    { value: 'Change data capture', count: 2 },
    { value: 'Data lakehouse', count: 1 },
    { value: 'Real-time analytics', count: 1 },
  ], 'count desc, then alphabetical so the order is stable')
  assert.deepEqual(catalog.facets.industries, [{ value: 'Gaming', count: 1 }])
  // The axes are on the records too, which is what the cards filter on.
  const byId = {}
  catalog.all.forEach((r) => { byId[r.id] = r })
  assert.deepEqual(byId.lakehouse.useCases, ['Data lakehouse', 'Change data capture'])
  assert.deepEqual(byId.cdc.industries, [], 'absent industry is an empty list, not undefined')
})

test('a record that omits the axes entirely still normalizes', () => {
  const bare = { id: 'x', title: 'X', url: '/solutions/x/', status: 'published' }
  const catalog = helper({ solutions: [bare], facets: {} })
  assert.deepEqual(catalog.all[0].useCases, [])
  assert.deepEqual(catalog.all[0].industries, [])
  assert.deepEqual(catalog.facets.useCases, [])
  assert.deepEqual(catalog.facets.industries, [])
})

// ---------------------------------------------------------------------------
// the templates
// ---------------------------------------------------------------------------

test('the filters render a group per non-empty facet, use case first', () => {
  const html = renderFilters({ catalog: { facets: FACETS } })
  assert.deepEqual(legendsOf(html), ['Use case', 'Industry'],
    'difficulty, category, technology and platform are empty here and render nothing')
  assert.deepEqual(checkboxesOf(html), [
    { name: 'use-case', value: 'Change data capture' },
    { name: 'use-case', value: 'Data lakehouse' },
    { name: 'use-case', value: 'Real-time analytics' },
    { name: 'industry', value: 'Gaming' },
  ])
  assert.match(html, /Change data capture<\/span><span class="sol-filter-count">2</, 'the count is shown')
})

test('every facet group is gated, so an empty catalog renders no filter groups', () => {
  const html = renderFilters({ catalog: { facets: { useCases: [], industries: [], categories: [], technologies: [], difficulty: [], platforms: [] } } })
  assert.deepEqual(legendsOf(html), [])
  assert.deepEqual(checkboxesOf(html), [])
  assert.match(html, /data-sol-filter-q/, 'the search box is not a facet and stays')
})

test('a card carries both axes, pipe-joined, for the engine to match on', () => {
  const attrs = attributesOf(renderCard({ solution: RECORDS[1] }))
  assert.equal(attrs['data-use-cases'], 'Data lakehouse|Change data capture')
  assert.equal(attrs['data-industries'], '')
  assert.equal(attributesOf(renderCard({ solution: RECORDS[2] }))['data-industries'], 'Gaming')
})

test('the overview metadata strip shows what the solution is filed under', () => {
  const html = renderMeta({ solution: RECORDS[2] })
  assert.match(html, /<dt>Use case<\/dt>[\s\S]*?Real-time analytics/)
  assert.match(html, /<dt>Industry<\/dt>[\s\S]*?Gaming/)
  // No industry, no row: most solutions are not vertical-specific.
  const noIndustry = renderMeta({ solution: RECORDS[0] })
  assert.doesNotMatch(noIndustry, /<dt>Industry<\/dt>/)
  assert.match(noIndustry, /<dt>Use case<\/dt>/)
})

// ---------------------------------------------------------------------------
// the engine
// ---------------------------------------------------------------------------

test('checking a use case hides the solutions that do not have it', () => {
  const r = run({ records: RECORDS, facets: FACETS })
  assert.deepEqual(r.shown(), ['cdc', 'lakehouse', 'gaming'], 'sanity: everything shows first')
  r.check('use-case', 'Change data capture')
  assert.deepEqual(r.shown(), ['cdc', 'lakehouse'])
  assert.equal(r.count.textContent, '2 solutions')
  assert.equal(r.url(), '/solutions/?use-case=Change+data+capture')
  assert.equal(r.active.textContent, '1')
  assert.equal(r.clear.hidden, false)
})

test('two values in one group are OR, two groups are AND', () => {
  const r = run({ records: RECORDS, facets: FACETS })
  r.check('use-case', 'Data lakehouse')
  r.check('use-case', 'Real-time analytics')
  assert.deepEqual(r.shown(), ['lakehouse', 'gaming'], 'either use case')

  const both = run({ records: RECORDS, facets: FACETS })
  both.check('use-case', 'Real-time analytics')
  both.check('industry', 'Gaming')
  assert.deepEqual(both.shown(), ['gaming'])

  const neither = run({ records: RECORDS, facets: FACETS })
  neither.check('use-case', 'Data lakehouse')
  neither.check('industry', 'Gaming')
  assert.deepEqual(neither.shown(), [], 'no solution is both, and the empty state shows')
  assert.equal(neither.empty.hidden, false)
  assert.equal(neither.count.textContent, '0 solutions')
})

test('the two axes survive the URL, so a filtered link can be shared', () => {
  const r = run({ records: RECORDS, facets: FACETS, search: '?industry=Gaming&use-case=Real-time+analytics' })
  assert.deepEqual(r.shown(), ['gaming'])
  assert.equal(r.boxes.find((b) => b.attrs.value === 'Gaming').checked, true, 'the box is ticked from the URL')
  assert.equal(r.active.textContent, '2')
})

test('clearing resets the new axes as well as the old ones', () => {
  const r = run({ records: RECORDS, facets: FACETS, search: '?industry=Gaming' })
  assert.deepEqual(r.shown(), ['gaming'])
  r.clickClear()
  assert.deepEqual(r.shown(), ['cdc', 'lakehouse', 'gaming'])
  assert.equal(r.boxes.find((b) => b.attrs.value === 'Gaming').checked, false)
  assert.equal(r.url(), '/solutions/', 'and the parameter is gone from the URL')
  assert.equal(r.active.hidden, true)
})

test('search matches a use case or industry, not only the title', () => {
  const r = run({ records: RECORDS, facets: FACETS })
  r.search('lakehouse')
  assert.deepEqual(r.shown(), ['lakehouse'])
  r.search('gaming')
  assert.deepEqual(r.shown(), ['gaming'], 'from the industry, which appears nowhere in the title')
  r.search('nothing here')
  assert.deepEqual(r.shown(), [])
})

// ---------------------------------------------------------------------------
// the wiring between them
// ---------------------------------------------------------------------------

test('every checkbox the filters render is a facet the engine knows', () => {
  // FACET_ATTR is the engine's single declaration of the axes. Parse it out
  // rather than restating it, so this test fails when the two drift.
  const block = ENGINE.match(/var FACET_ATTR = \{([\s\S]*?)\n  \}/)
  assert.ok(block, 'FACET_ATTR not found in 29-solutions-home.js')
  const declared = {}
  block[1].split('\n').forEach((line) => {
    const m = line.match(/^\s*'?([\w-]+)'?:\s*'([\w-]+)',?\s*$/)
    if (m) declared[m[1]] = m[2]
  })
  assert.ok(Object.keys(declared).length >= 6, 'parsed the facet declarations: ' + JSON.stringify(declared))

  const html = renderFilters({
    catalog: {
      facets: {
        useCases: [{ value: 'U', count: 1 }], industries: [{ value: 'I', count: 1 }],
        categories: [{ value: 'C', count: 1 }], technologies: [{ value: 'T', count: 1 }],
        difficulty: [{ value: 'beginner', count: 1 }], platforms: [{ value: 'cloud', count: 1 }],
      },
    },
  })
  const names = Array.from(new Set(checkboxesOf(html).map((b) => b.name)))
  assert.equal(names.length, 6, 'a group per facet: ' + names.join(', '))
  names.forEach((name) => {
    assert.ok(declared[name], 'the engine has no attribute mapped for name="' + name + '"')
  })

  // And the card supplies every attribute those facets read.
  const attrs = attributesOf(renderCard({ solution: RECORDS[0] }))
  Object.keys(declared).forEach((facet) => {
    assert.ok(declared[facet] in attrs, 'solution-card.hbs has no ' + declared[facet] + ' for the ' + facet + ' facet')
  })
})
