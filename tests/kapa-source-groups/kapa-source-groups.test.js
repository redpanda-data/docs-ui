'use strict'

// Verifies version-scoped Ask AI retrieval (DOC-1807, DOC-2450) end to end
// through the REAL helper and the REAL chat-panel.hbs partial, not stand-ins.
//
// The bug being fixed, measured against Kapa's live retrieval API for the exact
// question in DOC-2450 ("hardware requirements for enterprise redpanda
// self-hosted"): unscoped, 11 results spread across 24.2, 24.3, 25.1, 25.2, 25.3
// and current, with only ONE from current. Scoped to the current group, 14 of 14
// came from current.
//
// Two things here are easy to get wrong and fail silently, so both are pinned:
//
//  1. The segment must come from page.url, not page.version.
//     latest_version_segment: 'current' publishes 26.2 at /streaming/current/,
//     so page.version says 26.2 while the Kapa mapping is keyed on 'current'.
//     Deriving from page.version would look right and miss every latest-version
//     reader, which is precisely the DOC-2450 population.
//
//  2. The two SDKs spell the option differently on purpose
//     (sourceGroupIdsInclude vs sourceGroupIDsInclude). An unknown React prop is
//     ignored with no error, so a typo means no filter is sent and answers come
//     from every version again.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Handlebars = require('handlebars')

const ROOT = path.join(__dirname, '..', '..')
const helper = require(path.join(ROOT, 'src/helpers/get-kapa-source-groups.js'))
const { versionSegmentFromUrl } = helper

// A trimmed copy of the shape doc-tools' generate kapa-source-groups emits.
const MAPPING = {
  project_id: '97f44223-f930-4fb9-ae1e-ecd436a4d85c',
  parent_group: { id: '238b3c08', name: 'Streaming', type: 'product' },
  default_segment: 'current',
  segments: {
    '24.2': { group_id: 'grp-242', group_name: '24.2', source_ids: ['s1'], source_names: ['Documentation (24.2)'] },
    '25.2': { group_id: 'grp-252', group_name: '25.2', source_ids: ['s2'], source_names: ['Documentation (25.2)'] },
    current: { group_id: 'grp-cur', group_name: 'current', source_ids: ['s3'], source_names: ['Documentation (current)'] },
  },
  global_sources: ['Agentic Data Plane', 'Documentation (Cloud)'],
}

const call = (page, { mapping = MAPPING, where = 'componentVersion' } = {}) => {
  const root = { page: { ...page } }
  const raw = mapping === null ? undefined : JSON.stringify(mapping)
  if (where === 'componentVersion') root.page.componentVersion = { asciidoc: { attributes: { 'kapa-source-groups': raw } } }
  if (where === 'component') root.page.component = { asciidoc: { attributes: { 'kapa-source-groups': raw } } }
  if (where === 'site') root.site = { asciidoc: { attributes: { 'kapa-source-groups': raw } } }
  if (where === 'none') { /* no attribute anywhere */ }
  return helper({ data: { root } })
}

const SEGS = MAPPING.segments
const seg = (url) => versionSegmentFromUrl(url, SEGS)

test('versionSegmentFromUrl reads the URL segment, which is what the mapping is keyed on', () => {
  assert.equal(seg('/streaming/25.2/get-started/intro/'), '25.2')
  // The latest release publishes at /streaming/current/ even though page.version
  // is 26.2. Getting this from the URL is the whole point.
  assert.equal(seg('/streaming/current/get-started/intro/'), 'current')
  // Unversioned components have no segment.
  assert.equal(seg('/cloud-data-platform/get-started/'), null)
  assert.equal(seg('/agentic-data-plane/reference/'), null)
  assert.equal(seg('/connect/components/'), null)
  assert.equal(seg('/home/'), null)
  // Junk must not throw.
  for (const v of [undefined, null, '', 42, {}, '/streaming/']) assert.equal(seg(v), null)
  // No segments map: degrade, do not throw.
  assert.equal(versionSegmentFromUrl('/streaming/25.2/x/', null), null)
})

test('versionSegmentFromUrl also reads the pre-rename layout', () => {
  // The docs component was renamed ROOT -> streaming, which moved every
  // versioned page from /<version>/ to /streaming/<version>/. A build over
  // pre-rename branches emitted 451 pages of 24.3 content scoped to current,
  // silently, because the old function matched a hardcoded /streaming/ prefix.
  assert.equal(seg('/24.2/manage/monitoring/'), '24.2')
  assert.equal(seg('/current/manage/monitoring/'), 'current')
})

test('versionSegmentFromUrl recognises only real segments, never a path word', () => {
  // Driven off the mapping's keys, so it cannot mistake an ordinary path
  // component for a version.
  assert.equal(seg('/cloud-data-platform/manage/cluster/'), null)
  assert.equal(seg('/streaming/beta/get-started/'), null, 'beta is not in this mapping')
  // Only the first two positions are considered, so a version-shaped word deep
  // in a path cannot hijack the scope.
  assert.equal(seg('/connect/components/outputs/25.2/'), null)
  // A file named after a version is not a segment.
  assert.equal(seg('/streaming/25.2.json'), null)
  assert.equal(seg('/25.2.html'), null)
})

test('a versioned page resolves to its own version group', () => {
  assert.deepEqual(call({ url: '/streaming/25.2/manage/monitoring/' }), ['grp-252'])
  assert.deepEqual(call({ url: '/streaming/24.2/manage/monitoring/' }), ['grp-242'])
})

test('the latest version resolves via its URL segment, not page.version', () => {
  // page.version deliberately disagrees with the URL, as it does in production.
  const got = call({ url: '/streaming/current/get-started/intro/', version: '26.2' })
  assert.deepEqual(got, ['grp-cur'])
})

test('unversioned pages resolve to the default segment, which is the DOC-2450 fix', () => {
  // The reporter was on a page with no version. Sending no filter there is what
  // let 25.2 content answer a latest-version question.
  for (const url of ['/cloud-data-platform/get-started/', '/agentic-data-plane/reference/', '/connect/components/', '/home/', '/search/']) {
    assert.deepEqual(call({ url }), ['grp-cur'], `expected default group for ${url}`)
  }
})

test('a published version with no group falls back to the default rather than sending nothing', () => {
  // This is the drift case: 26.3 published, nobody made the Kapa group yet.
  // Falling back to current beats searching all nine versions at once.
  assert.deepEqual(call({ url: '/streaming/26.3/get-started/intro/' }), ['grp-cur'])
})

test('reads the mapping from site.keys, the only channel that reaches the 404 page', () => {
  // 404.hbs has no page.component and no page.componentVersion, yet it renders
  // the Ask AI panel. Without site.keys it searched every docs version. Verified
  // in a real Antora build: 404.html now emits the default group.
  const root = { page: { url: '/nonexistent/' }, site: { keys: { 'kapa-source-groups': JSON.stringify(MAPPING) } } }
  assert.deepEqual(helper({ data: { root } }), ['grp-cur'])

  // With no page object at all, which is closer to what the 404 model provides.
  const bare = { site: { keys: { 'kapa-source-groups': JSON.stringify(MAPPING) } } }
  assert.deepEqual(helper({ data: { root: bare } }), ['grp-cur'])
})

test('a component attribute still wins over site.keys', () => {
  const other = { ...MAPPING, segments: { ...MAPPING.segments, '25.2': { group_id: 'grp-override' } } }
  const root = {
    page: { url: '/streaming/25.2/x/', componentVersion: { asciidoc: { attributes: { 'kapa-source-groups': JSON.stringify(other) } } } },
    site: { keys: { 'kapa-source-groups': JSON.stringify(MAPPING) } },
  }
  assert.deepEqual(helper({ data: { root } }), ['grp-override'])
})

test('reads the mapping from componentVersion, component or site attributes', () => {
  for (const where of ['componentVersion', 'component', 'site']) {
    assert.deepEqual(call({ url: '/streaming/25.2/x/' }, { where }), ['grp-252'], `from ${where}`)
  }
})

test('accepts an already-parsed object, not only a JSON string', () => {
  const root = { page: { url: '/streaming/25.2/x/', componentVersion: { asciidoc: { attributes: { 'kapa-source-groups': MAPPING } } } } }
  assert.deepEqual(helper({ data: { root } }), ['grp-252'])
})

test('degrades to no filter rather than throwing, in every unresolvable case', () => {
  // A wrong group is worse than no group: scoping to a group that does not hold
  // the reader's version returns only Kapa's global sources, silently.
  assert.deepEqual(call({ url: '/streaming/25.2/x/' }, { where: 'none' }), [], 'no attribute')
  assert.deepEqual(helper({ data: { root: {} } }), [], 'no page at all')
  assert.deepEqual(helper({ data: {} }), [], 'no root')
  assert.deepEqual(helper({}), [], 'no data')
  assert.deepEqual(helper(undefined), [], 'no options')

  // Malformed attribute: a broken helper is a broken build, so it must not throw.
  const bad = { page: { url: '/streaming/25.2/x/', componentVersion: { asciidoc: { attributes: { 'kapa-source-groups': '{not json' } } } } }
  assert.deepEqual(helper({ data: { root: bad } }), [])

  // Mapping present but shaped wrong.
  assert.deepEqual(call({ url: '/streaming/25.2/x/' }, { mapping: {} }), [])
  assert.deepEqual(call({ url: '/streaming/25.2/x/' }, { mapping: { segments: {} } }), [])
  // default_segment pointing at a segment that does not exist.
  assert.deepEqual(call({ url: '/nope/' }, { mapping: { default_segment: 'gone', segments: MAPPING.segments } }), [])
})

test('chat-panel.hbs emits the group id as a JS array literal', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/partials/chat-panel.hbs'), 'utf8')
  // Only the config <script> is needed, and the surrounding partial pulls in
  // helpers this test does not register.
  const start = source.indexOf('window.KAPA_SOURCE_GROUP_IDS')
  const snippet = source.slice(start, source.indexOf('];', start) + 2)
  assert.ok(snippet.includes('get-kapa-source-groups'), 'partial should call the helper')

  Handlebars.registerHelper('get-kapa-source-groups', helper)
  const rendered = Handlebars.compile(snippet)({
    page: {
      url: '/streaming/25.2/manage/monitoring/',
      componentVersion: { asciidoc: { attributes: { 'kapa-source-groups': JSON.stringify(MAPPING) } } },
    },
  })
  assert.match(rendered, /window\.KAPA_SOURCE_GROUP_IDS\s*=\s*window\.KAPA_SOURCE_GROUP_IDS\s*\|\|\s*\[/)
  assert.match(rendered, /"grp-252"/)
  // Must be valid JS, not just plausible text.
  const arr = eval(rendered.replace(/window\.KAPA_SOURCE_GROUP_IDS\s*=\s*window\.KAPA_SOURCE_GROUP_IDS\s*\|\|\s*/, '')) // eslint-disable-line no-eval
  assert.deepEqual(arr, ['grp-252'])
})

test('chat-panel.hbs emits a valid empty array when scoping cannot be resolved', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/partials/chat-panel.hbs'), 'utf8')
  const start = source.indexOf('window.KAPA_SOURCE_GROUP_IDS')
  const snippet = source.slice(start, source.indexOf('];', start) + 2)
  Handlebars.registerHelper('get-kapa-source-groups', helper)
  const rendered = Handlebars.compile(snippet)({ page: { url: '/streaming/25.2/x/' } })
  const arr = eval(rendered.replace(/window\.KAPA_SOURCE_GROUP_IDS\s*=\s*window\.KAPA_SOURCE_GROUP_IDS\s*\|\|\s*/, '')) // eslint-disable-line no-eval
  assert.deepEqual(arr, [], 'an unresolvable page must emit [] and not a syntax error')
})

test('AskAI.jsx uses the correct, different prop name for each SDK tier', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/js/react/AskAI.jsx'), 'utf8')

  // Kapa documents this casing difference deliberately; a typo is silent.
  assert.match(src, /agent:\s*'sourceGroupIdsInclude'/, 'Agent SDK takes lowercase d')
  assert.match(src, /chat:\s*'sourceGroupIDsInclude'/, 'Chat SDK takes capital ID')

  // Both providers must actually receive it.
  const agentBlock = src.slice(src.indexOf('<AgentProvider'), src.indexOf('</AgentProvider>'))
  assert.match(agentBlock, /sourceGroupProps\('agent'\)/, 'AgentProvider must be scoped')
  const chatBlock = src.slice(src.indexOf('<KapaProvider'), src.indexOf('</KapaProvider>'))
  assert.match(chatBlock, /sourceGroupProps\('chat'\)/, 'KapaProvider must be scoped')

  // Neither tier may send source_ids_include: verified live against Kapa's
  // retrieval API to be silently ignored (a garbage uuid returned full results),
  // and it is not a documented parameter of that endpoint.
  assert.doesNotMatch(src, /source_?[iI]ds_?[iI]nclude/, 'must not use source ids, only source groups')
})

test('sourceGroupProps omits the prop entirely when there is nothing to send', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/js/react/AskAI.jsx'), 'utf8')
  const body = src.slice(src.indexOf('function sourceGroupProps'), src.indexOf('function currentPageContext'))
  // Rebuild the function in isolation so the real logic is exercised.
  const SOURCE_GROUP_PROP = { agent: 'sourceGroupIdsInclude', chat: 'sourceGroupIDsInclude' }
  const fn = new Function('window', 'SOURCE_GROUP_PROP', body + '\nreturn sourceGroupProps') // eslint-disable-line no-new-func

  const withIds = fn({ KAPA_SOURCE_GROUP_IDS: ['grp-252'] }, SOURCE_GROUP_PROP)
  assert.deepEqual(withIds('agent'), { sourceGroupIdsInclude: ['grp-252'] })
  assert.deepEqual(withIds('chat'), { sourceGroupIDsInclude: ['grp-252'] })

  // Every "cannot resolve" shape must yield {} so the provider props stay exactly
  // as they were before this change.
  for (const w of [{}, { KAPA_SOURCE_GROUP_IDS: [] }, { KAPA_SOURCE_GROUP_IDS: null }, { KAPA_SOURCE_GROUP_IDS: 'nope' }, { KAPA_SOURCE_GROUP_IDS: [null, ''] }]) {
    assert.deepEqual(fn(w, SOURCE_GROUP_PROP)('agent'), {}, JSON.stringify(w))
  }
})
