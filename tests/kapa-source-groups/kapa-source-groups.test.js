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

// Antora compiles each helper in isolation, so the segment is a MODE of the one
// helper rather than a second file that requires it. A sibling require fails at
// page-composition time with a fatal error and takes the whole build down.
const segmentHelper = (opts) => helper('segment', opts)

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
  const snippet = source.slice(start, source.indexOf(';\n', start) + 1)
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
  const snippet = source.slice(start, source.indexOf(';\n', start) + 1)
  Handlebars.registerHelper('get-kapa-source-groups', helper)
  const rendered = Handlebars.compile(snippet)({ page: { url: '/streaming/25.2/x/' } })
  const arr = eval(rendered.replace(/window\.KAPA_SOURCE_GROUP_IDS\s*=\s*window\.KAPA_SOURCE_GROUP_IDS\s*\|\|\s*/, '')) // eslint-disable-line no-eval
  assert.deepEqual(arr, [], 'an unresolvable page must emit [] and not a syntax error')
})

test('the prop name for each tier matches the installed SDK typings, not just itself', () => {
  // Review caught the previous version of this test asserting the same literal
  // strings the source contains, so it passed even if both names were wrong.
  // The oracle is now the installed packages' own .d.mts. An unknown React prop
  // is dropped with no error, so a wrong name means no filter is ever sent and
  // answers come from every version again; this is the check that makes that
  // fail CI instead of shipping.
  const src = fs.readFileSync(path.join(ROOT, 'src/js/react/AskAI.jsx'), 'utf8')
  const agentName = src.match(/agent:\s*'([A-Za-z]+)'/)[1]
  const chatName = src.match(/chat:\s*'([A-Za-z]+)'/)[1]

  const agentTypes = fs.readFileSync(path.join(ROOT, 'node_modules/@kapaai/agent-react/dist/index.d.mts'), 'utf8')
  const chatTypes = fs.readFileSync(path.join(ROOT, 'node_modules/@kapaai/react-sdk/dist/index.d.mts'), 'utf8')

  // Declared as an optional string[] prop on the provider in each SDK.
  assert.match(agentTypes, new RegExp(`^\\s*${agentName}\\?: string\\[\\];`, 'm'),
    `@kapaai/agent-react does not declare a prop named ${agentName}`)
  assert.match(chatTypes, new RegExp(`^\\s*${chatName}\\?: string\\[\\];`, 'm'),
    `@kapaai/react-sdk does not declare a prop named ${chatName}`)

  // And the names really are different, which is the trap. If Kapa ever
  // unifies them this assertion is the one to relax.
  assert.notEqual(agentName, chatName)
  assert.doesNotMatch(agentTypes, new RegExp(`^\\s*${chatName}\\?:`, 'm'), 'the chat name must not also be valid on the agent SDK, or this test proves nothing')
  assert.doesNotMatch(chatTypes, new RegExp(`^\\s*${agentName}\\?:`, 'm'), 'the agent name must not also be valid on the chat SDK, or this test proves nothing')

  // Both providers must actually receive it.
  const agentBlock = src.slice(src.indexOf('<AgentProvider'), src.indexOf('</AgentProvider>'))
  assert.match(agentBlock, /sourceGroupProps\('agent'\)/, 'AgentProvider must be scoped')
  const chatBlock = src.slice(src.indexOf('<KapaProvider'), src.indexOf('</KapaProvider>'))
  assert.match(chatBlock, /sourceGroupProps\('chat'\)/, 'KapaProvider must be scoped')

  // Neither tier may send source_ids_include: verified live against Kapa's
  // retrieval API to be silently ignored (a garbage uuid returned full results).
  assert.doesNotMatch(src, /sourceIdsInclude|source_ids_include/i)
})

test('both SDKs send the prop to the wire as source_group_ids_include', () => {
  // The prop name is only half of it; the built SDK must translate it to the
  // field Kapa's API reads. Established live: source_group_ids_include is
  // honoured, source_ids_include is accepted and ignored.
  const chatBuilt = fs.readFileSync(path.join(ROOT, 'node_modules/@kapaai/react-sdk/dist/index.mjs'), 'utf8')
  assert.match(chatBuilt, /source_group_ids_include/)
  // agent-react forwards the prop to agent-core, which builds the request body.
  const agentCore = fs.readFileSync(path.join(ROOT, 'node_modules/@kapaai/agent-core/dist/index.mjs'), 'utf8')
  assert.match(agentCore, /body\.source_group_ids_include\s*=\s*sourceGroupIdsInclude/)
})

test('group ids are emitted as script-safe JSON, never raw', () => {
  const hostile = 'a"</script><script>alert(1)//'
  const mapping = { ...MAPPING, segments: { ...MAPPING.segments, current: { group_id: hostile } } }
  const opts = withMapping('/home/', mapping)
  const json = helper('json', opts)
  // No literal </script>, no unescaped quote, and it round-trips to the value.
  assert.doesNotMatch(json, /<\/script>/i)
  assert.doesNotMatch(json, /<script/i)
  assert.deepEqual(JSON.parse(json), [hostile])
  // A plain id is unchanged apart from being a JSON literal.
  assert.equal(helper('json', withMapping('/streaming/25.2/x/')), JSON.stringify([MAPPING.segments['25.2'].group_id]))
  // Empty when nothing resolves.
  assert.equal(helper('json', { data: { root: {} } }), '[]')
  assert.equal(helper('segment-json', { data: { root: {} } }), '""')
})

test('a non-string group_id yields no group at all, not "[object Object]"', () => {
  for (const bad of [{}, [], 42, true, '']) {
    const mapping = { ...MAPPING, segments: { ...MAPPING.segments, '25.2': { group_id: bad } } }
    const opts = withMapping('/streaming/25.2/x/', mapping)
    assert.deepEqual(helper(opts), [], `group_id ${JSON.stringify(bad)} must resolve to nothing`)
    assert.equal(helper('segment', opts), '')
    assert.equal(helper('json', opts), '[]')
  }
})

test('the template emits only the two JSON modes, never a raw triple-stash of an id', () => {
  const partial = fs.readFileSync(path.join(ROOT, 'src/partials/chat-panel.hbs'), 'utf8')
  assert.match(partial, /KAPA_SOURCE_GROUP_IDS \|\| \{\{\{get-kapa-source-groups 'json'\}\}\}/)
  assert.match(partial, /KAPA_SOURCE_GROUP_SEGMENT \|\| \{\{\{get-kapa-source-groups 'segment-json'\}\}\}/)
  assert.doesNotMatch(partial, /\{\{#each \(get-kapa-source-groups\)/)
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

// The reported segment and the sent group must come from ONE resolution.
//
// The bug this prevents, found by review: currentPageContext() in AskAI.jsx
// re-derived the version with its own URL regex, so for /streaming/26.2/... it
// said "26.2" while get-kapa-source-groups sent the `current` group (26.2 is
// not a segment; the latest release publishes at /streaming/current/). The
// prompt then told the model the results were 26.2-only AND not to ask, so the
// agent attributed a current-version answer to 26.2.

// A page carrying the mapping on its component version, built without hand
// nesting so the brace depth cannot drift.
const withMapping = (url, mapping = MAPPING) => ({
  data: {
    root: {
      page: {
        url,
        componentVersion: { asciidoc: { attributes: { 'kapa-source-groups': mapping } } },
      },
    },
  },
})

test('the reported segment always names the group that was actually sent', () => {
  for (const url of [
    '/streaming/25.2/manage/monitoring/',
    '/streaming/current/get-started/intro/',
    '/streaming/26.2/get-started/intro/',   // the reported failure: not a segment
    '/streaming/26.9/get-started/intro/',   // published, no Kapa group yet
    '/24.2/manage/monitoring/',             // pre-rename layout
    '/cloud-data-platform/get-started/',
    '/home/',
  ]) {
    const opts = withMapping(url)
    const ids = helper(opts)
    const segment = segmentHelper(opts)
    assert.equal(ids.length, 1, `expected one group for ${url}`)
    assert.equal(MAPPING.segments[segment].group_id, ids[0], `segment/group disagree for ${url}`)
  }
})

test('a page on the latest release reports current, not the release number', () => {
  // 26.2 publishes at /streaming/current/, so 26.2 must never be reported.
  assert.equal(segmentHelper(withMapping('/streaming/26.2/x/')), 'current')
})

test('the reported segment is empty whenever no group is sent', () => {
  // The prompt keys off this to decide whether it may claim a restriction.
  const cases = [
    { data: { root: {} } },
    { data: { root: { page: { url: '/streaming/25.2/x/' } } } },  // no mapping anywhere
    withMapping('/x/', '{ not json'),                             // unparseable mapping
  ]
  for (const opts of cases) {
    assert.deepEqual(helper(opts), [], 'expected no group')
    assert.equal(segmentHelper(opts), '', 'expected no segment')
  }
})

test('AskAI reads the emitted segment rather than re-deriving it from the URL', () => {
  // Guards the fix structurally: a reintroduced regex here would silently
  // reopen the disagreement.
  const askai = fs.readFileSync(path.join(ROOT, 'src/js/react/AskAI.jsx'), 'utf8')
  const ctx = askai.slice(askai.indexOf('function currentPageContext'))
  const body = ctx.slice(0, ctx.indexOf('\n}'))
  assert.match(body, /window\.KAPA_SOURCE_GROUP_SEGMENT/)
  assert.doesNotMatch(body, /\\d\+\\\.\\d\+/, 'currentPageContext must not parse a version out of the URL itself')
})

test('the chat panel emits the segment alongside the group ids', () => {
  const partial = fs.readFileSync(path.join(ROOT, 'src/partials/chat-panel.hbs'), 'utf8')
  assert.match(partial, /window\.KAPA_SOURCE_GROUP_SEGMENT/)
  assert.match(partial, /get-kapa-source-groups 'segment-json'/)
})

test('a helper must never require a sibling helper', () => {
  // Antora compiles every UI helper in isolation. A relative require of another
  // helper resolves at page-composition time, not load time, and fails FATAL:
  // "Cannot find module './get-kapa-source-groups.js' ... in UI template
  // layouts/default.hbs", which aborts the entire site build. Caught by a real
  // all-components Antora build, not by unit tests.
  const dir = path.join(ROOT, 'src/helpers')
  const offenders = []
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    for (const m of src.matchAll(/require\(\s*['"](\.\/[^'"]+)['"]\s*\)/g)) {
      offenders.push(`${f} requires ${m[1]}`)
    }
  }
  assert.deepEqual(offenders, [])
})

test('the helper serves both outputs from one call site', () => {
  // The array form must keep working with no argument, because that is how
  // Handlebars invokes it in the each-block.
  const opts = withMapping('/streaming/25.2/x/')
  assert.deepEqual(helper(opts), [MAPPING.segments['25.2'].group_id])
  assert.equal(helper('segment', opts), '25.2')
  // An unrecognised mode falls back to the array rather than throwing.
  assert.deepEqual(helper('nonsense', opts), [MAPPING.segments['25.2'].group_id])
})
