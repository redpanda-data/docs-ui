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
;['eq', 'ne', 'lt', 'gt', 'and', 'or', 'increment', 'parse-json', 'format-duration', 'format-release-date', 'format-verified-evidence', 'relativize', 'without', 'get-solutions-catalog', 'recs-all-authored'].forEach((name) => {
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

// ---- rail placement (solution-recommendations-rail.hbs, included from toc.hbs) ----

hbs.registerPartial('solution-recommendations-rail', read('src/partials/solution-recommendations-rail.hbs'))
const renderRail = hbs.compile('{{> solution-recommendations-rail}}')

function railPage (attributes, over) {
  return {
    page: Object.assign({
      layout: 'default',
      attributes,
      component: { name: 'streaming' },
      url: '/streaming/current/develop/x/',
    }, over),
  }
}

test('the rail partial renders nothing without the attribute, and nothing for an empty or malformed one', () => {
  assert.equal(renderRail(railPage({})).trim(), '')
  assert.equal(renderRail(railPage({ 'related-solutions': '[]' })).trim(), '')
  assert.equal(renderRail(railPage({ 'related-solutions': '{not json' })).trim(), '')
})

test('the rail partial renders up to 3 one-line entries with placement, provenance and a hidden reason', () => {
  const html = renderRail(railPage({ 'related-solutions': JSON.stringify(RECS) }))
  assert.match(html, /<h3 class="sol-rail-recs-title">Build it in practice<\/h3>/)
  assert.equal((html.match(/class="sol-rail-rec"/g) || []).length, 3)
  assert.equal((html.match(/data-placement="rail"/g) || []).length, 3)
  assert.doesNotMatch(html, /Delta|Echo/, 'capped at 3')
  assert.match(html, /data-provenance="explicit"[^>]*data-position="1"/)
  assert.match(html, /<span class="sol-rail-rec-title">Alpha<\/span>/)
  assert.match(html, /<span class="sol-rail-rec-diff is-beginner">beginner<\/span>/)
  assert.match(html, /30 min/)
  assert.match(html, /1 hr 15 min/)
  assert.match(html, /<span class="sol-rec-why" data-sol-rec-why hidden>Why this\? Linked from this page<\/span>/)
  // Compact: no descriptions and no card markup.
  assert.doesNotMatch(html, /sol-rec-card|sol-rec-desc/)
  assert.doesNotMatch(html, /First|Second|Third/)
  assert.match(html, /href="\.\.\/\.\.\/\.\.\/\.\.\/solutions\/a\/"/, 'relativized like the cards')
})

test('the rail partial honours every guard the article section honours', () => {
  const attrs = { 'related-solutions': JSON.stringify(RECS) }
  assert.notEqual(renderRail(railPage(attrs)).trim(), '', 'sanity')
  assert.equal(renderRail(railPage(Object.assign({ 'exclude-related-solutions': '' }, attrs))).trim(), '', 'valueless opt-out')
  assert.equal(renderRail(railPage(Object.assign({ 'exclude-related-solutions': 'true' }, attrs))).trim(), '')
  assert.equal(renderRail(railPage(Object.assign({ role: 'home' }, attrs))).trim(), '', 'home role')
  assert.equal(renderRail(railPage(Object.assign({ role: 'component-home-v3' }, attrs))).trim(), '', 'component landing role')
  assert.equal(renderRail(railPage(attrs, { component: { name: 'solutions' } })).trim(), '', 'solutions component')
  assert.equal(renderRail(railPage(attrs, { layout: 'solution-step' })).trim(), '', 'not a Product Docs layout')
  assert.equal(renderRail(railPage(attrs, { layout: 'component-home-v3' })).trim(), '')
  assert.notEqual(renderRail(railPage(attrs, { layout: 'index' })).trim(), '', 'index pages get it too')
})

test('both placements exist, read the same attribute, and are distinguishable in analytics', () => {
  const rail = read('src/partials/solution-recommendations-rail.hbs')
  const article = read('src/partials/solution-recommendations.hbs')
  const toc = read('src/partials/toc.hbs')
  const progress = read('src/js/28-solution-progress.js')

  for (const [name, src] of [['rail', rail], ['article', article]]) {
    assert.match(src, /parse-json page\.attributes\.related-solutions/, name + ' reads page-related-solutions')
    assert.match(src, /page\.attributes\.exclude-related-solutions/, name + ' honours the opt-out')
    assert.match(src, /data-sol-rec\b/, name + ' entries are tracked')
  }
  assert.match(rail, /data-placement="rail"/)
  assert.match(article, /data-placement="article"/)

  // toc.hbs renders the rail block right after the On this page list.
  const tocMenu = toc.indexOf('<div class="toc-menu">')
  const include = toc.indexOf('{{> solution-recommendations-rail}}')
  assert.ok(include > tocMenu, 'included after .toc-menu')
  assert.ok(include < toc.indexOf('toc-tools-title'), 'and before the tools section')

  // One tracking path covers both placements, with placement in the payload.
  assert.match(progress, /placement: attr\(el, 'data-placement'\)/)
  assert.match(progress, /product_doc_solution_rec_impression/)
  assert.match(progress, /product_doc_solution_rec_click/)
  // Narrow screens: the block is moved into the embedded on-this-page region.
  assert.match(progress, /function placeRailRecs/)
  assert.match(progress, /aside\.toc\.embedded/)
  assert.ok(progress.indexOf('placeRailRecs()') < progress.indexOf('observeImpressions()'),
    'relocated before impressions are observed, so the observer sees its final position')
})

// ---- the meta strip, the catalog card, and the step header ----

hbs.registerPartial('solution-meta', read('src/partials/solution-meta.hbs'))
hbs.registerPartial('solution-card', read('src/partials/solution-card.hbs'))
const renderMeta = hbs.compile('{{> solution-meta solution=solution}}')
const renderCard = hbs.compile('{{> solution-card solution=solution}}')

const SOLUTION = {
  id: 'gaming',
  title: 'Gaming',
  url: '/solutions/gaming/',
  status: 'published',
  difficulty: 'intermediate',
  duration: 45,
  stepCount: 4,
  technologies: ['Go'],
  categories: ['Clients'],
  platforms: ['cloud'],
  version: 'v1.0.0',
}
function stepRenderer () {
  const stepHbs = Handlebars.create()
  ;['eq', 'or', 'concat', 'format-duration', 'format-release-date', 'relativize', 'get-solution-step', 'has-markdown', 'markdown-url', 'has-agent-handoff', 'agent-handoff-mode'].forEach((name) => {
    stepHbs.registerHelper(name, helper(name))
  })
  stepHbs.registerPartial('solution-step-header', read('src/partials/solution-step-header.hbs'))
  stepHbs.registerPartial('markdown-dropdown', read('src/partials/markdown-dropdown.hbs'))
  return stepHbs.compile('{{> solution-step-header solution=solution}}')
}

// The step facts row (duration, difficulty, completed) hangs off
// get-solution-step. It silently emptied once the extension renamed the
// attribute to page-solution-step-id and the helper kept reading the old
// page-solution-step, so both names are asserted here.
test('the step header resolves the current step from page-solution-step-id (and the legacy name)', () => {
  const renderStep = stepRenderer()
  const solution = Object.assign({}, SOLUTION, {
    steps: [{ id: 'start-environment', title: 'Start the environment', url: '/solutions/gaming/start-environment/', order: 1, duration: 5 }],
  })
  const at = (attributes) => renderStep({ solution, page: { title: 'Start the environment', attributes } })

  for (const key of ['solution-step-id', 'solution-step']) {
    const html = at({ [key]: 'start-environment', 'solution-difficulty': 'intermediate', 'solution-step-index': '1', 'solution-step-count': '4' })
    assert.match(html, /class="sol-step-facts/, key + ': the facts row renders')
    assert.match(html, /About 5 min/, key + ': step duration')
    assert.match(html, /sol-diff is-intermediate/, key + ': difficulty chip')
  }

  const unknown = at({ 'solution-step-id': 'nope' })
  assert.doesNotMatch(unknown, /sol-step-facts/, 'an unknown step id falls back to the plain header')
})

// ---- proof of the last test run (verified) ----

const VERIFIED = {
  suite: 'solutions/gaming',
  specs: 11,
  steps: 50,
  commands: 34,
  checks: 23,
  media: 2,
  verifyScript: { status: 'PASS', passed: 9, total: 9 },
  redpandaVersion: '26.2.2',
  runAt: '2026-09-13T02:14:07Z',
}
const withVerified = (verified) => ({ solution: Object.assign({}, SOLUTION, verified === undefined ? {} : { verified }) })

test('format-release-date keeps its short form and gains a long one, both in UTC', () => {
  const formatReleaseDate = helper('format-release-date')
  assert.equal(formatReleaseDate('2026-03-14', { hash: {} }), 'Mar 2026', 'the release-page callers are unchanged')
  assert.equal(formatReleaseDate('2026-03-14'), 'Mar 2026', 'called with no options at all')
  assert.equal(formatReleaseDate('2026-09-13T02:14:07Z', { hash: { long: true } }), 'September 13, 2026')
  assert.equal(formatReleaseDate('2026-09-13T23:50:00Z', { hash: { long: true } }), 'September 13, 2026', 'a late timestamp does not roll into the next day')
  assert.equal(formatReleaseDate('', { hash: { long: true } }), '')
  assert.equal(formatReleaseDate('not a date', { hash: { long: true } }), '')
})

// Antora's UI loader and build-preview-pages both evaluate each helper's
// source with no module path of its own, so a helper that requires a sibling
// dies with MODULE_NOT_FOUND at build time (and the preview build wipes public/
// before it fails, which makes it look like a template error).
test('no helper requires a sibling helper, because the UI loader evaluates each one standalone', () => {
  const dir = path.join(ROOT, 'src/helpers')
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.js'))) {
    assert.doesNotMatch(
      fs.readFileSync(path.join(dir, file), 'utf8'),
      /require\(\s*['"]\.{1,2}\//,
      file + ' requires a relative path; inline what it needs or compose the helpers in the template instead'
    )
  }
})

test('a run date that does not parse is silent, and never reaches the page as a raw string', () => {
  // A manifest typo is published to the record as written (with a build
  // warning) so the record never disagrees with the file, so it can arrive here.
  for (const runAt of ['last Tuesday', 'yesterday', 'soon', '13/09/2026', 'null']) {
    const html = renderMeta(withVerified(Object.assign({}, VERIFIED, { runAt })))
    assert.doesNotMatch(html, /Last verified/, runAt + ': no row')
    assert.doesNotMatch(html, new RegExp(runAt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), runAt + ': the raw value is never printed')
    assert.match(html, /<dt>Version<\/dt>/, runAt + ': the rest of the strip is unaffected')
  }
})

test('a good date with no recorded version renders without the version clause', () => {
  const html = renderMeta(withVerified({ runAt: '2026-09-13T02:14:07Z', commands: 11 }))
  assert.match(html, /<dd class="sol-verified" title="11 commands run">September 13, 2026<\/dd>/)
  assert.doesNotMatch(html, /against Redpanda/)

  const step = stepRenderer()({
    solution: Object.assign({}, SOLUTION, { steps: [{ id: 's1', title: 'One', url: '/s/1/', order: 1, duration: 5 }] }),
    page: { title: 'One', attributes: { 'solution-step-id': 's1', 'solution-verified-at': '2026-09-13T02:14:07Z' } },
  })
  assert.match(step, /<span class="sol-fact sol-fact--verified">Last verified September 13, 2026<\/span>/)
  assert.doesNotMatch(step, /against Redpanda/)
})

test('format-verified-evidence lists the run counts and the verify script result in reader terms', () => {
  const evidence = helper('format-verified-evidence')
  const call = (verified) => evidence(verified, { hash: {} })
  assert.equal(call(VERIFIED), '34 commands run, 23 outputs checked, 2 screen captures, verify script passed 9 of 9')
  assert.doesNotMatch(call(VERIFIED), /specs?\b|steps?\b/, "Doc Detective's specs and steps never reach the reader: '50 steps' contradicted 'Steps: 9'")
  assert.equal(call({ specs: 1, steps: 1, commands: 1, checks: 1, media: 1 }), '1 command run, 1 output checked, 1 screen capture')
  assert.equal(call({ specs: 3, media: 0 }), '0 screen captures', 'a reported zero is evidence; an unreported count is left out')
  assert.equal(call({ verifyScript: 'PASS (9/9)' }), 'verify script passed 9 of 9', 'a ready-made string is reworded')
  assert.equal(call({ verifyScript: { status: 'PASS', passed: 9, total: 9 } }), 'verify script passed 9 of 9')
  assert.equal(call({ verifyScript: { status: 'FAIL' } }), 'verify script failed', 'no pass counts recorded for the script')
  assert.equal(call({ verifyScript: 'SKIPPED' }), 'verify script SKIPPED', 'an unknown status passes through')
  assert.equal(call(undefined), '')
  assert.equal(call({}), '')
})

test('the overview meta strip renders Last verified after Version, with the evidence in the title', () => {
  const html = renderMeta(withVerified(VERIFIED))
  assert.match(html, /<dt>Last verified<\/dt>/)
  assert.match(
    html,
    /<dd class="sol-verified" title="34 commands run, 23 outputs checked, 2 screen captures, verify script passed 9 of 9">September 13, 2026 against Redpanda 26\.2\.2<\/dd>/
  )
  assert.ok(html.indexOf('Last verified') > html.indexOf('<dt>Version</dt>'), 'sits after the Version row')
})

test('the overview renders nothing at all when a solution carries no verified record', () => {
  for (const missing of [undefined, null, {}, { redpandaVersion: '26.2.2' }, { runAt: '' }, { runAt: 'nonsense' }]) {
    const html = renderMeta(withVerified(missing))
    const label = JSON.stringify(missing) + ': '
    assert.doesNotMatch(html, /Last verified/, label + 'no row')
    assert.doesNotMatch(html, /sol-verified/, label + 'no element')
    assert.doesNotMatch(html, /not verified|unverified|never verified/i, label + 'absence is silence, not a placeholder or warning')
    assert.match(html, /<dt>Version<\/dt>/, label + 'the rest of the strip is unaffected')
  }
})

test('an old run date is shown exactly as it is, with no softening and no hiding', () => {
  const stale = renderMeta(withVerified(Object.assign({}, VERIFIED, { runAt: '2024-01-05T02:00:00Z' })))
  assert.match(stale, /January 5, 2024 against Redpanda 26\.2\.2/, 'a two-year-old run still states its date')
  assert.doesNotMatch(stale, /stale|outdated|out of date|may no longer|warning/i)
})

test('the title attribute is omitted rather than left empty when CI recorded no evidence', () => {
  const html = renderMeta(withVerified({ runAt: '2026-09-13T02:14:07Z', redpandaVersion: '26.2.2' }))
  assert.match(html, /<dd class="sol-verified">September 13, 2026 against Redpanda 26\.2\.2<\/dd>/)
  assert.doesNotMatch(html, /title=""/)
})

test('step pages render the verified line from the scalar mirrors, and nothing without them', () => {
  const renderStep = stepRenderer()
  const solution = Object.assign({}, SOLUTION, {
    verified: VERIFIED,
    steps: [{ id: 'start-environment', title: 'Start the environment', url: '/solutions/gaming/start-environment/', order: 1, duration: 5 }],
  })
  const at = (attributes) => renderStep({ solution, page: { title: 'Start the environment', attributes: Object.assign({ 'solution-step-id': 'start-environment', 'solution-difficulty': 'intermediate' }, attributes) } })

  const html = at({ 'solution-verified-at': '2026-09-13T02:14:07Z', 'solution-verified-version': '26.2.2' })
  assert.match(html, /<span class="sol-fact sol-fact--verified">Last verified September 13, 2026 against Redpanda 26\.2\.2<\/span>/)
  assert.ok(html.indexOf('sol-fact--verified') > html.indexOf('sol-diff is-intermediate'), 'sits in the facts row after the difficulty')

  assert.match(at({ 'solution-verified-at': '2026-09-13T02:14:07Z' }), /Last verified September 13, 2026<\/span>/, 'date mirror only')

  for (const mirrors of [{}, { 'solution-verified-version': '26.2.2' }, { 'solution-verified-at': '' }]) {
    const bare = at(mirrors)
    assert.doesNotMatch(bare, /verified/i, JSON.stringify(mirrors) + ': the step page says nothing')
    assert.match(bare, /About 5 min/, 'the rest of the facts row is unaffected')
  }
})

test('the landing cards and the recommendation entries deliberately stay out of it', () => {
  assert.doesNotMatch(renderCard(withVerified(VERIFIED)), /verified/i, 'the catalog card is already dense')
  const recs = JSON.stringify([Object.assign({}, RECS[0], { verified: VERIFIED })])
  assert.doesNotMatch(render(page({ 'related-solutions': recs })), /verified/i)
  assert.doesNotMatch(renderRail(railPage({ 'related-solutions': recs })), /verified/i)
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

test('nav-tree-solution consumes the object shape the extension writes for page-solution-nav', () => {
  const navHbs = Handlebars.create()
  ;['eq', 'ne', 'or', 'gt', 'increment', 'parse-json', 'relativize', 'find-component', 'get-solutions-catalog'].forEach((name) => {
    navHbs.registerHelper(name, helper(name))
  })
  navHbs.registerPartial('nav-tree-solution', read('src/partials/nav-tree-solution.hbs'))
  const renderNav = navHbs.compile('{{> nav-tree-solution}}')

  const nav = {
    home: { title: 'Solutions', url: '/solutions/' },
    overview: { title: 'Gaming', url: '/solutions/gaming/' },
    steps: [
      { id: 'start-environment', title: 'Start the environment', url: '/solutions/gaming/start-environment/', order: 1, duration: 5 },
      { id: 'create-topics', title: 'Create the topics', url: '/solutions/gaming/create-topics/', order: 2, duration: 5 },
    ],
  }
  const site = { components: { solutions: { name: 'solutions', url: '/solutions/', versions: [{ version: '' }], latestVersion: { version: '' } } } }
  const stepPage = { layout: 'solution-step', url: '/solutions/gaming/create-topics/', component: { name: 'solutions', url: '/solutions/' }, attributes: { 'solution-nav': JSON.stringify(nav), 'solution-step-id': 'create-topics' } }

  const html = renderNav({ site, page: stepPage, uiRootPath: '/_' })
  assert.match(html, /class="nav-link sol-nav-home" href="\.\.\/\.\.\/">Solutions home/, 'home link from the component')
  assert.match(html, /sol-nav-overview" data-depth="1">\s*<div class="item">\s*<a class="nav-link" href="\.\.\/">Overview<\/a>/, 'overview crumb without is-current on a step page')
  assert.equal((html.match(/data-sol-nav-step="/g) || []).length, 2, 'two steps rendered')
  assert.match(html, /data-sol-nav-url="\/solutions\/gaming\/start-environment\/" data-sol-nav-step="start-environment"/)
  assert.match(html, /sol-nav-step is-current-page" data-depth="2" data-sol-nav-url="\/solutions\/gaming\/create-topics\/"/, 'current step from page-solution-step-id')
  assert.doesNotMatch(html, /sol-nav-step is-current-page" data-depth="2" data-sol-nav-url="\/solutions\/gaming\/start-environment\//)
  assert.match(html, /aria-current="page"[^>]*>\s*<span class="sol-nav-step-num" aria-hidden="true">2<\/span>/)

  const overviewPage = Object.assign({}, stepPage, { layout: 'solution', url: '/solutions/gaming/', attributes: { 'solution-nav': JSON.stringify(nav) } })
  const overviewHtml = renderNav({ site, page: overviewPage, uiRootPath: '/_' })
  assert.match(overviewHtml, /sol-nav-overview is-current-page"/, 'overview is current on the overview page')
  assert.doesNotMatch(overviewHtml, /sol-nav-step is-current-page"/)

  // The old flat-array shape must not blow up; it simply renders no tree.
  const legacy = renderNav({ site, page: Object.assign({}, stepPage, { attributes: { 'solution-nav': JSON.stringify([{ title: 'x', url: '/x/', kind: 'step', order: 1 }]) } }), uiRootPath: '/_' })
  assert.doesNotMatch(legacy, /sol-nav-step/)
  assert.match(legacy, /Solutions home/)
})

test('entry points render only when the solutions component exists', () => {
  const header = read('src/partials/header-content.hbs')
  const switcher = read('src/partials/product-switcher.hbs')
  const home = read('src/partials/home.hbs')
  for (const [name, src] of [['header-content', header], ['product-switcher', switcher], ['home', home]]) {
    assert.match(src, /\(has-component site 'solutions'\)/, name + ' is guarded on the component')
  }
  assert.equal((header.match(/>Solutions<\/a>/g) || []).length, 2, 'top bar and overflow menu links')
  assert.match(switcher, /data-product-id="solutions"/)
  for (const attr of ['intent-solutions-title', 'intent-solutions-desc', 'intent-solutions-link', 'intent-solutions-cta']) {
    assert.match(home, new RegExp('page\\.attributes\\.' + attr.replace(/-/g, '\\-')), attr)
  }
})

test('the recommendation partial never renders a repository URL', () => {
  const html = render(page({ 'related-solutions': JSON.stringify(RECS) }))
  assert.doesNotMatch(html, /github\.com/)
  for (const partial of ['solution-code-download', 'solution-access-gate', 'solution-hero', 'solution-meta', 'solution-card', 'nav-tree-solution']) {
    assert.doesNotMatch(read('src/partials/' + partial + '.hbs'), /github\.com|solution\.repo|\.repo\b/, partial + ' must not render the repo')
  }
})
