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
  // Every partial that shows a platform uses these two, so every engine has them.
  ;[...helpers, 'platform-name', 'platform-list'].forEach((name) => hbs.registerHelper(name, helper(name)))
  partials.forEach((name) => hbs.registerPartial(name, read('src/partials/' + name + '.hbs')))
  return hbs
}

// ---- "Build it in practice" subtitle ----------------------------------------

const recsHbs = engine(['eq', 'lt', 'or', 'find-component', 'increment', 'parse-json', 'relativize', 'without', 'get-solutions-catalog', 'recs-all-authored'], ['solution-recommendations'])
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
const HELPERS = ['eq', 'or', 'concat', 'relativize', 'format-release-date', 'get-solution-step', 'has-markdown', 'markdown-url', 'has-agent-handoff', 'agent-handoff-mode']
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
  assert.doesNotMatch(authored, /id="sol-related-title"/)
  const generated = renderRelated({ solution: WITH_DOCS, page: { url: '/solutions/g/', contents: '<h2 id="steps">Steps</h2>' } })
  assert.match(generated, /<h2 id="sol-related-title" class="sol-section-title">Related docs<\/h2>/, 'the same heading an authored section uses')
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
  assert.doesNotMatch(html, /All build-along files/, 'the files are in the rail, not repeated in the sidebar')

  const css = read('src/css/solutions.css')
  assert.match(css, /\.sol-nav \.nav-item\.sol-nav-group > \.nav-list \{\s*display: block;/, 'overrides nav.css hiding lists of inactive items')
  assert.match(css, /\.sol-nav-step\.is-complete \.sol-nav-step-status:empty::after \{\s*content: "\(completed\)";/)
})

test('on the landing page the sidebar holds the filters, not a second list of every solution', () => {
  const navHbs = engine(['eq', 'ne', 'or', 'increment', 'parse-json', 'relativize', 'find-component', 'get-solutions-catalog'], ['nav-tree-solution', 'solutions-filters'])
  const titles = ['Keep a live leaderboard current', 'Stream database changes into a lakehouse', 'Fail over to a standby cluster', 'Migrate from Apache Kafka', 'Fan one sports feed out']
  const solutions = titles.map((title, i) => ({ id: 's' + i, title, url: '/solutions/s' + i + '/', status: 'published', useCases: [i ? 'Data fan-out' : 'Real-time analytics'] }))
  const html = navHbs.compile('{{> nav-tree-solution}}')({
    page: {
      layout: 'solutions-home',
      url: '/solutions/',
      component: { name: 'solutions', url: '/solutions/' },
      attributes: { 'solutions-catalog': JSON.stringify({ solutions, facets: { useCases: [{ value: 'Real-time analytics', count: 1 }, { value: 'Data fan-out', count: 4 }] } }) },
    },
    uiRootPath: '/_',
  })
  assert.doesNotMatch(html, /Solutions home/, 'no link to the page the reader is on')
  titles.forEach((title) => assert.ok(!html.includes(title), title + ' is in the grid, not the sidebar'))
  assert.doesNotMatch(html, /All solutions/)
  assert.match(html, /<div class="sol-nav-filters" data-sol-filters-home>\s*<details class="sol-filters" data-sol-filters open>/, 'the filters are in the sidebar')
  assert.match(html, /<noscript>[\s\S]*Every solution is listed on this page/)

  // A solution page keeps its own tree and gets no filters.
  const nav = { overview: { title: 'G', url: '/solutions/g/' }, steps: [{ id: 's1', title: 'One', url: '/solutions/g/s1/', order: 1 }] }
  const onSolution = navHbs.compile('{{> nav-tree-solution}}')({
    page: { layout: 'solution', url: '/solutions/g/', component: { name: 'solutions', url: '/solutions/' }, attributes: { 'solution-nav': JSON.stringify(nav), solution: '{}' } },
    uiRootPath: '/_',
  })
  assert.doesNotMatch(onSolution, /data-sol-filters/)
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

// ---- breadcrumbs ---------------------------------------------------------------

test('the topbar breadcrumb truncates the page title, never the middle crumb', () => {
  // "Home > Solutions > title" has three crumbs, which the collapse script
  // leaves alone, so the CSS decides which one gives way.
  const css = read('src/css/header.css')
  assert.match(css, /\.topbar-crumbs \.breadcrumbs li:not\(:first-child\):not\(:last-child\):not\(\.bc-ellipsis-li\) \{\s*flex-shrink: 0;\s*\}/)
  assert.match(css, /\.topbar-crumbs \.breadcrumbs li:last-child:not\(:first-child\) \{\s*flex-shrink: 1;\s*min-width: 0;\s*overflow: hidden;/)
  assert.match(css, /li:last-child:not\(:first-child\) a,[\s\S]*?text-overflow: ellipsis;/)
})

// ---- Ask AI suggestions ------------------------------------------------------------

test('Ask AI on a solutions page suggests solution questions, not the agent defaults', () => {
  const page = { component: { name: 'solutions', asciidoc: { attributes: {} } } }
  const ai = helper('get-ai-suggestions')({ data: { root: { page } } })
  assert.ok(ai.length > 0)
  assert.ok(ai.every((q) => !/agent|MCP|token budget/i.test(q)), ai.join(' | '))
  const agent = helper('get-agent-suggestions')({ data: { root: { page } } })
  assert.match(agent.join(' | '), /solution/i)
  // Authored attributes still win.
  const authored = { component: { name: 'solutions', asciidoc: { attributes: { 'ai-suggestion-1': 'Mine' } } } }
  assert.deepEqual(helper('get-ai-suggestions')({ data: { root: { page: authored } } }), ['Mine'])
})

// ---- overview layout ----------------------------------------------------------------

test('the overview puts Steps after the introduction and before the first section, as an On this page section', () => {
  const hbs = engine(['eq', 'or', 'parse-json', 'relativize', 'get-header-color', 'split-at-first-section', 'html-has-id'], ['solution-steps', 'solution-related-docs', 'solution-overview-next'])
  ;['head', 'head-component-color', 'header', 'nav', 'toolbar', 'breadcrumbs', 'solution-hero', 'solution-meta', 'feedback-footer', 'tracking-pixel', 'solution-progress', 'toc', 'solution-code-download', 'solution-files', 'footer', 'chat-panel'].forEach((name) => hbs.registerPartial(name, ''))
  const solution = {
    id: 'g',
    steps: [{ id: 's1', title: 'One', url: '/solutions/g/s1/', order: 1 }],
    relatedSolutions: [{ title: 'Other', url: '/solutions/o/' }],
  }
  const contents = '<div id="preamble"><div class="sectionbody"><p>Intro.</p></div></div>\n' +
    '<div class="sect1"><h2 id="what-you-build">What you build</h2><div class="sectionbody"></div></div>\n' +
    '<div class="sect1"><h2 id="prerequisites">Prerequisites</h2><div class="sectionbody"></div></div>'
  const html = hbs.compile(read('src/layouts/solution.hbs'))({
    page: { layout: 'solution', url: '/solutions/g/', attributes: { solution: JSON.stringify(solution) }, contents: Buffer.from(contents) },
  })
  const at = (needle) => { const i = html.indexOf(needle); assert.ok(i !== -1, needle); return i }
  assert.ok(at('Intro.') < at('id="steps"'), 'preamble first')
  assert.ok(at('id="steps"') < at('id="what-you-build"'), 'Steps before the first authored section')
  assert.match(html, /<div class="sect1 sol-steps" id="steps">\s*<h2 id="sol-steps-title" class="sol-section-title">Steps<\/h2>\s*<div class="sectionbody">/,
    'matches the TOC selector article.doc>.sect1>h2[id]')
  assert.match(html, /<div class="sect1 sol-related sol-related--solutions" id="sol-related-solutions">\s*<h2 id="sol-related-solutions-title"/)
  assert.equal((html.match(/id="what-you-build"/g) || []).length, 1, 'no section is rendered twice')
  // The overview closes with the hero's Start CTA, after every section.
  assert.ok(at('id="prerequisites"') < at('class="sol-overview-next"'), 'the closing Start is last')
  assert.ok(at('id="sol-related-solutions"') < at('class="sol-overview-next"'))
  assert.match(html, /<nav class="sol-overview-next" aria-label="Start this solution">\s*<a class="sol-btn sol-btn--primary" href="[^"]*s1\/" data-sol-start data-analytics="solution_start">/)
  assert.match(html, /<span class="sol-overview-next-step">Step 1: One<\/span>/)

  const split = helper('split-at-first-section')
  assert.deepEqual(split('<p>only</p>'), { before: '<p>only</p>', after: '' }, 'no sections: all before')
  assert.deepEqual(split(undefined), { before: '', after: '' })
  assert.equal(split('<p>a</p><div class="sect1 x"><h2>').after, '<div class="sect1 x"><h2>')
})

test('the rail file list is collapsed on every page, inside the progress card', () => {
  const hbs = engine(['eq', 'and', 'not', 'relativize', 'encode-uri'], ['solution-code-download', 'solution-files', 'solution-access-gate'])
  const render = hbs.compile('{{> solution-code-download solution=solution}}{{> solution-files solution=solution}}')
  const solution = { id: 'g', version: 'v1.0.0', download: 'public', files: ['Makefile', 'compose.yaml'] }
  for (const page of [{ layout: 'solution', url: '/solutions/g/' }, { layout: 'solution-step', url: '/solutions/g/s1/' }]) {
    const html = render({ solution, page })
    assert.match(html, /<details class="sol-files-details">/, page.layout + ': collapsed')
    assert.match(html, /All build-along files \(2\)/)
    assert.match(html, /<span>Makefile<\/span>/, 'the links are there, just collapsed')
    assert.doesNotMatch(html, /class="sol-panel[ "]/, page.layout + ': a section of the card, not a second panel')
  }
})

test('the rail file list is record.files as gated download links, never public attachment links', () => {
  const hbs = engine(['eq', 'and', 'not', 'relativize', 'encode-uri'], ['solution-code-download', 'solution-files', 'solution-access-gate'])
  const render = hbs.compile('{{> solution-code-download solution=solution}}{{> solution-files solution=solution}}')
  const attachments = [{ name: 'verification.json', url: '/solutions/g/_attachments/verification.json' }]
  const files = ['docker-compose.yml', 'services/leaderboard/main.go', 'scripts/verify-lib.sh']
  const page = { layout: 'solution', url: '/solutions/g/' }
  const gated = render({ solution: { id: 'g', version: 'v1.2.0', status: 'published', download: 'authenticated', files, attachments }, page })
  assert.doesNotMatch(gated, /_attachments/, 'attachments are evidence, not the build-along list')
  assert.match(gated, /All build-along files \(3\)/, 'the count is record.files')
  const links = gated.match(/<a class="sol-file-link"[^>]*>/g)
  assert.equal(links.length, 3)
  assert.match(links[1], /href="\/solutions\/download\?solution=g&amp;version=v1\.2\.0&amp;path=services%2Fleaderboard%2Fmain\.go&amp;return=%2Fsolutions%2Fg%2F"/)
  assert.match(links[1], /data-sol-file-link="services\/leaderboard\/main\.go"/)
  links.forEach((a) => assert.match(a, /data-requires-auth/))
  assert.match(gated, /Sign in to download all 3 as one zip, tested at v1\.2\.0\./)
  assert.doesNotMatch(gated, /without the download/, 'no promise of public files')

  const pub = render({ solution: { id: 'g', version: 'v1.2.0', download: 'public', files }, page })
  assert.doesNotMatch(pub, /data-requires-auth/)
  assert.match(pub, /path=scripts%2Fverify-lib\.sh/)

  const draft = render({ solution: { id: 'g', version: 'v0.1.0', status: 'draft', download: 'authenticated', files }, page })
  const draftLinks = draft.match(/<a class="sol-file-link[^"]*"[^>]*>/g)
  assert.equal(draftLinks.length, 3)
  draftLinks.forEach((a) => {
    assert.doesNotMatch(a, /href=/, 'a draft has no link, public or gated')
    assert.match(a, /aria-disabled="true"/)
  })
  assert.match(draft, /Download available at release\./)

  // TEMPORARY, preview only: draftDownloads gives a draft the gated links.
  const previewDraft = render({ solution: { id: 'g', version: 'v0.1.0', status: 'draft', download: 'authenticated', draftDownloads: true, files }, page })
  const previewLinks = previewDraft.match(/<a class="sol-file-link[^"]*"[^>]*>/g)
  assert.equal(previewLinks.length, 3)
  previewLinks.forEach((a) => assert.doesNotMatch(a, /aria-disabled/))
  assert.match(previewDraft, /data-requires-auth/)
  assert.doesNotMatch(previewDraft, /Download available at release/)

  assert.doesNotMatch(render({ solution: { id: 'g', download: 'none', files }, page }), /sol-files/, 'no downloads, no download list')
  assert.doesNotMatch(render({ solution: { id: 'g', download: 'authenticated', files: [], attachments }, page }), /sol-files/)
})

test('every step page carries a Mark step complete toggle; a step with a next step adds Complete and continue', () => {
  const hbs = engine(['eq', 'relativize', 'subtract', 'concat', 'or'], ['solution-step-actions', 'solution-productionize-link', 'solution-productionize'])
  const render = hbs.compile('{{> solution-step-actions solution=solution}}')
  const solution = { id: 'g', version: 'v1.0.0', url: '/solutions/g/', download: 'public', steps: [{ id: 's1', url: '/solutions/g/s1/' }, { id: 's2', url: '/solutions/g/s2/' }] }
  const middle = render({ solution, page: { url: '/solutions/g/s1/', attributes: { 'solution-next-url': '/solutions/g/s2/', 'solution-next-title': 'Two' } } })
  assert.match(middle, /data-sol-complete-continue/)
  assert.match(middle, /data-sol-complete data-analytics/, 'the toggle stays: the only way to mark without leaving, or to un-mark')
  const last = render({ solution, page: { url: '/solutions/g/s2/', attributes: { 'solution-prev-url': '/solutions/g/s1/', 'solution-prev-title': 'One' } } })
  assert.doesNotMatch(last, /data-sol-complete-continue/, 'nothing to continue to')
  assert.match(last, /class="sol-btn sol-btn--primary" data-sol-complete /, 'the toggle is the last step\'s primary action')
  // The last step ends with the Take this to production card; no other step does.
  assert.match(last, /id="take-to-production"/)
  assert.doesNotMatch(middle, /id="take-to-production"/)
})
