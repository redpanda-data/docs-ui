'use strict'

// Verifies the Ask AI lookup_config_property tool (src/js/react/agentTools.js)
// reads the published property reference that head-meta names in
// <meta name="properties-json-url">, the same file the property tooltips read,
// and uses the sample redpanda-properties.json from the UI bundle only in the
// docs-ui preview.
//
// fixture-published.json holds three records copied from the published
// redpanda-properties-v26.2.4.json. The sample in src/static has none of
// default_topic_replications or write_caching_default.
//
// agentTools.js is an ES module and CI runs Node 18, so it is loaded through
// vm with its single export rewritten into a global assignment (see
// tests/latest-version-tool for the same harness).

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '..', '..')
const TOOLS = path.join(ROOT, 'src/js/react/agentTools.js')
const PUBLISHED = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-published.json'), 'utf8'))
const SAMPLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/static/redpanda-properties.json'), 'utf8'))
const META_URL = '/streaming/current/reference/_attachments/redpanda-properties-v26.2.4.json'

function loadTool ({ metas = {}, preview = false, files = {} } = {}) {
  const source = fs.readFileSync(TOOLS, 'utf8')
  const rewritten = source.replace(/^export const agentTools =/m, 'globalThis.agentTools =')
  assert.notEqual(rewritten, source, 'the agentTools export shape changed; update this harness')
  const fetched = []
  const querySelector = (sel) => {
    const m = sel.match(/^meta\[name="([^"]+)"\]$/)
    if (m) return m[1] in metas ? { content: metas[m[1]] } : null
    return null
  }
  const window = {
    location: { origin: 'https://docs.redpanda.com', href: 'https://docs.redpanda.com/' },
    addEventListener: () => {},
    uiRootPath: '/_',
    siteRootPath: '',
  }
  if (preview) window.isUiPreview = true
  const context = {
    console,
    URL,
    fetch: (url) => {
      fetched.push(url)
      if (!(url in files)) return Promise.resolve({ ok: false, status: 404 })
      return Promise.resolve({ ok: true, json: () => Promise.resolve(files[url]) })
    },
    window,
    document: {
      querySelector,
      querySelectorAll: () => [],
      addEventListener: () => {},
      body: { getAttribute: () => 'streaming' },
    },
  }
  context.globalThis = context
  vm.runInNewContext(rewritten, context)
  return { tool: context.agentTools.find((t) => t.name === 'lookup_config_property'), fetched }
}

test('reads the published reference named by the page meta', async () => {
  const { tool, fetched } = loadTool({
    metas: { 'properties-json-url': META_URL },
    files: { [META_URL]: PUBLISHED, '/redpanda-properties.json': SAMPLE },
  })
  const r = await tool.execute({ property: 'default_topic_replications' })
  assert.equal(r.found, true)
  assert.equal(r.default, 1)
  assert.equal(r.scope, 'cluster')
  assert.equal(r.cloudSupported, true)
  assert.deepEqual(fetched, [META_URL])
})

test('finds a property only the published reference has', async () => {
  assert.equal('write_caching_default' in SAMPLE.properties, false)
  const { tool } = loadTool({ metas: { 'properties-json-url': META_URL }, files: { [META_URL]: PUBLISHED } })
  const r = await tool.execute({ property: 'write_caching_default' })
  assert.equal(r.found, true)
  assert.equal(r.name, 'write_caching_default')
})

test('returns the Cloud flags the published reference carries', async () => {
  const { tool } = loadTool({ metas: { 'properties-json-url': META_URL }, files: { [META_URL]: PUBLISHED } })
  const r = await tool.execute({ property: 'default_topic_replications' })
  const rec = PUBLISHED.properties.default_topic_replications
  assert.equal(r.cloudEditable, rec.cloud_editable)
  assert.equal(r.cloudReadonly, rec.cloud_readonly)
  assert.equal(r.cloudByocOnly, rec.cloud_byoc_only)
})

test('fetches the reference once for repeated lookups', async () => {
  const { tool, fetched } = loadTool({ metas: { 'properties-json-url': META_URL }, files: { [META_URL]: PUBLISHED } })
  await tool.execute({ property: 'default_topic_replications' })
  await tool.execute({ property: 'log_segment_size' })
  assert.deepEqual(fetched, [META_URL])
})

test('on a real page with no meta, says so and never reads the sample', async () => {
  const { tool, fetched } = loadTool({ files: { '/redpanda-properties.json': SAMPLE } })
  const r = await tool.execute({ property: 'log_segment_size' })
  assert.equal(r.found, false)
  assert.match(r.error, /names no property reference/)
  assert.deepEqual(fetched, [])
})

test('in the docs-ui preview with no meta, reads the bundled sample', async () => {
  const { tool, fetched } = loadTool({ preview: true, files: { '/_/redpanda-properties.json': SAMPLE } })
  const name = Object.keys(SAMPLE.properties)[0]
  const r = await tool.execute({ property: name })
  assert.equal(r.found, true)
  assert.deepEqual(fetched, ['/_/redpanda-properties.json'])
})

test('a failed fetch reports an error and is retried on the next lookup', async () => {
  const files = {}
  const { tool, fetched } = loadTool({ metas: { 'properties-json-url': META_URL }, files })
  const first = await tool.execute({ property: 'default_topic_replications' })
  assert.equal(first.found, false)
  assert.match(first.error, /not found \(404\)/)
  files[META_URL] = PUBLISHED
  const second = await tool.execute({ property: 'default_topic_replications' })
  assert.equal(second.found, true)
  assert.equal(fetched.length, 2)
})
