/**
 * "Build it in practice" on Product Docs pages: src/partials/solution-recommendations.hbs
 * rendered with the real helpers, plus the guards around it in article.hbs,
 * component-home-v3.hbs and add-suggested-labs.js.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const Handlebars = require('handlebars')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const helper = (name) => require(path.join(ROOT, 'src/helpers', name + '.js'))

const hbs = Handlebars.create()
;['eq', 'ne', 'lt', 'gt', 'and', 'or', 'increment', 'parse-json', 'format-duration', 'relativize'].forEach((name) => {
  hbs.registerHelper(name, helper(name))
})
hbs.registerPartial('solution-recommendations', read('src/partials/solution-recommendations.hbs'))
const render = hbs.compile('{{> solution-recommendations}}')

function page (attributes, extra) {
  return Object.assign({ page: Object.assign({ attributes, component: { name: 'streaming' }, url: '/streaming/current/develop/x/' }) }, extra)
}

const RECS = [
  { id: 'a', title: 'Alpha', url: '/solutions/a/', description: 'First', difficulty: 'beginner', duration: 30, technologies: ['Go', 'Redis', 'Postgres', 'Extra'], provenance: 'explicit', score: 1, reason: 'Linked from this page' },
  { id: 'b', title: 'Bravo', url: '/solutions/b/', description: 'Second', difficulty: 'intermediate', duration: 75, technologies: [], provenance: 'editor-approved', score: 0.9, reason: 'Approved by docs' },
  { id: 'c', title: 'Charlie', url: '/solutions/c/', description: 'Third', difficulty: 'advanced', duration: 45, technologies: ['Iceberg'], provenance: 'category', score: 0.6, reason: 'Shares Stream Processing' },
  { id: 'd', title: 'Delta', url: '/solutions/d/', provenance: 'category', score: 0.4, reason: 'fourth' },
  { id: 'e', title: 'Echo', url: '/solutions/e/', provenance: 'category', score: 0.3, reason: 'fifth' },
]

test('renders nothing when page-related-solutions is absent, empty, or malformed', () => {
  assert.equal(render(page({})).trim(), '')
  assert.equal(render(page({ 'related-solutions': '[]' })).trim(), '')
  assert.equal(render(page({ 'related-solutions': '{not json' })).trim(), '')
  assert.equal(render(page({ 'related-solutions': '{"id":"x"}' })).trim(), '', 'a non-array is not a list')
})

test('page-exclude-related-solutions opts out, whether valueless or true', () => {
  const attrs = { 'related-solutions': JSON.stringify(RECS) }
  assert.notEqual(render(page(attrs)).trim(), '', 'sanity: renders without the opt-out')
  assert.equal(render(page(Object.assign({ 'exclude-related-solutions': '' }, attrs))).trim(), '', 'valueless attribute (Antora stores it as "")')
  assert.equal(render(page(Object.assign({ 'exclude-related-solutions': 'true' }, attrs))).trim(), '')
})

test('renders at most 3 cards with provenance, position, duration and a hidden reason', () => {
  const html = render(page({ 'related-solutions': JSON.stringify(RECS) }))
  assert.equal((html.match(/class="sol-rec-card"/g) || []).length, 3)
  assert.match(html, /<h2 id="build-it-in-practice"[^>]*>Build it in practice<\/h2>/)
  assert.match(html, /data-provenance="explicit"/)
  assert.match(html, /data-provenance="editor-approved"/)
  assert.match(html, /data-provenance="category"/)
  assert.match(html, /data-position="1"/)
  assert.match(html, /data-position="3"/)
  assert.doesNotMatch(html, /data-position="4"/)
  assert.doesNotMatch(html, /Delta|Echo/)
  assert.match(html, /1 hr 15 min/, 'duration formatted')
  assert.match(html, /<span class="sol-rec-why" data-sol-rec-why hidden>Why this\? Linked from this page<\/span>/)
  assert.match(html, /data-component="streaming"/)
  assert.match(html, /href="\.\.\/\.\.\/\.\.\/\.\.\/solutions\/a\/"/, 'urls are relativized against the page (/streaming/current/develop/x/ is four levels deep)')
  assert.equal((html.match(/sol-chip--tech/g) || []).length, 4, 'max 3 technology chips per card (3 + 1)')
})

test('escapes titles and descriptions', () => {
  const html = render(page({ 'related-solutions': JSON.stringify([{ id: 'x', title: '<b>X</b>', url: '/solutions/x/', description: 'a "quote" & more', provenance: 'explicit' }]) }))
  assert.match(html, /&lt;b&gt;X&lt;\/b&gt;/)
  assert.match(html, /a &quot;quote&quot; &amp; more/)
})

test('article.hbs hooks the partial in after the role chain, only for default/index layouts and never for home, component-home-v3 or the solutions component', () => {
  const article = read('src/partials/article.hbs')
  const idx = article.indexOf('{{> solution-recommendations}}')
  assert.ok(idx !== -1, 'partial referenced')
  const guard = article.slice(article.lastIndexOf('{{#if', idx), idx)
  assert.match(guard, /\(eq page\.layout 'default'\)/)
  assert.match(guard, /\(eq page\.layout 'index'\)/)
  assert.match(guard, /\(ne page\.attributes\.role 'home'\)/)
  assert.match(guard, /\(ne page\.attributes\.role 'component-home-v3'\)/)
  assert.match(guard, /\(ne page\.component\.name 'solutions'\)/)
  assert.ok(idx > article.indexOf('add-suggested-labs'), 'placed after the role chain')
  assert.ok(idx < article.indexOf('{{> feedback-footer}}'), 'placed before the footer')
})

test('component-home-v3.hbs renders the automatic section, with page-solutions-* slots taking precedence', () => {
  const home = read('src/partials/component-home-v3.hbs')
  assert.match(home, /\{\{> solution-recommendations\}\}/)
  assert.match(home, /page\.attributes\.solutions-title/)
  assert.match(home, /page\.attributes\.solutions-1-title/)
  assert.match(home, /page\.attributes\.solutions-link/)
  assert.ok(home.indexOf('page.attributes.solutions-title') < home.indexOf('{{> solution-recommendations}}'), 'slots are the if-branch, automatic is the else')
})

test('add-suggested-labs.js returns the content unchanged when related-solutions is a non-empty array', () => {
  const addSuggestedLabs = helper('add-suggested-labs')
  const content = Buffer.from('<p>body</p>')
  const options = { data: { root: { contentCatalog: {} } } }
  const labs = JSON.stringify([{ title: 'Lab', url: '/labs/x/' }])

  const withSolutions = addSuggestedLabs({ 'related-labs': labs, 'related-solutions': JSON.stringify(RECS.slice(0, 1)) }, content, options)
  assert.equal(withSolutions, content, 'same buffer back: no Suggested labs appended')

  const withoutSolutions = addSuggestedLabs({ 'related-labs': labs }, content, options).toString()
  assert.match(withoutSolutions, /Suggested labs/, 'still appends when there are no solutions')

  const emptySolutions = addSuggestedLabs({ 'related-labs': labs, 'related-solutions': '[]' }, content, options).toString()
  assert.match(emptySolutions, /Suggested labs/, 'an empty list does not suppress labs')

  const malformed = addSuggestedLabs({ 'related-labs': labs, 'related-solutions': '{oops' }, content, options).toString()
  assert.match(malformed, /Suggested labs/, 'malformed JSON counts as none')
})

test('get-solutions-catalog normalizes facets to {value, count} from the extension shape and from plain strings', () => {
  const getCatalog = helper('get-solutions-catalog')
  const records = [
    { id: 'a', title: 'A', url: '/solutions/a/', status: 'published', difficulty: 'advanced', categories: ['Clients', 'Integration'], technologies: ['Go'], platforms: ['cloud'] },
    { id: 'b', title: 'B', url: '/solutions/b/', status: 'published', difficulty: 'beginner', categories: ['Clients'], technologies: ['Go', 'Redis'], platforms: ['self-managed', 'cloud'] },
  ]
  const call = (facets) => getCatalog({ data: { root: { page: { attributes: { 'solutions-catalog': JSON.stringify({ solutions: records, facets }) } } } } })

  const fromExtension = call({ categories: [{ value: 'Clients', count: 2 }, { value: 'Integration', count: 1 }], difficulty: [{ value: 'advanced', count: 1 }, { value: 'beginner', count: 1 }] })
  assert.deepEqual(fromExtension.facets.categories, [{ value: 'Clients', count: 2 }, { value: 'Integration', count: 1 }])
  assert.deepEqual(fromExtension.facets.difficulty.map((f) => f.value), ['beginner', 'advanced'], 'difficulty sorted by level')
  assert.deepEqual(fromExtension.facets.technologies, [{ value: 'Go', count: 2 }, { value: 'Redis', count: 1 }], 'missing facets are derived from the records')

  const fromStrings = call({ categories: ['Integration', 'Clients'], platforms: ['cloud', 'self-managed'] })
  assert.deepEqual(fromStrings.facets.categories, [{ value: 'Integration', count: 1 }, { value: 'Clients', count: 2 }], 'plain strings gain counts')
  assert.deepEqual(fromStrings.facets.platforms, [{ value: 'cloud', count: 2 }, { value: 'self-managed', count: 1 }])

  // The filters partial renders the value, never the object.
  const filters = hbs.compile(read('src/partials/solutions-filters.hbs'))({ catalog: fromExtension })
  assert.doesNotMatch(filters, /\[object Object\]/)
  assert.match(filters, /<input type="checkbox" name="category" value="Clients"><span class="sol-filter-label">Clients<\/span><span class="sol-filter-count">2<\/span>/)
})

test('the recommendation partial never renders a repository URL', () => {
  const html = render(page({ 'related-solutions': JSON.stringify(RECS) }))
  assert.doesNotMatch(html, /github\.com/)
  for (const partial of ['solution-code-download', 'solution-access-gate', 'solution-hero', 'solution-meta', 'solution-card', 'nav-tree-solution']) {
    assert.doesNotMatch(read('src/partials/' + partial + '.hbs'), /github\.com|solution\.repo|\.repo\b/, partial + ' must not render the repo')
  }
})
