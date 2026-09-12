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
  for (const h of ['or', 'and', 'eq', 'not', 'increment', 'nav-contains-current']) {
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
    assert.match(html, /<div class="nav-bucket-content" id="nav-bucket-connect">\s*<ul class="nav-list">/, `${flag}: tree rendered directly`)
    assert.doesNotMatch(html, /nav-bucket-content[^>]*>\s*<template/, `${flag}: the bucket itself is not templated`)
    assert.doesNotMatch(html, /is-collapsed/)
    // Inside an open bucket, nav-tree.hbs still defers collapsed sub-items
    // (Guides has children and is not on the current path).
    assert.equal((html.match(/<template data-nav-lazy>/g) || []).length, 1)
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
  // Parent bucket, nested child bucket, and the Guides sub-item inside it.
  assert.equal((collapsed.match(/<template data-nav-lazy>/g) || []).length, 3, 'parent and nested child are both templated')
  assert.match(collapsed, /id="nav-bucket-data-platform">\s*<template data-nav-lazy>[\s\S]*data-bucket="connect"/, 'the child bucket is inside the parent template')

  const expanded = renderBucket({ ...parent, hasCurrentChild: true, children: [{ ...parent.children[0], isCurrentBucket: true }] }, umbrella)
  assert.doesNotMatch(expanded, /nav-bucket-content[^>]*>\s*<template/, 'neither bucket is templated')
  assert.equal((expanded.match(/<template data-nav-lazy>/g) || []).length, 1, 'only the collapsed Guides sub-item inside Connect')
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

// --- nav-tree.hbs: collapsed items inside an open bucket ---

function renderTree (navigation, pageUrl) {
  const hb = Handlebars.create()
  hb.registerPartial('nav-tree', fs.readFileSync(path.join(PARTIALS, 'nav-tree.hbs'), 'utf8'))
  for (const h of ['or', 'eq', 'increment', 'nav-contains-current']) {
    hb.registerHelper(h, require(path.join(ROOT, 'src/helpers', `${h}.js`)))
  }
  hb.registerHelper('relativize', (u) => u)
  for (const h of ['is-beta-feature', 'is-preview-feature', 'is-limited-availability-feature', 'is-byoc-feature', 'is-cloud-feature']) {
    hb.registerHelper(h, () => false)
  }
  return hb.compile('{{> nav-tree navigation=navigation}}')({ navigation, page: { url: pageUrl } })
}

const tree = [
  { content: 'Get Started', url: '/s/get-started/', urlType: 'internal', items: [
    { content: 'Quickstarts', url: '/s/quick/', urlType: 'internal', items: [{ content: 'Docker', url: '/s/quick/docker/', urlType: 'internal' }] },
    { content: 'Licensing', url: '/s/license/', urlType: 'internal' },
  ] },
  { content: 'Develop', url: '/s/develop/', urlType: 'internal', items: [{ content: 'Produce', url: '/s/develop/produce/', urlType: 'internal' }] },
]

test('only the path to the current page renders open; every other subtree is a template', () => {
  const html = renderTree(tree, '/s/quick/docker/')
  // Get Started -> Quickstarts -> Docker is the current path: rendered directly.
  assert.match(html, /href="\/s\/quick\/docker\/"/)
  const docker = html.indexOf('href="/s/quick/docker/"')
  assert.equal(html.lastIndexOf('<template', docker), -1, 'no template opens before the current page link')
  // Licensing is a sibling leaf: rendered (leaves have no subtree to defer).
  assert.match(html, /href="\/s\/license\/"/)
  // Develop is off the current path: its children are templated.
  const develop = html.indexOf('href="/s/develop/"')
  const produce = html.indexOf('href="/s/develop/produce/"')
  assert.ok(develop > 0 && produce > develop)
  assert.ok(html.slice(develop, produce).includes('<template data-nav-lazy>'), 'Develop subtree waits in a template')
  assert.equal((html.match(/<template data-nav-lazy>/g) || []).length, 1)
})

test('the current page keeps its own children open', () => {
  const html = renderTree(tree, '/s/quick/')
  const quick = html.indexOf('href="/s/quick/"')
  const docker = html.indexOf('href="/s/quick/docker/"')
  assert.ok(!html.slice(quick, docker).includes('<template'), 'children of the current page render directly')
})

test('a page outside the tree templates every subtree, and the toggle chevron stays', () => {
  const html = renderTree(tree, '/elsewhere/')
  // Get Started, Develop, and Quickstarts nested inside Get Started's template:
  // inner templates stay inert until their own expand.
  assert.equal((html.match(/<template data-nav-lazy>/g) || []).length, 3)
  assert.equal((html.match(/nav-item-toggle/g) || []).length, 3, 'all three expandable items keep their toggle')
})

test('nav-contains-current walks nested items and tolerates gaps', () => {
  const contains = require(path.join(ROOT, 'src/helpers/nav-contains-current.js'))
  assert.equal(contains(tree, '/s/quick/docker/'), true)
  assert.equal(contains(tree, '/s/develop/produce/'), true)
  assert.equal(contains(tree, '/nope/'), false)
  assert.equal(contains([], '/s/quick/'), false)
  assert.equal(contains(tree, undefined), false)
  assert.equal(contains([null, { items: null }], '/x/'), false)
})

test('01-nav.js hydrates an item before toggling it open, by click and by keyboard', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/js/01-nav.js'), 'utf8')
  assert.match(src, /function hydrateNavItem \(li\)/)
  assert.match(src, /hydrateNavItem\(this\)\s*\n\s*this\.classList\.toggle\('is-active'\)/)
  assert.match(src, /hydrateNavItem\(element\)\s*\n\s*element\.classList\.toggle\('is-active'\)/)
})
