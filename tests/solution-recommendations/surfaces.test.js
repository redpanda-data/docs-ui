/**
 * Solution surfaces outside the progress script: the recommendation
 * subtitle's claim, page options on solution pages, the single related-docs
 * list, the sidebar groups and tick text, and search scoping from a
 * solution page (algolia-script.hbs).
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const Handlebars = require('handlebars')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const helper = (name) => require(path.join(ROOT, 'src/helpers', name + '.js'))

function engine (helpers, partials) {
  const hbs = Handlebars.create()
  helpers.forEach((name) => hbs.registerHelper(name, helper(name)))
  partials.forEach((name) => hbs.registerPartial(name, read('src/partials/' + name + '.hbs')))
  return hbs
}

// ---- "Build it in practice" subtitle ----------------------------------------

const recsHbs = engine(['eq', 'lt', 'increment', 'parse-json', 'format-duration', 'relativize', 'without', 'get-solutions-catalog', 'recs-all-authored'], ['solution-recommendations'])
const renderRecs = recsHbs.compile('{{> solution-recommendations}}')
const recsPage = (recs) => ({ page: { attributes: { 'related-solutions': JSON.stringify(recs) }, component: { name: 'streaming' }, url: '/streaming/current/x/' } })
const rec = (id, provenance) => ({ id, title: id, url: '/solutions/' + id + '/', provenance })
const USES = 'Complete, runnable solutions that use what this page covers.'
const RELATED = 'Complete, runnable solutions related to what this page covers.'

test('authored recommendations say the solutions use what the page covers', () => {
  assert.ok(renderRecs(recsPage([rec('a', 'authored'), rec('b', 'authored')])).includes(USES))
  assert.ok(renderRecs(recsPage([rec('a', 'explicit'), rec('b', 'editor-approved')])).includes(USES), 'the older provenance names count as authored')
})

test('any category-inferred card softens the claim to "related to"', () => {
  const html = renderRecs(recsPage([rec('a', 'authored'), rec('b', 'category')]))
  assert.ok(html.includes(RELATED))
  assert.ok(!html.includes(USES))
  assert.ok(renderRecs(recsPage([rec('a', 'category')])).includes(RELATED))
  assert.ok(renderRecs(recsPage([rec('a')])).includes(RELATED), 'no provenance is not evidence of authorship')
})

test('only the cards that render decide the subtitle', () => {
  const recs = [rec('a', 'authored'), rec('b', 'authored'), rec('c', 'authored'), rec('d', 'category')]
  assert.ok(renderRecs(recsPage(recs)).includes(USES), 'the fourth card is never shown')
})

// ---- page options on solution pages ---------------------------------------

const PARTIALS = ['solution-hero', 'solution-step-header', 'markdown-dropdown']
const HELPERS = ['eq', 'or', 'concat', 'relativize', 'format-duration', 'format-release-date', 'get-solution-step', 'has-markdown', 'markdown-url', 'has-agent-handoff', 'agent-handoff-mode']
const surfaceHbs = engine(HELPERS, PARTIALS)
const renderHero = surfaceHbs.compile('{{> solution-hero solution=solution}}')
const renderStep = surfaceHbs.compile('{{> solution-step-header solution=solution}}')

const SOLUTION = {
  id: 'multiplayer-gaming',
  title: 'Multiplayer game events',
  url: '/solutions/multiplayer-gaming/',
  steps: [{ id: 'start-environment', title: 'Start the environment', url: '/solutions/multiplayer-gaming/start-environment/', order: 1, duration: 5 }],
}
const overview = { title: 'Multiplayer game events', layout: 'solution', url: '/solutions/multiplayer-gaming/', component: { name: 'solutions' }, attributes: {} }
const stepPage = { title: 'Start the environment', layout: 'solution-step', url: '/solutions/multiplayer-gaming/start-environment/', component: { name: 'solutions' }, attributes: { 'solution-step-id': 'start-environment', 'solution-step-index': '1', 'solution-step-count': '1' } }

test('the overview and step headers carry Copy as Markdown and the agent companion link', () => {
  for (const [label, html] of [['overview', renderHero({ solution: SOLUTION, page: overview })], ['step', renderStep({ solution: SOLUTION, page: stepPage })]]) {
    assert.match(html, /class="sol-page-options"/, label)
    assert.match(html, /data-action="copy"[\s\S]*Copy as Markdown/, label + ': the markdown dropdown')
    assert.match(html, /data-component-name="solutions"/, label + ': the dropdown sees the root page, not the partial context')
    assert.match(html, /data-action="agent-companion"/, label + ': the companion link')
  }
  assert.match(renderHero({ solution: SOLUTION, page: overview }), /href="agent-companion\.md"/, 'falls back to /solutions/<slug>/agent-companion.md, relativized')
  assert.match(renderStep({ solution: SOLUTION, page: stepPage }), /href="\.\.\/agent-companion\.md"/)
})

test("the companion link prefers the catalog record's agentCompanion URL", () => {
  const html = renderHero({ solution: Object.assign({}, SOLUTION, { agentCompanion: '/solutions/multiplayer-gaming/companion.md' }), page: overview })
  assert.match(html, /href="companion\.md"/)
  assert.doesNotMatch(html, /agent-companion\.md/)
})

test('the step header without a known step still gets page options', () => {
  const html = renderStep({ solution: SOLUTION, page: Object.assign({}, stepPage, { attributes: {} }) })
  assert.doesNotMatch(html, /sol-step-facts/, 'sanity: the fallback header')
  assert.match(html, /data-action="agent-companion"/)
})

test('other pages keep the dropdown without a companion link', () => {
  const plain = surfaceHbs.compile('{{> markdown-dropdown}}')({ page: { url: '/streaming/current/x/', component: { name: 'streaming' }, attributes: {} } })
  assert.match(plain, /Copy as Markdown/)
  assert.doesNotMatch(plain, /agent-companion/)
})

test('has-markdown allows the solution layouts', () => {
  const hasMarkdown = helper('has-markdown')
  const catalogWith = (marked) => ({ getById: () => ({ asciidoc: { attributes: marked ? { 'page-has-markdown': '' } : {} } }) })
  for (const layout of ['solution', 'solution-step']) {
    const page = { layout, component: { name: 'solutions' }, version: '', module: 'multiplayer-gaming', relativeSrcPath: 'index.adoc', attributes: {} }
    assert.equal(hasMarkdown({ data: { root: { contentCatalog: catalogWith(true), page } } }), true, layout)
    assert.equal(hasMarkdown({ data: { root: { contentCatalog: catalogWith(false), page } } }), false, layout + ' without an export')
  }
})

// ---- one related-docs list -------------------------------------------------

const relatedHbs = engine(['relativize', 'html-has-id'], ['solution-related-docs'])
const renderRelated = relatedHbs.compile('{{> solution-related-docs solution=solution}}')
const WITH_DOCS = { relatedDocs: [{ title: 'Consumer Offsets', url: '/streaming/current/offsets/', provenance: 'explicit' }] }

test('the generated related-docs list is skipped when the page authored its own', () => {
  const authored = renderRelated({ solution: WITH_DOCS, page: { url: '/solutions/g/', contents: Buffer.from('<div class="sect1"><h2 id="related-docs">Related docs</h2></div>') } })
  assert.doesNotMatch(authored, /Related documentation/)
  const generated = renderRelated({ solution: WITH_DOCS, page: { url: '/solutions/g/', contents: '<h2 id="steps">Steps</h2>' } })
  assert.match(generated, /Related documentation/)
  assert.match(generated, /id="sol-related-docs"/, 'its id cannot collide with an authored #related-docs')
  assert.doesNotMatch(generated, /id="related-docs"/)
})

test('html-has-id matches whole ids only', () => {
  const has = helper('html-has-id')
  assert.equal(has('<h2 id="related-docs">', 'related-docs'), true)
  assert.equal(has("<h2 id='related-docs'>", 'related-docs'), true)
  assert.equal(has('<h2 id="related-docs-2">', 'related-docs'), false)
  assert.equal(has('<h2 data-id="related-docs">', 'related-docs'), false)
  assert.equal(has(undefined, 'related-docs'), false)
})

// ---- sidebar ----------------------------------------------------------------

test('the sidebar groups stay open and each step has a place for its status text', () => {
  const navHbs = engine(['eq', 'ne', 'or', 'increment', 'parse-json', 'relativize', 'find-component', 'get-solutions-catalog'], ['nav-tree-solution'])
  const nav = { home: { url: '/solutions/' }, overview: { title: 'G', url: '/solutions/g/' }, steps: [{ id: 's1', title: 'One', url: '/solutions/g/s1/', order: 1 }] }
  const solution = { attachments: [{ name: 'Makefile', url: '/solutions/g/_attachments/Makefile' }] }
  const html = navHbs.compile('{{> nav-tree-solution}}')({
    page: { layout: 'solution', url: '/solutions/g/', component: { name: 'solutions', url: '/solutions/' }, attributes: { 'solution-nav': JSON.stringify(nav), solution: JSON.stringify(solution) } },
    uiRootPath: '/_',
  })
  assert.match(html, /nav-item sol-nav-group" data-depth="1">\s*<div class="item"><span class="nav-text sol-nav-heading">Steps/)
  assert.match(html, /<span class="visually-hidden sol-nav-step-status" data-sol-nav-step-status><\/span>/)
  assert.match(html, />All build-along files</)

  const css = read('src/css/solutions.css')
  assert.match(css, /\.sol-nav \.nav-item\.sol-nav-group > \.nav-list \{\s*display: block;/, 'overrides nav.css hiding lists of inactive items')
  assert.match(css, /\.sol-nav-step\.is-complete \.sol-nav-step-status:empty::after \{\s*content: "\(completed\)";/)
})

// ---- search from a solution page ---------------------------------------------

// Renders the build-time block of algolia-script.hbs for a page and evaluates
// the tag setup in a sandbox, so the assertion is on the tags a reader's
// first query actually filters by.
function initialTagsFor (componentTitle) {
  const hbs = engine(['eq', 'or', 'and', 'is-prerelease'], [])
  const src = read('src/partials/algolia-script.hbs')
  const start = src.indexOf('const SUPPORTED_PREVIEW_TYPES')
  const end = src.indexOf('function mapToAlgoliaFilters')
  assert.ok(start > 0 && end > start, 'found the tag setup block')
  const js = hbs.compile(src.slice(start, end))({
    page: { component: { name: componentTitle.toLowerCase(), title: componentTitle }, componentVersion: {} },
    site: { components: { streaming: { title: 'Self-Managed', latest: { version: '26.2' } } } },
  })
  const sandbox = {}
  vm.runInNewContext(js + '\nresult = applyFilterTags(INITIAL_TAGS, INITIAL_TAG).map((t) => t.label);', sandbox)
  return Array.from(sandbox.result)
}

test('search from a solution page includes Cloud and the latest Streaming docs', () => {
  const tags = initialTagsFor('Solutions')
  assert.ok(tags.includes('Solutions'), tags.join(', '))
  assert.ok(tags.includes('Cloud'), 'Cloud docs: ' + tags.join(', '))
  assert.ok(tags.includes('Self-Managed v26.2'), 'latest Streaming: ' + tags.join(', '))
})

test('dedupeCrumbs and solutionTitleOf', () => {
  const src = read('src/partials/algolia-script.hbs')
  const grab = (name) => src.slice(src.indexOf('function ' + name), src.indexOf('\n}\n', src.indexOf('function ' + name)) + 2)
  const sandbox = {}
  vm.runInNewContext(grab('dedupeCrumbs') + grab('solutionTitleOf'), sandbox)
  const trail = [{ t: 'Home', u: '/' }, { t: 'Solutions', u: '/solutions/' }, { t: 'G', u: '/solutions/g/' }, { t: 'Home', u: '/' }, { t: 'Solutions', u: '/solutions/' }]
  assert.equal(sandbox.dedupeCrumbs(trail).map((c) => c.t).join(' > '), 'Home > Solutions > G')
  assert.equal(sandbox.dedupeCrumbs(undefined), undefined)
  assert.equal(sandbox.solutionTitleOf({ type: 'Solution', title: 'Start the environment', solutionTitle: 'Multiplayer game events' }), 'Multiplayer game events')
  assert.equal(sandbox.solutionTitleOf({ type: 'Solution', title: 'G', solutionTitle: 'G' }), '', 'the overview record does not repeat itself')
  assert.equal(sandbox.solutionTitleOf({ type: 'Doc', title: 'X', solutionTitle: 'G' }), '')
  assert.match(read('src/layouts/search.hbs'), /hit\.solutionTitle/, '/search renders it too')
})
