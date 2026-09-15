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

// Minimal DOM for the binding path in 01-nav.js: nav items, their .item row, a
// direct-child <template data-nav-lazy>, and enough of replaceChild and
// template.content to move a deferred subtree into the document. Handlers are
// kept as a list per type so the test can count them and catch a double bind.
function navEl (tag, attrs = {}, children = []) {
  const classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean))
  const el = {
    tagName: tag.toUpperCase(),
    attrs: Object.assign({}, attrs),
    children: [],
    parentNode: null,
    handlers: {},
    style: {},
    classList: {
      add: (...cs) => cs.forEach((c) => classes.add(c)),
      remove: (...cs) => cs.forEach((c) => classes.delete(c)),
      contains: (c) => classes.has(c),
      toggle: (c) => (classes.has(c) ? (classes.delete(c), false) : (classes.add(c), true)),
    },
    get href () { return el.attrs.href },
    getAttribute: (k) => (k in el.attrs ? el.attrs[k] : null),
    setAttribute (k, v) { el.attrs[k] = String(v) },
    addEventListener (type, fn) { (el.handlers[type] = el.handlers[type] || []).push(fn) },
    getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0 }),
    querySelector: (s) => navFind(el, s)[0] || null,
    querySelectorAll: (s) => navFind(el, s),
    replaceChild (added, removed) {
      const at = el.children.indexOf(removed)
      const incoming = added.isFragment ? added.children : [added]
      el.children.splice(at, 1, ...incoming)
      incoming.forEach((c) => { c.parentNode = el })
      removed.parentNode = null
    },
  }
  children.forEach((child) => { child.parentNode = el; el.children.push(child) })
  return el
}

// Selector support stops where 01-nav.js stops: a tag, classes, and the one
// a[href^="https://"] test. No :scope, deliberately, so a reader of this test
// sees the same constraint tests/nav-scroll imposes.
function navMatches (el, selector) {
  const m = selector.match(/^([a-z]*)((?:\.[\w-]+)*)(?:\[([\w-]+)\^?="?([^"\]]*)"?\])?$/i)
  if (!m) throw new Error('selector not supported by the test DOM: ' + selector)
  const [, tag, classPart, attr, value] = m
  if (tag && el.tagName !== tag.toUpperCase()) return false
  if (!(classPart ? classPart.split('.').filter(Boolean) : []).every((c) => el.classList.contains(c))) return false
  if (!attr) return true
  const actual = el.getAttribute(attr)
  return actual !== null && (selector.includes('^=') ? actual.startsWith(value) : actual === value)
}

function navFind (el, selector, out = []) {
  el.children.forEach((child) => {
    if (navMatches(child, selector)) out.push(child)
    navFind(child, selector, out)
  })
  return out
}

// One nav entry as nav-tree.hbs renders it. deferred adds the inert
// <template data-nav-lazy> that a collapsed item ships its subtree in.
function bindableEntry (href, { deferred = false } = {}) {
  const row = navEl('div', { class: 'item' + (deferred ? ' dropdown' : '') }, [
    navEl('a', { class: 'nav-link', href }),
    ...(deferred ? [navEl('button', { class: 'nav-item-toggle' })] : []),
  ])
  const li = navEl('li', { class: 'nav-item' }, [row])
  if (deferred) {
    const childRow = navEl('div', { class: 'item' }, [navEl('a', { class: 'nav-link', href: href + 'deep/' })])
    const child = navEl('li', { class: 'nav-item' }, [childRow])
    child.row = childRow
    const subtree = navEl('ul', { class: 'nav-list' }, [child])
    const tpl = navEl('template', { 'data-nav-lazy': '' })
    tpl.content = { cloneNode: () => ({ isFragment: true, children: [subtree] }) }
    li.children.push(tpl)
    tpl.parentNode = li
    li.deferred = { tpl, child }
  }
  li.row = row
  return li
}

// Run the IIFE against the stub and hand back the pieces the assertions need.
function runNav (entries) {
  const list = navEl('ul', { class: 'nav-list' }, entries)
  const panel = navEl('div', { class: 'nav-panel-menu', 'data-panel': 'menu' }, [navEl('nav', { class: 'nav-menu' }, [list])])
  const navContainer = navEl('div', { class: 'nav-container' }, [navEl('aside', { class: 'nav sidebar' }, [panel])])
  const root = navEl('body', {}, [navContainer])
  const context = {
    console,
    document: {
      addEventListener () {},
      getElementById: () => null,
      documentElement: navEl('html'),
      querySelector: (s) => root.querySelector(s),
    },
    window: {
      addEventListener () {},
      location: { hash: '', href: 'https://docs.example.com/page/' },
      getComputedStyle: () => ({ overflowY: 'visible' }),
    },
  }
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'src/js/01-nav.js'), 'utf8'), context)
  return { navContainer, panel }
}

const clickCount = (li) => (li.row.handlers.click || []).length

test('01-nav.js binds the items rendered at load, exactly once each', () => {
  const plain = bindableEntry('/x/overview/')
  const dropdown = bindableEntry('/x/guides/', { deferred: true })
  runNav([plain, dropdown])
  assert.equal(clickCount(plain), 1)
  assert.equal(clickCount(dropdown), 1)
  assert.equal(plain.getAttribute('data-nav-bound'), 'true', 'bound items are marked with an attribute, not dataset')
})

test('expanding a collapsed item moves its direct-child template in and binds the new items', () => {
  const dropdown = bindableEntry('/x/guides/', { deferred: true })
  runNav([bindableEntry('/x/overview/'), dropdown])
  const { tpl, child } = dropdown.deferred

  assert.equal(clickCount(child), 0, 'an item inside the template is not in the document yet')
  dropdown.row.querySelector('.nav-item-toggle').handlers.keydown[0]({ keyCode: 13, preventDefault () {} })

  assert.equal(dropdown.children.indexOf(tpl), -1, 'the template is replaced by its content')
  assert.equal(clickCount(child), 1, 'the hydrated item is bound')
  assert.equal(child.getAttribute('data-nav-bound'), 'true')
})

test('a nav:hydrated subtree is bound, and re-binding never doubles a handler', () => {
  const dropdown = bindableEntry('/x/guides/', { deferred: true })
  const { navContainer, panel } = runNav([bindableEntry('/x/overview/'), dropdown])
  dropdown.row.querySelector('.nav-item-toggle').handlers.keydown[0]({ keyCode: 13, preventDefault () {} })
  const { child } = dropdown.deferred

  // 23-nav-bucket.js fires this after swapping a bucket's template in.
  navContainer.handlers['nav:hydrated'].forEach((fn) => fn({ target: panel }))
  navContainer.handlers['nav:hydrated'].forEach((fn) => fn({ target: panel }))

  assert.equal(clickCount(dropdown), 1, 'an already-bound item is skipped')
  assert.equal(clickCount(child), 1)
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
