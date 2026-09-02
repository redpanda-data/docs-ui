'use strict'

// Guards the version picker's "keep me on the same page" behaviour, against the REAL
// helpers and the REAL partial this repo ships.
//
// The regression these tests pin: the sidebar picker in bucket-header.hbs rendered
// bucket.versions[].url straight into the href. That url is componentVersion.url -- the
// target version's START page -- so switching version always abandoned the page the reader
// was on. Antora already computes the equivalent-page url per version in page.versions[]
// (following aliases in both directions, and flagging missing:true when the page really is
// absent); src/helpers/resolve-bucket-versions.js reuses that, then falls back to the
// content catalog. The sibling picker in version-selector.hbs always used page.versions but
// silently dropped the missing:true distinction, so a fallback looked like a hit.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Handlebars = require('handlebars')

const ROOT = path.join(__dirname, '..', '..')
const resolveBucketVersions = require(path.join(ROOT, 'src/helpers/resolve-bucket-versions.js'))

Handlebars.registerHelper('relativize', require(path.join(ROOT, 'src/helpers/relativize.js')))
Handlebars.registerHelper('resolve-bucket-versions', resolveBucketVersions)

// Slice the version-selector block out of the real partial.
const BUCKET_HEADER_SRC = fs.readFileSync(path.join(ROOT, 'src/partials/bucket-header.hbs'), 'utf8')
const OPEN = '{{#with (resolve-bucket-versions bucket) as |vers|}}'
const startIdx = BUCKET_HEADER_SRC.indexOf(OPEN)
assert.ok(startIdx > -1, 'bucket-header.hbs must hoist resolve-bucket-versions through #with')
const endIdx = BUCKET_HEADER_SRC.indexOf('{{/with}}', startIdx)
assert.ok(endIdx > -1, 'the #with block must be closed')
const PICKER = Handlebars.compile(BUCKET_HEADER_SRC.slice(startIdx, endIdx + '{{/with}}'.length))

const PAGE_URL = '/streaming/24.3/manage/cluster-maintenance/'

// A page deep inside the streaming component: present in 26.2, absent from 25.1.
function streamingPage () {
  return {
    component: { name: 'streaming' },
    version: '24.3',
    module: 'ROOT',
    relativeSrcPath: 'manage/cluster-maintenance.adoc',
    url: PAGE_URL,
    versions: [
      { version: '26.2', displayVersion: '26.2', url: '/streaming/26.2/manage/cluster-maintenance/' },
      { version: '25.1', displayVersion: '25.1', url: '/streaming/25.1/home/', missing: true },
      { version: '24.3', displayVersion: '24.3', url: PAGE_URL },
    ],
  }
}

// Shaped like extensions/unified-navigation.js builds it: every url is a start page.
function streamingBucket () {
  return {
    componentName: 'streaming',
    currentVersion: '24.3',
    versions: [
      { version: '26.2', displayVersion: '26.2', url: '/streaming/26.2/home/', isEol: false },
      { version: '25.1', displayVersion: '25.1', url: '/streaming/25.1/home/', isEol: false },
      { version: '24.3', displayVersion: '24.3', url: '/streaming/24.3/home/', isEol: true },
    ],
  }
}

function manyVersions (n) {
  return {
    componentName: 'streaming',
    currentVersion: 'v0',
    versions: Array.from({ length: n }, (_, i) => ({
      version: 'v' + i,
      displayVersion: 'v' + i,
      url: '/streaming/v' + i + '/home/',
    })),
  }
}

function render (bucket, page, contentCatalog) {
  return PICKER({ bucket }, { data: { root: { page, contentCatalog, site: { path: '' } } } })
}

// The template relativizes every href, exactly as it does in a real build, so resolve each
// one back against the current page to assert on where it actually lands.
function options (html) {
  const rowRx = /<a class="(nav-bucket-version-opt[^"]*)"([\s\S]*?)>([\s\S]*?)<\/a>/g
  return [...html.matchAll(rowRx)].map((m) => {
    const href = (m[2].match(/href="([^"]*)"/) || [])[1]
    return {
      classes: m[1].split(/\s+/),
      href,
      lands: href === undefined ? undefined : new URL(href, 'https://d' + PAGE_URL).pathname,
      title: (m[2].match(/title="([^"]*)"/) || [])[1],
      label: m[3].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    }
  })
}

// --- the fix itself -------------------------------------------------------------------

test('helper points each version at the equivalent page, not the start page', () => {
  const vers = resolveBucketVersions(streamingBucket(), { data: { root: { page: streamingPage() } } })
  assert.equal(vers.all[0].url, '/streaming/26.2/manage/cluster-maintenance/')
  assert.equal(vers.all[0].missing, false)
  // 25.1 genuinely lacks the page, so it keeps the start page and is flagged.
  assert.equal(vers.all[1].url, '/streaming/25.1/home/')
  assert.equal(vers.all[1].missing, true)
  // The current version self-links.
  assert.equal(vers.all[2].url, PAGE_URL)
  assert.equal(vers.all[2].isCurrent, true)
})

test('rendered sidebar options land on the equivalent page', () => {
  const opts = options(render(streamingBucket(), streamingPage()))
  assert.deepEqual(
    opts.map((o) => o.lands),
    ['/streaming/26.2/manage/cluster-maintenance/', '/streaming/25.1/home/', PAGE_URL]
  )
  // The whole point: 26.2 must not be the start page the extension handed us.
  assert.notEqual(opts[0].lands, '/streaming/26.2/home/')
})

test('exactly one option is marked selected, keyed on the raw version', () => {
  const html = render(streamingBucket(), streamingPage())
  const opts = options(html)
  const selected = opts.filter((o) => o.classes.includes('is-selected'))
  assert.equal(selected.length, 1)
  assert.match(selected[0].label, /^v24\.3\b/)
  assert.equal((html.match(/aria-selected="true"/g) || []).length, 1)
  assert.match(html, /<span>v24\.3<\/span>/, 'the button shows the current display version')
})

test('a missing page is marked and explained, not silently redirected', () => {
  const opts = options(render(streamingBucket(), streamingPage()))
  const missing = opts.filter((o) => o.classes.includes('is-missing'))
  assert.equal(missing.length, 1)
  assert.equal(missing[0].label, 'v25.1')
  assert.match(missing[0].title, /^Not available in v25\.1\./)
  // Rows that do exist carry neither the class nor a tooltip.
  for (const o of opts.filter((x) => !x.classes.includes('is-missing'))) {
    assert.equal(o.title, undefined, o.label + ' should have no tooltip')
  }
})

test('EOL badge still renders', () => {
  const html = render(streamingBucket(), streamingPage())
  assert.equal((html.match(/<span class="version-eol">\(EOL\)<\/span>/g) || []).length, 1)
})

// --- catalog fallbacks ----------------------------------------------------------------

test('falls back to the content catalog when Antora reports the page missing', () => {
  const page = streamingPage()
  page.versions[0].missing = true
  page.versions[0].url = '/streaming/26.2/home/'
  const calls = []
  const contentCatalog = {
    getById: (id) => {
      calls.push(id.family + ':' + id.version)
      if (id.family === 'page' && id.version === '26.2') {
        return { pub: { url: '/streaming/26.2/manage/cluster-maintenance/' } }
      }
      return undefined
    },
  }
  const vers = resolveBucketVersions(streamingBucket(), { data: { root: { page, contentCatalog } } })
  assert.equal(vers.all[0].url, '/streaming/26.2/manage/cluster-maintenance/')
  assert.equal(vers.all[0].missing, false)
  assert.ok(calls.includes('page:26.2'), 'expected a page lookup for 26.2, got ' + calls.join(','))
})

test('follows an alias when the page was renamed in the target version', () => {
  const contentCatalog = {
    getById: (id) => {
      if (id.family === 'alias' && id.version === '25.1') {
        return { rel: { pub: { url: '/streaming/25.1/manage/maintenance-mode/' } } }
      }
      return undefined
    },
  }
  const vers = resolveBucketVersions(streamingBucket(), { data: { root: { page: streamingPage(), contentCatalog } } })
  assert.equal(vers.all[1].url, '/streaming/25.1/manage/maintenance-mode/')
  assert.equal(vers.all[1].missing, false)
})

test("another component's bucket keeps its start-page urls and never hits the catalog", () => {
  const calls = []
  const contentCatalog = { getById: (id) => (calls.push(id) && undefined) }
  const bucket = {
    componentName: 'connect',
    currentVersion: '4.5',
    versions: [
      { version: '4.5', displayVersion: '4.5', url: '/connect/4.5/home/' },
      { version: '4.4', displayVersion: '4.4', url: '/connect/4.4/home/' },
    ],
  }
  const vers = resolveBucketVersions(bucket, { data: { root: { page: streamingPage(), contentCatalog } } })
  assert.deepEqual(vers.all.map((v) => v.url), ['/connect/4.5/home/', '/connect/4.4/home/'])
  assert.ok(vers.all.every((v) => v.missing === false))
  assert.deepEqual(calls, [], 'cross-component buckets must not cost catalog lookups')
})

// --- degradation and guards -----------------------------------------------------------

test('renders nothing when there is no version choice to offer', () => {
  const single = {
    componentName: 'streaming',
    currentVersion: '24.3',
    versions: [{ version: '24.3', displayVersion: '24.3', url: '/x/' }],
  }
  const pseudo = { items: [], showNavItemsOnly: true, isCurrentBucket: true }
  for (const bucket of [single, pseudo, {}]) {
    const html = render(bucket, streamingPage())
    assert.ok(!html.includes('data-bucket-version'), 'no picker for ' + JSON.stringify(Object.keys(bucket)))
  }
})

test('survives a missing content catalog, as in the preview build', () => {
  const page = streamingPage()
  delete page.versions
  assert.doesNotThrow(() => render(streamingBucket(), page, undefined))
  const vers = resolveBucketVersions(streamingBucket(), { data: { root: { page } } })
  // Nothing to resolve against, so other versions keep their start pages. The current
  // version still self-links, since that url comes from the page itself.
  assert.deepEqual(vers.all.map((v) => v.url), ['/streaming/26.2/home/', '/streaming/25.1/home/', PAGE_URL])
  // With no Antora verdict available, absence is not asserted.
  assert.ok(vers.all.every((v) => v.missing === false))
})

test('survives no root data at all', () => {
  assert.doesNotThrow(() => resolveBucketVersions(streamingBucket(), {}))
  assert.doesNotThrow(() => resolveBucketVersions(streamingBucket(), { data: {} }))
})

// --- parity with the markup this replaced ---------------------------------------------

test('six or fewer versions render flat, with no older-versions toggle', () => {
  const html = render(manyVersions(6), streamingPage())
  assert.equal(options(html).length, 6)
  assert.ok(!html.includes('nav-bucket-version-older'))
  assert.ok(!html.includes('data-version-toggle'))
})

test('seven or more versions hide the tail behind the toggle', () => {
  const html = render(manyVersions(8), streamingPage())
  assert.equal(options(html).length, 8)
  assert.ok(html.includes('nav-bucket-version-older'))
  assert.match(html, /Show 3 older versions/)
})

// --- the contract src/js/23-nav-bucket.js depends on ----------------------------------

test('every selector the nav-bucket JS queries is still emitted', () => {
  const html = render(manyVersions(8), streamingPage())
  for (const needle of [
    'data-bucket-version',
    'class="nav-bucket-version-btn"',
    'aria-expanded="false"',
    'class="nav-bucket-version-menu" role="listbox" style="display: none;"',
    'nav-bucket-version-opt',
    'class="nav-bucket-version-older" style="display: none;"',
    'data-version-toggle',
    'class="version-toggle-show"',
    'class="version-toggle-hide" style="display: none;"',
  ]) {
    assert.ok(html.includes(needle), 'missing: ' + needle)
  }
  // The toggle needs an svg child for the chevron flip.
  assert.match(html, /data-version-toggle>[\s\S]*?<svg/)
})

// --- the production partial chain -----------------------------------------------------

// bucket-header is never rendered directly: nav-menu-scroll parses custom-navigation and
// hands each entry to nav-bucket-recursive, which invokes bucket-header with bucket=this.
// A partial invocation resets Handlebars' depth stack, so the picker has to work without
// relying on `..` -- this renders the real chain to prove it does, including the inline
// partial resolving inside the #with block.
test('renders correctly through nav-bucket-recursive, as the site does', () => {
  const chain = Handlebars.create()
  const helperDir = path.join(ROOT, 'src/helpers')
  for (const file of fs.readdirSync(helperDir)) {
    if (file.endsWith('.js')) chain.registerHelper(path.basename(file, '.js'), require(path.join(helperDir, file)))
  }
  const partialDir = path.join(ROOT, 'src/partials')
  for (const file of fs.readdirSync(partialDir)) {
    if (file.endsWith('.hbs')) {
      chain.registerPartial(path.basename(file, '.hbs'), fs.readFileSync(path.join(partialDir, file), 'utf8'))
    }
  }

  const page = streamingPage()
  page.attributes = { 'is-umbrella-nav': 'true' }
  const bucket = Object.assign(streamingBucket(), {
    title: 'Streaming',
    icon: 'lightning',
    color: '#f00',
    isCurrentBucket: true,
    componentUrl: '/streaming/24.3/home/',
    items: [
      { content: 'A', url: '/a/', urlType: 'internal' },
      { content: 'B', url: '/b/', items: [{ content: 'B1', url: '/b1/', urlType: 'internal' }] },
    ],
  })

  const template = chain.compile('{{> nav-bucket-recursive bucket=bucket}}')
  const html = template({ bucket, page }, { data: { root: { page, site: { path: '' }, contentCatalog: undefined } } })

  const opts = options(html)
  assert.equal(opts.length, 3, 'all three versions render through the chain')
  assert.equal(opts[0].lands, '/streaming/26.2/manage/cluster-maintenance/')
  assert.deepEqual(opts.filter((o) => o.classes.includes('is-missing')).map((o) => o.label), ['v25.1'])
  assert.equal(opts.filter((o) => o.classes.includes('is-selected')).length, 1)
})
