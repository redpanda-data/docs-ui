'use strict'

// Verifies the Ask AI get_latest_version tool (src/js/react/agentTools.js) and
// the release meta tags it reads, which src/partials/head-meta.hbs writes from
// the attributes on the latest Streaming and Connect component versions.
//
// agentTools.js is an ES module and CI runs Node 18, so it is loaded through
// vm with its single export rewritten into a global assignment (see
// tests/chat-panel-navigation for the same harness and why).

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const Handlebars = require('handlebars')

const ROOT = path.join(__dirname, '..', '..')
const TOOLS = path.join(ROOT, 'src/js/react/agentTools.js')

function loadTool (metas) {
  const source = fs.readFileSync(TOOLS, 'utf8')
  const rewritten = source.replace(/^export const agentTools =/m, 'globalThis.agentTools =')
  assert.notEqual(rewritten, source, 'the agentTools export shape changed; update this harness')
  const querySelector = (sel) => {
    const m = sel.match(/^meta\[name="([^"]+)"\]$/)
    if (m) return m[1] in metas ? { content: metas[m[1]] } : null
    return null
  }
  const context = {
    console,
    URL,
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    window: {
      location: { origin: 'https://docs.redpanda.com', href: 'https://docs.redpanda.com/' },
      addEventListener: () => {},
    },
    document: {
      querySelector,
      querySelectorAll: () => [],
      addEventListener: () => {},
      body: { getAttribute: () => 'streaming' },
    },
  }
  context.globalThis = context
  vm.runInNewContext(rewritten, context)
  return context.agentTools.find((t) => t.name === 'get_latest_version')
}

const ALL = {
  'latest-redpanda-version': '26.2',
  'latest-redpanda-release': 'v26.2.4',
  'latest-console-release': 'v3.3.1',
  'latest-connect-release': '4.114.0',
  'latest-operator-release': 'v26.2.1',
  'latest-helm-chart-release': '26.2.1',
}

test('returns every release, without a leading v, and no note', async () => {
  const result = await loadTool(ALL).execute()
  assert.equal(result.latestRedpandaStreamingVersion, '26.2')
  assert.equal(result.latestRedpandaStreamingPatchRelease, '26.2.4')
  assert.equal(result.latestConsoleRelease, '3.3.1')
  assert.equal(result.latestConnectRelease, '4.114.0')
  assert.equal(result.latestOperatorRelease, '26.2.1')
  assert.equal(result.latestHelmChartRelease, '26.2.1')
  assert.equal(result.note, undefined)
})

test('a missing release is null, not a guess', async () => {
  const result = await loadTool({ 'latest-redpanda-version': '26.2' }).execute()
  assert.equal(result.latestConsoleRelease, null)
  assert.equal(result.latestConnectRelease, null)
  assert.equal(result.latestOperatorRelease, null)
  assert.equal(result.latestHelmChartRelease, null)
})

test('a missing patch release sets a note naming the docs version only', async () => {
  const metas = { ...ALL }
  delete metas['latest-redpanda-release']
  const result = await loadTool(metas).execute()
  assert.equal(result.latestRedpandaStreamingPatchRelease, null)
  assert.match(result.note || '', /Patch release not available/)
  assert.match(result.note, /\(26\.2\)/)
  assert.match(result.note, /Do not guess a patch number/)
})

test('a page with no Redpanda version keeps the original note', async () => {
  const result = await loadTool({}).execute()
  assert.equal(result.latestRedpandaStreamingVersion, null)
  assert.equal(result.note, 'Latest Redpanda version is not published on this page.')
})

test('the description rules out Cloud before it lists products, and says the two Streaming versions can differ', () => {
  const { description } = loadTool(ALL)
  const cloud = description.indexOf('Not for Redpanda Cloud')
  const products = description.indexOf('Redpanda Console')
  assert.ok(cloud >= 0, 'the description excludes Redpanda Cloud')
  assert.ok(cloud < products, 'the Cloud exclusion comes before the product list')
  assert.match(description, /can differ/)
  assert.match(description, /do not guess/i)
})

// head-meta.hbs: the release block, rendered with real Handlebars.
const HEAD_META = fs.readFileSync(path.join(ROOT, 'src/partials/head-meta.hbs'), 'utf8')
const FROM = '{{#with this.latest.asciidoc.attributes}}'
const start = HEAD_META.indexOf(FROM)
const end = HEAD_META.indexOf('{{/with}}', start)
assert.ok(start >= 0 && end > start, 'head-meta.hbs changed under this test: release block not found')
const RELEASES = Handlebars.create().compile(HEAD_META.slice(start, end + '{{/with}}'.length))

test('head-meta writes one meta per release attribute and skips empty ones', () => {
  const html = RELEASES({
    latest: {
      asciidoc: {
        attributes: {
          'latest-redpanda-tag': 'v26.2.4',
          'latest-console-version': 'v3.3.1',
          'latest-connect-version': '4.100.0',
          'latest-operator-version': 'v26.2.1',
          'latest-redpanda-helm-chart-version': '',
        },
      },
    },
    site: {
      components: {
        connect: { latest: { asciidoc: { attributes: { 'latest-connect-version': '4.114.0' } } } },
      },
    },
  })
  assert.match(html, /<meta name="latest-redpanda-release" content="v26\.2\.4">/)
  assert.match(html, /<meta name="latest-console-release" content="v3\.3\.1">/)
  assert.match(html, /<meta name="latest-connect-release" content="4\.114\.0">/)
  assert.match(html, /<meta name="latest-operator-release" content="v26\.2\.1">/)
  assert.doesNotMatch(html, /latest-helm-chart-release/)
})

test('head-meta omits the Connect release when the latest Connect attribute is absent or empty', () => {
  for (const connect of [undefined, { latest: { asciidoc: { attributes: {} } } }, { latest: { asciidoc: { attributes: { 'latest-connect-version': '' } } } }]) {
    const html = RELEASES({
      latest: { asciidoc: { attributes: { 'latest-connect-version': '4.100.0' } } },
      site: { components: { connect } },
    })
    assert.doesNotMatch(html, /latest-connect-release/)
  }
})
