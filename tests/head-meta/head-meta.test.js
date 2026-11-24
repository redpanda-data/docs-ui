'use strict'

// Verifies src/partials/head-meta.hbs resolves the property-tooltip and
// Connect dataset URLs correctly, against the REAL Handlebars helpers this repo
// ships (or.js, and.js, eq.js, concat.js, resolve-resource.js) -- not stand-ins.
//
// Two live defects pinned here:
//
// 1. extensions/version-fetcher/set-latest-version.js writes latest-redpanda-tag
//    onto every component's `latest`, by design, so every page site-wide has
//    that attribute -- not only streaming's. The second branch once used the
//    attribute's mere presence as a proxy for "this page belongs to streaming",
//    fired for the home page, and built a malformed fallback URL from the home
//    page's empty version (https://docs.redpanda.com/streaming//reference/...).
//
// 2. Every branch carried a hard-coded production fallback URL. A streaming
//    release branch that never generated a properties JSON (24.3, 25.1, 25.2
//    on 2026-10-12) therefore advertised
//    https://docs.redpanda.com/streaming/25.2/reference/_attachments/redpanda-properties-v25.2.1.json,
//    a file that 404s on production too. And the Connect block passed a
//    version= that read as undefined for the versionless connect component, so
//    on every versioned streaming page the lookup inherited the page's version,
//    missed, and sent preview builds to production for a file they carried.
//    The partial now emits a dataset URL only when the catalog resolves it.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Handlebars = require('handlebars')

const ROOT = path.join(__dirname, '..', '..')
const resolveResourceHelper = require(path.join(ROOT, 'src/helpers/resolve-resource.js'))

Handlebars.registerHelper('or', require(path.join(ROOT, 'src/helpers/or.js')))
Handlebars.registerHelper('and', require(path.join(ROOT, 'src/helpers/and.js')))
Handlebars.registerHelper('eq', require(path.join(ROOT, 'src/helpers/eq.js')))
Handlebars.registerHelper('concat', (...args) => args.slice(0, -1).join(''))
Handlebars.registerHelper('resolve-resource', function (resource, opts) {
  return resolveResourceHelper(resource, opts)
})

const HEAD_META_SRC = fs.readFileSync(path.join(ROOT, 'src/partials/head-meta.hbs'), 'utf8')
const slice = (from, to) => {
  const start = HEAD_META_SRC.indexOf(from)
  const end = HEAD_META_SRC.indexOf(to)
  assert.ok(start >= 0 && end > start, `head-meta.hbs changed under this test: could not find ${from} .. ${to}`)
  return HEAD_META_SRC.slice(start, end)
}
const PROPERTIES_BLOCK = slice(
  '{{#if page.componentVersion.asciidoc.attributes.available-properties-tag}}',
  '{{!--\n  Component-local property pages base'
)
const CONNECT_BLOCK = slice(
  '{{#with (or site.components.connect site.components.redpanda-connect)}}',
  '{{!-- Opt-out: page authors can set'
)
const PROPERTIES = Handlebars.compile(PROPERTIES_BLOCK)
const CONNECT = Handlebars.compile(CONNECT_BLOCK)

// A catalog shaped like a real one. Streaming's attachment exists only for the
// tag its own data actually carries (not the newer tag version-fetcher just
// resolved), and only in the version that carries it. Connect is versionless:
// its one attachment lives at version '' and nowhere else, which is exactly
// how Antora's catalog answers (see @antora/content-classifier resolveResource).
function catalogWith ({ streaming, connect } = {}) {
  return {
    getComponent: (name) => {
      if (name === 'streaming' && streaming) return { name, latest: streaming.latest }
      if (name === 'connect' && connect) return { name, latest: { version: '' } }
      return undefined
    },
    resolveResource: (spec, ctx) => {
      if (streaming && ctx.component === 'streaming') {
        const hit = streaming.attachments.find((a) => a.version === ctx.version && spec === `attachment$redpanda-properties-${a.tag}.json`)
        if (hit) return { pub: { url: `/streaming/${hit.segment}/reference/_attachments/redpanda-properties-${hit.tag}.json` } }
      }
      if (connect && ctx.component === 'connect' && ctx.version === '' && spec === `attachment$connect-${connect.version}.json`) {
        return { pub: { url: `/connect/components/_attachments/connect-${connect.version}.json` } }
      }
      return undefined
    },
  }
}

// Streaming as published on 2026-10-12: 26.2 (latest) and 25.3 have a
// generated JSON, 25.2 does not. Tags come from version-fetcher.
const STREAMING = {
  latest: { version: '26.2', tag: 'v26.2.4', asciidoc: { attributes: { 'latest-redpanda-tag': 'v26.2.4', 'available-properties-tag': 'v26.2.4' } } },
  attachments: [
    { version: '26.2', tag: 'v26.2.4', segment: 'current' },
    { version: '25.3', tag: 'v25.3.11', segment: '25.3' },
  ],
}
const CONNECT_DATA = { version: '4.112.0' }

function render (template, page, { streaming = STREAMING, connect = CONNECT_DATA } = {}) {
  const site = {
    components: {
      streaming: { latest: streaming.latest },
      ROOT: { latest: { version: '' } },
      ...(connect ? { connect: { latest: { version: '', asciidoc: { attributes: { 'latest-connect-version': connect.version, 'available-connect-version': connect.version } } } } } : {}),
    },
  }
  const data = { root: { page, contentCatalog: catalogWith({ streaming, connect }) } }
  return template({ page, site }, { data })
}

const streamingPage = (version, attributes) => ({
  version,
  component: { name: 'streaming' },
  componentVersion: { asciidoc: { attributes } },
})

const metas = (html) => Object.fromEntries([...html.matchAll(/<meta name="([^"]+)" content="([^"]*)">/g)].map((m) => [m[1], m[2]]))

test('a streaming version with a generated JSON resolves its own dataset (declared tag)', () => {
  const html = render(PROPERTIES, streamingPage('26.2', { 'latest-redpanda-tag': 'v26.2.4', 'available-properties-tag': 'v26.2.4' }))
  assert.deepEqual(metas(html), {
    'latest-redpanda-tag': 'v26.2.4',
    'properties-json-url': '/streaming/current/reference/_attachments/redpanda-properties-v26.2.4.json',
  })
})

test('a streaming version with a generated JSON resolves it from latest-redpanda-tag alone', () => {
  // No set-available-attachment-versions extension in this build: the second
  // branch still finds the file by the release tag.
  const html = render(PROPERTIES, streamingPage('25.3', { 'latest-redpanda-tag': 'v25.3.11' }))
  assert.deepEqual(metas(html), {
    'latest-redpanda-tag': 'v25.3.11',
    'properties-json-url': '/streaming/25.3/reference/_attachments/redpanda-properties-v25.3.11.json',
  })
})

test('a streaming version with NO generated JSON emits no dataset URL at all', () => {
  // The live defect: 25.2 advertised a production URL that 404ed on production.
  const html = render(PROPERTIES, streamingPage('25.2', { 'latest-redpanda-tag': 'v25.2.1' }))
  assert.deepEqual(metas(html), {}, `expected no meta tags, got: ${html}`)
  assert.ok(!html.includes('docs.redpanda.com'), `expected no production URL, got: ${html}`)
})

test('a non-streaming page does not get a malformed fallback URL, and resolves streaming latest', () => {
  // The home page: unversioned, and carries latest-redpanda-tag because
  // set-latest-version writes it onto every component's latest -- not because
  // this page belongs to streaming.
  const home = {
    version: '',
    component: { name: 'home' },
    componentVersion: { asciidoc: { attributes: { 'latest-redpanda-tag': 'v26.2.4' } } },
  }
  const html = render(PROPERTIES, home)
  assert.ok(!html.includes('streaming//'), `expected no double-slash fallback, got: ${html}`)
  assert.equal(metas(html)['properties-json-url'], '/streaming/current/reference/_attachments/redpanda-properties-v26.2.4.json')
})

test('a non-streaming page emits nothing when streaming latest has no JSON for its tag', () => {
  // The race set-available-attachment-versions exists for: the release is
  // tagged, the JSON is not regenerated yet. Before, this was a production
  // URL to a file that did not exist yet.
  const streaming = {
    latest: { version: '26.3', tag: 'v26.3.1', asciidoc: { attributes: { 'latest-redpanda-tag': 'v26.3.1' } } },
    attachments: [{ version: '26.2', tag: 'v26.2.4', segment: '26.2' }],
  }
  const cloud = { version: '', component: { name: 'cloud-data-platform' }, componentVersion: { asciidoc: { attributes: {} } } }
  const html = render(PROPERTIES, cloud, { streaming })
  assert.deepEqual(metas(html), {}, `expected no meta tags, got: ${html}`)
})

test('the connect dataset resolves to a site-relative URL from a VERSIONED streaming page', () => {
  // The live defect: streaming pages carried
  // https://docs.redpanda.com/connect/components/_attachments/connect-4.112.0.json
  // while cloud and connect pages (version '') carried the relative URL,
  // because the lookup inherited the streaming page's version.
  const html = render(CONNECT, streamingPage('26.2', { 'latest-redpanda-tag': 'v26.2.4' }))
  assert.deepEqual(metas(html), { 'connect-json-url': '/connect/components/_attachments/connect-4.112.0.json' })
})

test('the connect dataset resolves the same way from an unversioned page', () => {
  const cloud = { version: '', component: { name: 'cloud-data-platform' }, componentVersion: { asciidoc: { attributes: {} } } }
  assert.deepEqual(metas(render(CONNECT, cloud)), { 'connect-json-url': '/connect/components/_attachments/connect-4.112.0.json' })
})

test('no connect component in the build means no connect dataset URL', () => {
  const html = render(CONNECT, streamingPage('26.2', { 'latest-redpanda-tag': 'v26.2.4' }), { connect: null })
  assert.deepEqual(metas(html), {})
})

test('the partial never emits a production URL', () => {
  const rendered = PROPERTIES_BLOCK + CONNECT_BLOCK
  // Comments may mention the old URL; emitted markup must not build one.
  const markup = rendered.replace(/\{\{!--[\s\S]*?--\}\}/g, '')
  assert.ok(!markup.includes('https://docs.redpanda.com'), 'a hard-coded production URL is back in head-meta.hbs')
})

test('resolve-resource: an optional miss returns the given fallback, even when empty', () => {
  const page = { component: { name: 'streaming' }, version: '25.2', module: 'reference', src: { path: 'x.adoc' } }
  const contentCatalog = { getComponent: () => undefined, resolveResource: () => undefined }
  const miss = resolveResourceHelper('attachment$redpanda-properties-v0.0.1.json', { data: { root: { page, contentCatalog } }, hash: { module: 'reference', fallback: '' } })
  assert.equal(miss, '', `expected an empty string, got ${JSON.stringify(miss)}`)
  const withFallback = resolveResourceHelper('attachment$redpanda-properties-v0.0.2.json', { data: { root: { page, contentCatalog } }, hash: { module: 'reference', fallback: '/x.json' } })
  assert.equal(withFallback, '/x.json')
})

test('resolve-resource: a cross-component lookup never inherits the page version', () => {
  const page = { component: { name: 'streaming' }, version: '26.2', module: 'reference', src: { path: 'x.adoc' } }
  const seen = []
  const contentCatalog = {
    getComponent: (name) => (name === 'connect' ? { latest: { version: '' } } : undefined),
    resolveResource: (spec, ctx) => { seen.push(ctx); return undefined },
  }
  // Distinct spec from the template tests above: the helper caches resolutions
  // per (spec, context) within a tick, and a cached hit would skip the catalog.
  resolveResourceHelper('attachment$connect-9.9.9.json', { data: { root: { page, contentCatalog } }, hash: { component: 'connect', module: 'components', fallback: '' } })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].component, 'connect')
  assert.equal(seen[0].version, '', `expected the target component's latest version, got ${JSON.stringify(seen[0].version)}`)
  // Same-component lookups still default to the page's own version.
  seen.length = 0
  resolveResourceHelper('attachment$redpanda-properties-v9.9.9.json', { data: { root: { page, contentCatalog } }, hash: { module: 'reference', fallback: '' } })
  assert.equal(seen[0].version, '26.2')
})

// rpk JSON for the rpkcmd: tooltips. The docs rpk workflows publish one
// rpk-<tag>.json per streaming branch, in reference/attachments, and the tag is
// chosen as the properties tag is: available-rpk-tag first, then the release
// tag of the page's own streaming version, then streaming latest's.
const RPK_BLOCK = slice(
  '{{#if page.componentVersion.asciidoc.attributes.available-rpk-tag}}',
  '{{!-- Opt-outs for the inline macro tooltips'
)
const RPK = Handlebars.compile(RPK_BLOCK)

function renderRpk (page, { latest, attachments }) {
  const site = { components: { streaming: { latest }, ROOT: { latest: { version: '' } } } }
  const contentCatalog = {
    getComponent: (name) => (name === 'streaming' ? { name, latest } : undefined),
    resolveResource: (spec, ctx) => {
      if (ctx.component !== 'streaming' || ctx.module !== 'reference') return undefined
      const hit = attachments.find((a) => a.version === ctx.version && spec === `attachment$rpk-${a.tag}.json`)
      return hit ? { pub: { url: `/streaming/${hit.segment}/reference/_attachments/rpk-${hit.tag}.json` } } : undefined
    },
  }
  return RPK({ page, site }, { data: { root: { page, contentCatalog } } })
}

const RPK_STREAMING = {
  latest: { version: '26.2', asciidoc: { attributes: { 'latest-redpanda-tag': 'v26.2.2' } } },
  attachments: [
    { version: '26.2', tag: 'v26.2.2', segment: 'current' },
    { version: '26.1', tag: 'v26.1.12', segment: '26.1' },
  ],
}

test('rpk: a streaming page resolves its own version\'s rpk JSON from latest-redpanda-tag', () => {
  // Distinct versions per test: resolve-resource caches within a tick.
  const html = renderRpk(streamingPage('26.1', { 'latest-redpanda-tag': 'v26.1.12' }), RPK_STREAMING)
  assert.deepEqual(metas(html), { 'rpk-json-url': '/streaming/26.1/reference/_attachments/rpk-v26.1.12.json' })
})

test('rpk: available-rpk-tag wins over a release tag the snapshot has not caught up with', () => {
  const streaming = {
    latest: RPK_STREAMING.latest,
    attachments: [{ version: '26.3', tag: 'v26.3.1', segment: '26.3' }],
  }
  const html = renderRpk(streamingPage('26.3', { 'latest-redpanda-tag': 'v26.3.4', 'available-rpk-tag': 'v26.3.1' }), streaming)
  assert.deepEqual(metas(html), { 'rpk-json-url': '/streaming/26.3/reference/_attachments/rpk-v26.3.1.json' })
})

test('rpk: a non-streaming page resolves streaming latest\'s rpk JSON', () => {
  const cloud = { version: '', component: { name: 'cloud-data-platform' }, componentVersion: { asciidoc: { attributes: {} } } }
  assert.deepEqual(metas(renderRpk(cloud, RPK_STREAMING)), { 'rpk-json-url': '/streaming/current/reference/_attachments/rpk-v26.2.2.json' })
})

test('rpk: a version with no published rpk JSON emits nothing', () => {
  const html = renderRpk(streamingPage('25.3', { 'latest-redpanda-tag': 'v25.3.11' }), RPK_STREAMING)
  assert.deepEqual(metas(html), {}, `expected no meta tags, got: ${html}`)
  const markup = RPK_BLOCK.replace(/\{\{!--[\s\S]*?--\}\}/g, '')
  assert.ok(!markup.includes('https://docs.redpanda.com'), 'a hard-coded production URL is in the rpk block')
})

test('the macro tooltip off switches become meta tags', () => {
  const block = slice('{{!-- Opt-outs for the inline macro tooltips', '<meta itemprop="datePublished"')
  const template = Handlebars.compile(block)
  for (const family of ['bloblang', 'connect', 'rpk']) {
    const page = { attributes: { [`disable-${family}-tooltips`]: 'true' } }
    assert.deepEqual(metas(template({ page })), { [`disable-${family}-tooltips`]: 'true' })
  }
  assert.deepEqual(metas(template({ page: { attributes: {} } })), {})
})
