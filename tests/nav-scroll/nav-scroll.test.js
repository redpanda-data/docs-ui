/**
 * Left nav: bringing the current page's entry into view must scroll only the sidebar.
 *
 * Element.scrollIntoView scrolls every scrollable ancestor, the window included. When the stylesheet
 * is not cached yet, site.js runs before the browser has jumped to the URL fragment, and Chrome drops
 * that pending jump the moment a script scrolls, so a reader following a #anchor link landed at the
 * top of the page (DOC-2513). Setting the sidebar scroller's own scrollTop reaches the same place
 * without touching the window, on load and again when the hash changes.
 *
 * The scroller is the nearest ancestor with overflow-y auto or scroll: div.sb-scroll in nav.hbs,
 * which wraps the menu panel. When no ancestor scrolls, the menu panel itself is the fallback.
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
// nav-menu.hbs and nav-tree.hbs. Selectors are tag, classes and one [attr=value] or [attr^=value] test.
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
function makeScroller (el) {
  el.computedStyle = { overflowY: 'auto' }
  el.clientHeight = SCROLLER_HEIGHT
  el.getBoundingClientRect = () => ({
    top: SCROLLER_TOP,
    bottom: SCROLLER_TOP + SCROLLER_HEIGHT,
    height: SCROLLER_HEIGHT,
  })
  return el
}

// One nav entry as nav-tree.hbs renders it: <li class="nav-item"><div class="item"><a class="nav-link">.
// layoutTop is the link's offset from the top of the scrolled content, so its viewport position
// follows the scroller's scrollTop the way a real layout would.
function navEntry ({ href, current = false, layoutTop }, getScroller, scrollIntoViewCalls) {
  const link = makeEl('a', { class: 'nav-link', href })
  link.offsetHeight = LINK_HEIGHT
  link.getBoundingClientRect = () => {
    const top = SCROLLER_TOP + layoutTop - getScroller().scrollTop
    return { top, bottom: top + LINK_HEIGHT, height: LINK_HEIGHT }
  }
  link.scrollIntoView = (options) => scrollIntoViewCalls.push({ href, options })
  const item = makeEl('div', { class: 'item' + (current ? ' is-current-page' : '') }, [link])
  return makeEl('li', { class: 'nav-item', 'data-depth': '0' }, [item])
}

// Drive the IIFE against the stub DOM. entries describe the nav tree; hash is window.location.hash on
// load. By default div.sb-scroll wraps the menu panel and is the scroller, as in nav.hbs; with
// panelScrolls the panel itself is the scroller and there is no wrapper.
function run ({ entries, hash = '', panelScrolls = false }) {
  const scrollIntoViewCalls = []
  let scroller
  const items = entries.map((entry) => navEntry(entry, () => scroller, scrollIntoViewCalls))
  const list = makeEl('ul', { class: 'nav-list' }, items)
  const menu = makeEl('nav', { class: 'nav-menu' }, [list])
  const panel = makeEl('div', { class: 'nav-panel-menu is-active', 'data-panel': 'menu' }, [menu])
  let sidebarChild = panel
  if (panelScrolls) {
    scroller = makeScroller(panel)
  } else {
    scroller = makeScroller(makeEl('div', { class: 'sb-scroll' }, [panel]))
    sidebarChild = scroller
  }
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
  return { scroller, panel, listeners, scrollIntoViewCalls, win: context.window }
}

const CURRENT_TOP = 1000
const OTHER_TOP = 2000
// The scroller moves so the entry's middle sits at the scroller's middle.
const centeredOn = (layoutTop) => layoutTop - SCROLLER_HEIGHT / 2 + LINK_HEIGHT / 2

test('bringing the current page entry into view on load never calls scrollIntoView', () => {
  const { scrollIntoViewCalls } = run({
    entries: [{ href: 'other/', layoutTop: 0 }, { href: 'page/', current: true, layoutTop: CURRENT_TOP }],
  })
  assert.deepEqual(scrollIntoViewCalls, [], 'scrollIntoView reaches the window and cancels the pending fragment jump')
})

test('on load the sidebar scroller moves so the current page entry sits at its midpoint', () => {
  const { scroller, panel } = run({
    entries: [{ href: 'other/', layoutTop: 0 }, { href: 'page/', current: true, layoutTop: CURRENT_TOP }],
  })
  assert.equal(scroller.scrollTop, centeredOn(CURRENT_TOP))
  assert.equal(panel.scrollTop, 0, 'the non-scrolling panel inside the scroller is left alone')
})

test('a hash change repositions the scroller on the new entry without scrollIntoView', () => {
  const { scroller, listeners, scrollIntoViewCalls, win } = run({
    entries: [{ href: 'page/', current: true, layoutTop: CURRENT_TOP }, { href: '#section-b', layoutTop: OTHER_TOP }],
  })
  assert.ok(listeners.hashchange, 'the script listens for hash changes when the nav has fragment links')
  win.location.hash = '#section-b'
  listeners.hashchange()
  assert.deepEqual(scrollIntoViewCalls, [])
  assert.equal(scroller.scrollTop, centeredOn(OTHER_TOP))
})

test('when no ancestor scrolls, the menu panel itself is scrolled', () => {
  const { scroller, panel, scrollIntoViewCalls } = run({
    entries: [{ href: 'other/', layoutTop: 0 }, { href: 'page/', current: true, layoutTop: CURRENT_TOP }],
    panelScrolls: true,
  })
  assert.equal(scroller, panel)
  assert.deepEqual(scrollIntoViewCalls, [])
  assert.equal(panel.scrollTop, centeredOn(CURRENT_TOP))
})
