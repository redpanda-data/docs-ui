'use strict'

// Verifies src/partials/head-meta.hbs resolves the property-tooltip dataset
// URL correctly, against the REAL Handlebars helpers this repo ships
// (or.js, and.js, eq.js, concat.js, resolve-resource.js) -- not stand-ins.
//
// The bug this guards: extensions/version-fetcher/set-latest-version.js writes
// latest-redpanda-tag onto every component's `latest`, by design, so every page
// site-wide has that attribute -- not only streaming's. head-meta.hbs's second
// branch used the attribute's mere presence as a proxy for "this page belongs
// to streaming", so it fired for ANY component and hardcoded
// component='streaming' while building its fallback URL from THAT page's own
// (possibly empty) version. Confirmed live: the docs-site home page served
//   https://docs.redpanda.com/streaming//reference/_attachments/...
// a malformed double-slash URL, the moment the tag started resolving correctly
// instead of falling back to a stale antora.yml-committed value.

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
const BLOCK = HEAD_META_SRC.slice(
  HEAD_META_SRC.indexOf('{{#if page.componentVersion.asciidoc.attributes.available-properties-tag}}'),
  HEAD_META_SRC.indexOf('{{!--\n  Component-local property pages base')
)
const TEMPLATE = Handlebars.compile(BLOCK)

// A catalog shaped like a real one: streaming's own attachment exists only for
// the tag its own data actually carries (v26.1.12), not the newer tag
// version-fetcher just resolved (v26.2.1) -- the real-world race between a
// freshly tagged release and its property JSON being regenerated.
function catalogWith (streamingVersion) {
  return {
    getComponent: (name) => (name === 'streaming' ? { name, latest: streamingVersion } : undefined),
    resolveResource: (spec, ctx) => {
      if (ctx.component === 'streaming' && spec === `attachment$redpanda-properties-${streamingVersion.tag}.json`) {
        return { pub: { url: `/streaming/current/reference/_attachments/redpanda-properties-${streamingVersion.tag}.json` } }
      }
      return undefined
    },
  }
}

function render (page, streamingVersion) {
  const site = { components: { streaming: { latest: streamingVersion }, ROOT: { latest: { version: '' } } } }
  const data = { root: { page, contentCatalog: catalogWith(streamingVersion) } }
  return TEMPLATE({ page, site }, { data })
}

test('a non-streaming page does not get a malformed fallback URL', () => {
  const streamingVersion = { version: '26.1', tag: 'v26.1.12', asciidoc: { attributes: {} } }
  // The home page: unversioned, and carries latest-redpanda-tag because
  // set-latest-version writes it onto every component's latest -- not because
  // this page belongs to streaming.
  const home = {
    version: '',
    component: { name: 'home' },
    componentVersion: { asciidoc: { attributes: { 'latest-redpanda-tag': 'v26.2.1' } } },
  }
  const html = render(home, streamingVersion)
  assert.ok(!html.includes('streaming//'), `expected no double-slash fallback, got: ${html}`)
})

test('a genuine streaming page still resolves its own dataset', () => {
  const streamingVersion = { version: '26.1', tag: 'v26.1.12', asciidoc: { attributes: {} } }
  const streamingPage = {
    version: '26.1',
    component: { name: 'streaming' },
    componentVersion: { asciidoc: { attributes: { 'latest-redpanda-tag': 'v26.1.12' } } },
  }
  const html = render(streamingPage, streamingVersion)
  assert.match(html, /content="\/streaming\/current\/reference\/_attachments\/redpanda-properties-v26\.1\.12\.json"/)
})

test('reproduces the exact live defect when the guard is removed', () => {
  // Pins the failure this fix targets: without the component check, the
  // second branch's own condition (mere presence of the attribute) is true for
  // the home page, and its fallback is built from the home page's own version.
  const unguarded = BLOCK.replace(
    "{{else if (and (eq page.component.name 'streaming') page.componentVersion.asciidoc.attributes.latest-redpanda-tag)}}",
    '{{else if page.componentVersion.asciidoc.attributes.latest-redpanda-tag}}'
  )
  assert.notStrictEqual(unguarded, BLOCK, 'the guard text was not found -- template changed under this test')
  const template = Handlebars.compile(unguarded)
  const streamingVersion = { version: '26.1', tag: 'v26.1.12', asciidoc: { attributes: {} } }
  const home = {
    version: '',
    component: { name: 'home' },
    componentVersion: { asciidoc: { attributes: { 'latest-redpanda-tag': 'v26.2.1' } } },
  }
  const site = { components: { streaming: { latest: streamingVersion }, ROOT: { latest: { version: '' } } } }
  const data = { root: { page: home, contentCatalog: catalogWith(streamingVersion) } }
  const html = template({ page: home, site }, { data })
  assert.ok(html.includes('streaming//'), 'expected the unguarded template to reproduce the double slash')
})
