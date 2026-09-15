/**
 * Left nav: bringing the current page's entry into view must scroll only the sidebar.
 *
 * Element.scrollIntoView scrolls every scrollable ancestor, the window included. When the stylesheet
 * is not cached yet, site.js runs before the browser has jumped to the URL fragment, and Chrome drops
 * that pending jump the moment a script scrolls, so a reader following a #anchor link landed at the
 * top of the page (DOC-2513). Setting the sidebar scroller's own scrollTop reaches the same place
 * without touching the window, on load and again when the hash changes.
 *
 * The scroller is the nearest self-or-ancestor with overflow-y auto or scroll: div.sb-scroll in
 * nav.hbs and labs-home.hbs, which wraps the menu panel. When nothing in that chain scrolls there is
 * no scroller to write to, and the sidebar is left alone: div.nav-panel-menu carries no overflow rule
 * in any stylesheet, so setting scrollTop on it would do nothing while looking like it worked.
 *
 * The three places that move the sidebar all go through the same lookup: centering the current entry,
 * resetting to the top when there is no current entry, and keeping a freshly expanded dropdown in
 * view. Only the animation differs, and only on purpose: the load-time scroll is instant so it cannot
 * race the browser's fragment jump, while a hashchange the reader triggered keeps the smooth scroll.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SCRIPT = path.join(__dirname, '../../src/js/01-nav.js')

const SCROLLER_TOP = 120 // where the sidebar scroller sits in the viewport
const SCROLLER_HEIGHT = 600
const LINK_HEIGHT = 40

// Minimal DOM: enough of querySelector, classList and geometry for the nav tree in nav.hbs,
// nav-menu-scroll.hbs and nav-tree.hbs. Selectors are tag, classes and one [attr=value] or
// [attr^=value] test.
function matches (el, selector) {
  const m = selector.match(/^([a-z]*)((?:\.[\w-]+)*)(?:\[([\w-]+)(\^?=)"?([^"\]]*)"?\])?$/i)
  if (!m) throw new Error('selector not supported by the test DOM: ' + selector)
  const [, tag, classPart, attr, op, value] = m
  if (tag && el.tagName !== tag.toUpperCase()) return false
  const classes = classPart ? classPart.split('.').filter(Boolean) : []
  if (!classes.every((c) => el.classList.contains(c))) return false
  if (!attr) return true
  const actual = el.getAttribute(attr)
  if (actual === null) return false
  return op === '^=' ? actual.startsWith(value) : actual === value
}

function collect (el, selector, out) {
  el.children.forEach((child) => {
    if (matches(child, selector)) out.push(child)
    collect(child, selector, out)
  })
  return out
}

function makeEl (tag, attrs = {}, children = []) {
  const classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean))
  const el = {
    tagName: tag.toUpperCase(),
    attrs: Object.assign({}, attrs),
    children: [],
    parentNode: null,
    handlers: {},
    style: {},
    computedStyle: { overflowY: 'visible' },
    scrollTop: 0,
    classList: {
      add: (...cs) => cs.forEach((c) => classes.add(c)),
      remove: (...cs) => cs.forEach((c) => classes.delete(c)),
      contains: (c) => classes.has(c),
      toggle (c, force) {
        const on = force === undefined ? !classes.has(c) : force
        if (on) classes.add(c)
        else classes.delete(c)
        return on
      },
    },
    get className () { return [...classes].join(' ') },
    get id () { return el.attrs.id || '' },
    get href () { return el.attrs.href },
    get firstElementChild () { return el.children[0] || null },
    get nextElementSibling () {
      if (!el.parentNode) return null
      const siblings = el.parentNode.children
      return siblings[siblings.indexOf(el) + 1] || null
    },
    getAttribute (k) { return k in el.attrs ? el.attrs[k] : null },
    setAttribute (k, v) { el.attrs[k] = String(v) },
    addEventListener (type, fn) { el.handlers[type] = fn },
    matches: (selector) => matches(el, selector),
    querySelector: (selector) => collect(el, selector, [])[0] || null,
    querySelectorAll: (selector) => collect(el, selector, []),
    getBoundingClientRect: () => ({ top: 0, bottom: 0, height: 0 }),
  }
  children.forEach((child) => {
    child.parentNode = el
    el.children.push(child)
  })
  return el
}

// A box that scrolls its content: geometry fixed in the viewport, content moving with scrollTop.
// scrollTo records the animated writes so a test can tell a smooth scroll from an instant one.
function makeScroller (el) {
  el.computedStyle = { overflowY: 'auto' }
  el.clientHeight = SCROLLER_HEIGHT
  el.scrollToCalls = []
  el.scrollTo = (options) => {
    el.scrollToCalls.push(options)
    el.scrollTop = options.top
  }
  el.getBoundingClientRect = () => ({
    top: SCROLLER_TOP,
    bottom: SCROLLER_TOP + SCROLLER_HEIGHT,
    height: SCROLLER_HEIGHT,
  })
  return el
}

// One nav entry as nav-tree.hbs renders it: <li class="nav-item"><div class="item"><a class="nav-link">.
// layoutTop is the entry's offset from the top of the scrolled content, so its viewport position
// follows the scroller's scrollTop the way a real layout would. childCount > 0 makes it a dropdown:
// div.item picks up the dropdown class and the <li> grows when it opens, as the expanded <ul> does.
function navEntry ({ href, current = false, layoutTop, childCount = 0 }, getScroller, scrollIntoViewCalls) {
  const scrollTopOf = () => { const s = getScroller(); return s ? s.scrollTop : 0 }
  const link = makeEl('a', { class: 'nav-link', href })
  link.offsetHeight = LINK_HEIGHT
  link.getBoundingClientRect = () => {
    const top = SCROLLER_TOP + layoutTop - scrollTopOf()
    return { top, bottom: top + LINK_HEIGHT, height: LINK_HEIGHT }
  }
  link.scrollIntoView = (options) => scrollIntoViewCalls.push({ href, options })
  const item = makeEl('div', {
    class: 'item' + (current ? ' is-current-page' : '') + (childCount ? ' dropdown' : ''),
  }, [link])
  const childItems = []
  for (let i = 0; i < childCount; i += 1) {
    const childLink = makeEl('a', { class: 'nav-link', href: href + 'child-' + i + '/' })
    childItems.push(makeEl('li', { class: 'nav-item', 'data-depth': '1' },
      [makeEl('div', { class: 'item' }, [childLink])]))
  }
  const entry = makeEl('li', { class: 'nav-item', 'data-depth': '0' },
    childCount ? [item, makeEl('ul', { class: 'nav-list' }, childItems)] : [item])
  entry.getBoundingClientRect = () => {
    const height = LINK_HEIGHT * (1 + (entry.classList.contains('is-active') ? childCount : 0))
    const top = SCROLLER_TOP + layoutTop - scrollTopOf()
    return { top, bottom: top + height, height }
  }
  entry.item = item
  return entry
}

// Drive the IIFE against the stub DOM. entries describe the nav tree; hash is window.location.hash on
// load; scrollerTop is where the sidebar already sits before the script runs. By default div.sb-scroll
// wraps the menu panel and is the scroller, as in nav.hbs. panelScrolls moves overflow-y onto the
// panel itself with no wrapper, and scrollerless gives the chain no scroll box at all.
function run ({ entries, hash = '', scrollerTop = 0, panelScrolls = false, scrollerless = false }) {
  const scrollIntoViewCalls = []
  let scroller = null
  const items = entries.map((entry) => navEntry(entry, () => scroller, scrollIntoViewCalls))
  const list = makeEl('ul', { class: 'nav-list' }, items)
  const menu = makeEl('nav', { class: 'nav-menu' }, [list])
  const panel = makeEl('div', { class: 'nav-panel-menu is-active', 'data-panel': 'menu' }, [menu])
  let sidebarChild = panel
  if (panelScrolls) {
    scroller = makeScroller(panel)
  } else if (!scrollerless) {
    scroller = makeScroller(makeEl('div', { class: 'sb-scroll' }, [panel]))
    sidebarChild = scroller
  } else {
    // No .sb-scroll wrapper and no overflow anywhere: the sidebar has no scroll box.
    sidebarChild = makeEl('div', {}, [panel])
  }
  if (scroller) scroller.scrollTop = scrollerTop
  const sidebar = makeEl('aside', { class: 'nav sidebar' }, [sidebarChild])
  const navContainer = makeEl('div', { class: 'nav-container' }, [sidebar])
  const root = makeEl('body', {}, [navContainer])

  const listeners = {}
  const context = {
    console,
    document: {
      addEventListener () {},
      getElementById: () => null,
      documentElement: makeEl('html'),
      querySelector: (selector) => root.querySelector(selector),
    },
    window: {
      addEventListener: (type, fn) => { listeners[type] = fn },
      location: { hash, href: 'https://docs.example.com/page/' },
      getComputedStyle: (el) => el.computedStyle,
    },
  }
  vm.runInNewContext(fs.readFileSync(SCRIPT, 'utf8'), context)
  return { scroller, panel, items, listeners, scrollIntoViewCalls, win: context.window }
}

const CURRENT_TOP = 1000
const OTHER_TOP = 2000
// The scroller moves so the entry's middle sits at the scroller's middle.
const centeredOn = (layoutTop) => layoutTop - SCROLLER_HEIGHT / 2 + LINK_HEIGHT / 2
const CURRENT_PAGE_NAV = [
  { href: 'other/', layoutTop: 0 },
  { href: 'page/', current: true, layoutTop: CURRENT_TOP },
]

test('bringing the current page entry into view on load never calls scrollIntoView', () => {
  const { scrollIntoViewCalls } = run({ entries: CURRENT_PAGE_NAV })
  assert.deepEqual(scrollIntoViewCalls, [], 'scrollIntoView reaches the window and cancels the pending fragment jump')
})

test('on load the sidebar scroller moves so the current page entry sits at its midpoint', () => {
  const { scroller, panel } = run({ entries: CURRENT_PAGE_NAV })
  assert.equal(scroller.scrollTop, centeredOn(CURRENT_TOP))
  assert.equal(panel.scrollTop, 0, 'the non-scrolling panel inside the scroller is left alone')
})

test('the load-time scroll is instant, so it cannot animate over the browser fragment jump', () => {
  const { scroller } = run({ entries: CURRENT_PAGE_NAV })
  assert.deepEqual(scroller.scrollToCalls, [], 'a smooth scroll on load is what loses the fragment')
})

test('arriving on a fragment URL still scrolls the sidebar instantly', () => {
  const { scroller } = run({
    entries: [{ href: 'page/', current: true, layoutTop: CURRENT_TOP }, { href: '#section-b', layoutTop: OTHER_TOP }],
    hash: '#section-b',
  })
  // onHashChange also runs synchronously on load, where the pending fragment jump is still at risk.
  assert.deepEqual(scroller.scrollToCalls, [])
  assert.equal(scroller.scrollTop, centeredOn(OTHER_TOP))
})

test('a hash change repositions the scroller on the new entry without scrollIntoView', () => {
  const { scroller, listeners, scrollIntoViewCalls, win } = run({
    entries: [{ href: 'page/', current: true, layoutTop: CURRENT_TOP }, { href: '#section-b', layoutTop: OTHER_TOP }],
  })
  assert.ok(listeners.hashchange, 'the script listens for hash changes when the nav has fragment links')
  win.location.hash = '#section-b'
  listeners.hashchange({ type: 'hashchange' })
  assert.deepEqual(scrollIntoViewCalls, [])
  assert.equal(scroller.scrollTop, centeredOn(OTHER_TOP))
})

test('a hash change the reader triggered keeps the smooth scroll', () => {
  const { scroller, listeners, win } = run({
    entries: [{ href: 'page/', current: true, layoutTop: CURRENT_TOP }, { href: '#section-b', layoutTop: OTHER_TOP }],
  })
  win.location.hash = '#section-b'
  listeners.hashchange({ type: 'hashchange' })
  // The options object is built inside the vm realm, so compare its fields, not the object.
  assert.equal(scroller.scrollToCalls.length, 1,
    'there is no pending fragment jump to lose once the reader is on the page')
  assert.equal(scroller.scrollToCalls[0].behavior, 'smooth')
  assert.equal(scroller.scrollToCalls[0].top, centeredOn(OTHER_TOP))
})

test('with no current page entry the sidebar scroller is reset to the top', () => {
  const { scroller, panel } = run({
    entries: [{ href: 'other/', layoutTop: 0 }, { href: 'elsewhere/', layoutTop: OTHER_TOP }],
    scrollerTop: 400,
  })
  assert.equal(scroller.scrollTop, 0)
  assert.equal(panel.scrollTop, 0, 'the reset goes to the scroller, not to the panel that cannot scroll')
})

test('opening a dropdown near the bottom scrolls its children into view', () => {
  // Closed, the row ends exactly at the scroller's bottom edge; open, its children hang 120px below.
  const dropdownTop = SCROLLER_HEIGHT - LINK_HEIGHT
  const { scroller, items } = run({
    entries: [{ href: 'other/', layoutTop: 0 }, { href: 'group/', layoutTop: dropdownTop, childCount: 3 }],
  })
  const dropdown = items[1]
  assert.equal(scroller.scrollTop, 0, 'nothing has scrolled yet')
  dropdown.item.handlers.click({ target: dropdown.item, stopPropagation () {} })
  assert.ok(dropdown.classList.contains('is-active'), 'the click opened the dropdown')
  assert.equal(scroller.scrollTop, LINK_HEIGHT * 3, 'the scroller moves by exactly what hangs below it')
})

test('opening a dropdown already fully in view scrolls nothing', () => {
  const { scroller, items } = run({
    entries: [{ href: 'other/', layoutTop: 0 }, { href: 'group/', layoutTop: 100, childCount: 3 }],
  })
  const dropdown = items[1]
  dropdown.item.handlers.click({ target: dropdown.item, stopPropagation () {} })
  assert.ok(dropdown.classList.contains('is-active'))
  assert.equal(scroller.scrollTop, 0)
})

test('opening a dropdown taller than the sidebar never scrolls its own row out of the top', () => {
  // Centering the current entry leaves the scroller at 500, which puts this dropdown's row 100px
  // above the top of the sidebar. Open, it is taller than the sidebar, so it overflows both edges.
  const { scroller, items } = run({
    entries: [
      { href: 'page/', current: true, layoutTop: 780 },
      { href: 'group/', layoutTop: 400, childCount: 20 },
    ],
  })
  assert.equal(scroller.scrollTop, 500)
  const dropdown = items[1]
  dropdown.item.handlers.click({ target: dropdown.item, stopPropagation () {} })
  assert.ok(dropdown.classList.contains('is-active'))
  assert.equal(scroller.scrollTop, 500, 'bringing the bottom into view must not scroll upwards')
})

test('the walk stops at the menu panel when the panel is the box that scrolls', () => {
  const { scroller, panel, scrollIntoViewCalls } = run({ entries: CURRENT_PAGE_NAV, panelScrolls: true })
  assert.equal(scroller, panel)
  assert.deepEqual(scrollIntoViewCalls, [])
  assert.equal(panel.scrollTop, centeredOn(CURRENT_TOP))
})

test('when nothing in the chain scrolls, the sidebar is left alone', () => {
  // div.nav-panel-menu has no overflow rule in any stylesheet, so there is no scroll box to fall back
  // to. Writing scrollTop to the panel would look like it worked and move nothing.
  const { panel, scrollIntoViewCalls } = run({ entries: CURRENT_PAGE_NAV, scrollerless: true })
  assert.deepEqual(scrollIntoViewCalls, [], 'still never the window')
  assert.equal(panel.scrollTop, 0, 'the panel is not the scroller, so it is not written to')
})
