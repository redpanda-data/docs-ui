/**
 * The unified nav renders every product's full tree on every page (about 2,000
 * links and 7,500 elements on the home page), nearly all of it inside collapsed
 * buckets. nav-bucket-recursive.hbs now puts a collapsed bucket's tree inside an
 * inert <template>, so it is parsed but never enters the document, and
 * 23-nav-bucket.js moves it into place on first expand and tells 01-nav.js to
 * bind the new items. Expanded buckets (current, has-current-child, or
 * expand-by-default) render exactly as before.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const Handlebars = require('handlebars')

const ROOT = path.join(__dirname, '../..')
const PARTIALS = path.join(ROOT, 'src/partials')

function renderBucket (bucket, page = {}) {
  const hb = Handlebars.create()
  for (const name of ['nav-bucket-recursive', 'nav-tree']) {
    hb.registerPartial(name, fs.readFileSync(path.join(PARTIALS, `${name}.hbs`), 'utf8'))
  }
  hb.registerPartial('bucket-header', '<div class="nav-bucket-header">{{bucket.title}}</div>')
  for (const h of ['or', 'and', 'eq', 'not', 'increment']) {
    hb.registerHelper(h, require(path.join(ROOT, 'src/helpers', `${h}.js`)))
  }
  hb.registerHelper('relativize', (u) => u)
  for (const h of ['is-beta-feature', 'is-preview-feature', 'is-limited-availability-feature', 'is-byoc-feature', 'is-cloud-feature']) {
    hb.registerHelper(h, () => false)
  }
  return hb.compile('{{> nav-bucket-recursive bucket=bucket}}')({ bucket, page })
}

const items = [
  { content: 'Overview', url: '/x/overview/', urlType: 'internal' },
  { content: 'Guides', url: '/x/guides/', urlType: 'internal', items: [{ content: 'Deep', url: '/x/deep/', urlType: 'internal' }] },
]

test('a collapsed leaf bucket ships its tree inside an inert <template>', () => {
  const html = renderBucket({ componentName: 'connect', title: 'Connect', items })
  assert.match(html, /<div class="nav-bucket-content is-collapsed" id="nav-bucket-connect">\s*<template data-nav-lazy>/)
  const tpl = html.match(/<template data-nav-lazy>([\s\S]*?)<\/template>/)
  assert.ok(tpl, 'template present')
  assert.match(tpl[1], /href="\/x\/overview\/"/, 'the links are still rendered (parsed, not in the document)')
  assert.equal((html.match(/<ul class="nav-list">/g) || []).length, 2, 'both nested lists live in the template')
  assert.ok(html.indexOf('<ul class="nav-list">') > html.indexOf('<template'), 'no list is rendered outside the template')
})

test('the current bucket renders its tree directly, with no template', () => {
  for (const flag of ['isCurrentBucket', 'isExpandedByDefault']) {
    const html = renderBucket({ componentName: 'connect', title: 'Connect', items, [flag]: true })
    assert.doesNotMatch(html, /<template/, `${flag}: no template`)
    assert.match(html, /<div class="nav-bucket-content" id="nav-bucket-connect">\s*<ul class="nav-list">/)
    assert.doesNotMatch(html, /is-collapsed/)
  }
})

test('a parent bucket on the umbrella page templates its children too, unless one of them is current', () => {
  const parent = {
    componentName: 'data-platform',
    title: 'Data Platform',
    items: [items[0]],
    children: [{ componentName: 'connect', title: 'Connect', items }],
  }
  const umbrella = { attributes: { 'is-umbrella-nav': 'true' } }
  const collapsed = renderBucket(parent, umbrella)
  assert.equal((collapsed.match(/<template data-nav-lazy>/g) || []).length, 2, 'parent and nested child are both templated')
  assert.match(collapsed, /id="nav-bucket-data-platform">\s*<template data-nav-lazy>[\s\S]*data-bucket="connect"/, 'the child bucket is inside the parent template')

  const expanded = renderBucket({ ...parent, hasCurrentChild: true, children: [{ ...parent.children[0], isCurrentBucket: true }] }, umbrella)
  assert.doesNotMatch(expanded, /<template/)
})

test('a trivial bucket (no items, or one childless item) is unchanged: header only', () => {
  const html = renderBucket({ componentName: 'labs', title: 'Labs', items: [items[0]] })
  assert.match(html, /nav-bucket--link-only/)
  assert.doesNotMatch(html, /<template|nav-bucket-content/)
})

// --- 23-nav-bucket.js: hydration ---

// Minimal element stand-ins: just enough of the DOM for hydrate()/toggleBucket().
function fakeContent ({ withTemplate }) {
  const events = []
  const fragment = { id: 'fragment', querySelectorAll: () => [] }
  const tpl = withTemplate ? { tagName: 'TEMPLATE', content: { cloneNode: () => fragment } } : null
  const content = {
    classes: new Set(['nav-bucket-content', 'is-collapsed']),
    children: withTemplate ? [tpl] : [],
    // Like the real DOM: the template is only findable while it is a child.
    querySelector: (sel) => (sel.includes('template[data-nav-lazy]') && content.children.includes(tpl) ? tpl : null),
    querySelectorAll: () => [],
    replaceChild (n, old) { this.children = this.children.map((c) => (c === old ? n : c)) },
    dispatchEvent: (e) => { events.push(e.type); return true },
    classList: {
      contains: (c) => content.classes.has(c),
      toggle: (c, force) => { force ? content.classes.add(c) : content.classes.delete(c) },
    },
  }
  return { content, events, fragment, tpl }
}

function loadBucketScript () {
  const src = fs.readFileSync(path.join(ROOT, 'src/js/23-nav-bucket.js'), 'utf8')
  // The script registers several document listeners per event type (the
  // delegated caret toggle and the click-outside menu closer both listen for
  // click), so fan each dispatch out to all of them.
  const registered = {}
  const context = {
    document: {
      addEventListener: (t, fn) => { (registered[t] = registered[t] || []).push(fn) },
      querySelectorAll: () => [],
    },
    window: { CustomEvent: class { constructor (type, init) { this.type = type; this.bubbles = init && init.bubbles } } },
  }
  vm.runInNewContext(src, context)
  const docListeners = new Proxy({}, { get: (_, t) => (e) => (registered[t] || []).forEach((fn) => fn(e)) })
  docListeners.DOMContentLoaded() // init()
  return { context, docListeners }
}

test('first expand swaps the template for its content and announces nav:hydrated', () => {
  const { context, docListeners } = loadBucketScript()
  const { content, events, fragment, tpl } = fakeContent({ withTemplate: true })
  const caret = { closest: () => ({ querySelector: () => content }) }
  docListeners.click({ target: { closest: (sel) => (sel === '.nav-bucket-caret-btn' ? caret : null) }, preventDefault () {} })
  assert.ok(!content.children.includes(tpl), 'template removed')
  assert.ok(content.children.includes(fragment), 'fragment in its place')
  assert.deepEqual(events, ['nav:hydrated'])
  assert.ok(!content.classes.has('is-collapsed'), 'bucket is open')

  // Collapse and expand again: nothing left to hydrate, no second event.
  docListeners.click({ target: { closest: (sel) => (sel === '.nav-bucket-caret-btn' ? caret : null) }, preventDefault () {} })
  assert.ok(content.classes.has('is-collapsed'))
  docListeners.click({ target: { closest: (sel) => (sel === '.nav-bucket-caret-btn' ? caret : null) }, preventDefault () {} })
  assert.deepEqual(events, ['nav:hydrated'])
  assert.equal(typeof context.window.hydrateNavBucket, 'function')
})

test('expanding a bucket rendered without a template still just toggles it', () => {
  const { docListeners } = loadBucketScript()
  const { content, events } = fakeContent({ withTemplate: false })
  const caret = { closest: () => ({ querySelector: () => content }) }
  docListeners.click({ target: { closest: (sel) => (sel === '.nav-bucket-caret-btn' ? caret : null) }, preventDefault () {} })
  assert.ok(!content.classes.has('is-collapsed'))
  assert.deepEqual(events, [])
})

test('the caret toggle is delegated in the capture phase (01-nav.js stops bubbling at .nav-container)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/js/23-nav-bucket.js'), 'utf8')
  const start = src.indexOf("document.addEventListener('click', function (e) {\n      var caretBtn")
  assert.ok(start > 0, 'delegated caret listener present')
  const end = src.indexOf('}, true)', start)
  assert.ok(end > 0 && src.slice(start, end).includes('toggleBucket(caretBtn)'), 'registered with capture: true')
})

test('01-nav.js binds items in hydrated subtrees and never twice', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/js/01-nav.js'), 'utf8')
  assert.match(src, /navContainer\.addEventListener\('nav:hydrated'/)
  assert.match(src, /function bindNavItems \(root\)/)
  assert.match(src, /element\.dataset\.navBound/)
})
