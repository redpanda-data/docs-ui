/**
 * Collapsible groups in the "On this page" TOC (opt-in with :page-toc-collapsible: true).
 *
 * The grouping is the part worth testing: level-1 entries become toggleable groups holding the
 * deeper entries that follow them, only the first group starts expanded, and a group must open
 * when one of its entries is activated. Activation is covered on every path the script has: a
 * sidebar click, the load pass that handles deep links, scrolling, and the end-of-page pass.
 * Pages without the attribute must keep the flat list.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SCRIPT = path.join(__dirname, '../../src/js/02-on-this-page.js')
const PARTIAL = path.join(__dirname, '../../src/partials/toc.hbs')

test('toc.hbs sets data-collapsible only when the page attribute is exactly "true"', () => {
  const hbs = fs.readFileSync(PARTIAL, 'utf8')
  const aside = hbs.match(/<aside class="toc sidebar"[^>]*>/)
  assert.ok(aside, 'sidebar aside is in the partial')
  // A bare {{#if}} would also fire for the string "false", which is what :page-toc-collapsible: false yields.
  const collapsibleAttr = "{{#if (eq page.attributes.toc-collapsible 'true')}} data-collapsible=\"true\"{{/if}}"
  assert.ok(aside[0].includes(collapsibleAttr), 'the attribute is gated on the exact string "true"')
})

// Minimal DOM: enough of createElement/appendChild/querySelector for the TOC builder.
function matches (el, simple) {
  const m = simple.match(/^([a-z0-9]*)((?:\.[\w-]+)*)$/i)
  if (!m) return false
  const tag = m[1]
  const classes = m[2] ? m[2].split('.').filter(Boolean) : []
  if (tag && el.tagName !== tag.toUpperCase()) return false
  return classes.every((c) => el.classList.contains(c))
}

function collect (el, simple, out) {
  el.children.forEach((child) => {
    if (matches(child, simple)) out.push(child)
    collect(child, simple, out)
  })
  return out
}

function makeEl (tag) {
  const classes = new Set()
  const el = {
    tagName: tag.toUpperCase(),
    nodeName: tag.toUpperCase(),
    children: [],
    parentNode: null,
    attrs: {},
    dataset: {},
    handlers: {},
    _text: '',
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
    set className (v) {
      classes.clear()
      v.split(/\s+/).filter(Boolean).forEach((c) => classes.add(c))
    },
    get textContent () { return el._text || el.children.map((c) => c.textContent).join('') },
    set textContent (v) {
      el._text = v
      el.children = []
    },
    get firstChild () { return el.children[0] || null },
    appendChild (child) {
      if (child.parentNode) child.parentNode.removeChild(child)
      child.parentNode = el
      el.children.push(child)
      return child
    },
    insertBefore (node, ref) {
      if (node.parentNode) node.parentNode.removeChild(node)
      node.parentNode = el
      const i = ref ? el.children.indexOf(ref) : -1
      if (i < 0) el.children.push(node)
      else el.children.splice(i, 0, node)
      return node
    },
    removeChild (child) {
      const i = el.children.indexOf(child)
      if (i >= 0) el.children.splice(i, 1)
      child.parentNode = null
      return child
    },
    setAttribute (k, v) { el.attrs[k] = String(v) },
    getAttribute (k) { return k in el.attrs ? el.attrs[k] : null },
    addEventListener (t, fn) { el.handlers[t] = fn },
    querySelector (sel) { return collect(el, sel, [])[0] || null },
    querySelectorAll (sel) { return collect(el, sel, []) },
  }
  return el
}

function heading (level, id, text) {
  return { id, nodeName: 'H' + level, textContent: text }
}

// A reverse-chronological page: years at level 1 (h2), months at level 2 (h3).
const HEADINGS = [
  heading(2, '2026', '2026'),
  heading(3, 'september-2026', 'September 2026'),
  heading(3, 'august-2026', 'August 2026'),
  heading(2, '2025', '2025'),
  heading(3, 'december-2025', 'December 2025'),
  heading(3, 'november-2025', 'November 2025'),
  heading(3, 'october-2025', 'October 2025'),
  heading(2, '2024', '2024'),
  heading(3, 'december-2024', 'December 2024'),
]

// Drive the IIFE against a stub DOM and hand back the built list. Headings are copied so scrollTo()
// can position them per test; scrollY and scrollHeight feed the end-of-page check in onScroll, and
// hash is what window.location.hash reports on load.
function run ({ collapsible, headings = HEADINGS, scrollY = 0, scrollHeight = 5000, hash = '' }) {
  headings = headings.map((h) => Object.assign({}, h))
  const sidebar = makeEl('aside')
  sidebar.dataset = { levels: '2', title: '', collapsible: collapsible ? 'true' : undefined }
  const menu = makeEl('div')
  menu.className = 'toc-menu'
  sidebar.appendChild(menu)

  const article = makeEl('article')
  article.parentNode = { querySelectorAll: () => headings }

  const listeners = {}
  const context = {
    console,
    setTimeout: () => 0,
    document: {
      addEventListener () {},
      getElementById: () => null,
      createElement: makeEl,
      documentElement: { scrollHeight },
      querySelector: (sel) => {
        if (sel === 'aside.toc.sidebar') return sidebar
        if (sel === 'article.doc') return article
        return null
      },
    },
    window: {
      addEventListener: (t, fn) => { listeners[t] = fn },
      location: { hash },
      scrollY,
      innerHeight: 800,
      // A 16px root font and an 80px sticky header (scroll-padding-top) put the activation line at 80px.
      getComputedStyle: () => ({ fontSize: '16px', paddingTop: '0px', scrollPaddingTop: '80px' }),
    },
  }
  vm.runInNewContext(fs.readFileSync(SCRIPT, 'utf8'), context)
  const list = menu.children[0]
  return { sidebar, menu, list, listeners, headings, win: context.window }
}

// Document position of each heading: a year heading sits 60px above its first month, and everything
// else is 400px apart, so the layout has the same adjacency as a real What's New page.
function layout (headings) {
  let y = 0
  return headings.map((h, i) => {
    const pos = y
    const next = headings[i + 1]
    y += next && parseInt(next.nodeName.slice(1), 10) > parseInt(h.nodeName.slice(1), 10) ? 60 : 400
    return pos
  })
}

// Pretend the window is scrolled so the heading with this id sits `landing` px from the top of the
// viewport. 80 is the activation line (scroll-padding-top). A deep-linked heading lands lower, at
// scroll-padding-top + scroll-margin-top, which is 165 here and in the real stylesheet.
function scrollTo (headings, id, landing = 80) {
  const index = headings.findIndex((h) => h.id === id)
  assert.notEqual(index, -1, 'scrollTo target exists: ' + id)
  const ys = layout(headings)
  headings.forEach((h, i) => { h.getBoundingClientRect = () => ({ top: landing + ys[i] - ys[index] }) })
}

// Sidebar links keyed by fragment, so tests can read active state without walking the tree.
function linksByHref (list) {
  const out = {}
  list.querySelectorAll('a').forEach((a) => { out[a.href] = a })
  return out
}

test('without the attribute the TOC stays a flat list', () => {
  const { list } = run({ collapsible: false })
  assert.equal(list.tagName, 'UL')
  assert.equal(list.children.length, HEADINGS.length, 'one <li> per heading at the top level')
  assert.equal(list.querySelectorAll('li.toc-group').length, 0)
  assert.equal(list.querySelectorAll('button').length, 0)
})

test('level-1 entries become groups that hold the entries following them', () => {
  const { list } = run({ collapsible: true })
  const groups = list.children
  assert.equal(groups.length, 3, 'only the three years stay at the top level')
  groups.forEach((group) => assert.ok(group.classList.contains('toc-group')))
  assert.deepEqual(groups.map((g) => g.children.map((c) => c.tagName)), [
    ['A', 'BUTTON', 'UL'],
    ['A', 'BUTTON', 'UL'],
    ['A', 'BUTTON', 'UL'],
  ], 'link, then toggle, then the nested list')
  assert.deepEqual(groups.map((g) => g.children[2].children.length), [2, 3, 1], 'months land under their year')
  assert.deepEqual(
    groups[1].children[2].children.map((li) => li.children[0].href),
    ['#december-2025', '#november-2025', '#october-2025']
  )
})

test('only the first group starts expanded, and the toggles say so', () => {
  const { list } = run({ collapsible: true })
  const groups = list.children
  assert.deepEqual(groups.map((g) => g.classList.contains('is-expanded')), [true, false, false])
  assert.deepEqual(groups.map((g) => g.children[1].getAttribute('aria-expanded')), ['true', 'false', 'false'])
  assert.equal(groups[0].children[1].getAttribute('aria-label'), 'Toggle 2026')
  assert.equal(groups[0].children[1].type, 'button', 'a real button, so it is keyboard operable')
  groups.forEach((g) => {
    assert.ok(g.children[2].id, 'the nested list has an id')
    assert.equal(g.children[1].getAttribute('aria-controls'), g.children[2].id, 'the toggle names the list it controls')
  })
})

test('a level-1 entry with nothing under it stays a plain entry', () => {
  const { list } = run({
    collapsible: true,
    headings: [heading(2, 'overview', 'Overview')].concat(HEADINGS, [heading(2, 'notes', 'Notes')]),
  })
  assert.equal(list.children.length, 5)
  const [overview, y2026, , , notes] = list.children
  assert.equal(overview.children[0].href, '#overview')
  assert.equal(overview.classList.contains('toc-group'), false)
  assert.deepEqual(overview.children.map((c) => c.tagName), ['A'], 'no toggle and no empty list')
  assert.equal(notes.classList.contains('toc-group'), false)
  assert.deepEqual(notes.children.map((c) => c.tagName), ['A'])
  assert.equal(y2026.classList.contains('is-expanded'), true, 'the first real group is the expanded one')
  assert.equal(list.querySelectorAll('button').length, 3)
})

test('the toggle opens and closes its own group', () => {
  const { list } = run({ collapsible: true })
  const group = list.children[1]
  const toggle = group.children[1]

  toggle.handlers.click()
  assert.equal(group.classList.contains('is-expanded'), true)
  assert.equal(toggle.getAttribute('aria-expanded'), 'true')
  assert.equal(list.children[0].classList.contains('is-expanded'), true, 'other groups are left alone')

  toggle.handlers.click()
  assert.equal(group.classList.contains('is-expanded'), false)
  assert.equal(toggle.getAttribute('aria-expanded'), 'false')
})

test('clicking an entry inside a collapsed group opens that group', () => {
  const { list } = run({ collapsible: true })
  const group = list.children[2]
  assert.equal(group.classList.contains('is-expanded'), false)

  const monthLink = group.children[2].children[0].children[0]
  assert.equal(monthLink.href, '#december-2024')
  monthLink.handlers.click()

  assert.equal(monthLink.classList.contains('is-active'), true)
  assert.equal(group.classList.contains('is-expanded'), true)
  assert.equal(group.children[1].getAttribute('aria-expanded'), 'true')
})

test('the load pass activates the entry on the activation line and opens its group', () => {
  const { list, listeners, headings } = run({ collapsible: true })
  const [y2026, y2025, y2024] = list.children
  assert.equal(y2025.classList.contains('is-expanded'), false)

  scrollTo(headings, 'october-2025')
  listeners.load()

  const links = linksByHref(list)
  assert.equal(links['#october-2025'].classList.contains('is-active'), true)
  assert.equal(y2025.classList.contains('is-expanded'), true)
  assert.equal(y2025.children[1].getAttribute('aria-expanded'), 'true')
  assert.equal(y2026.classList.contains('is-expanded'), true, 'the first group keeps its default')
  assert.equal(y2024.classList.contains('is-expanded'), false, 'unrelated groups stay collapsed')
})

test('arriving on a deep link opens the group of the target entry', () => {
  // Browsers park a deep-linked heading at scroll-padding-top + scroll-margin-top, below the
  // activation line, so the scroll pass marks the heading above it active. For the first entry of
  // a group that heading belongs to the previous group and would leave the target's group
  // collapsed. The load handler has to open it from the hash instead.
  const { list, listeners, headings } = run({ collapsible: true, hash: '#december-2025' })
  const [y2026, y2025, y2024] = list.children
  scrollTo(headings, 'december-2025', 165)
  listeners.load()

  const links = linksByHref(list)
  assert.equal(links['#august-2026'].classList.contains('is-active'), true, 'the scroll pass picks the heading above')
  assert.equal(y2025.classList.contains('is-expanded'), true, 'the hash opens the target group anyway')
  assert.equal(y2025.children[1].getAttribute('aria-expanded'), 'true')
  assert.equal(y2026.classList.contains('is-expanded'), true)
  assert.equal(y2024.classList.contains('is-expanded'), false)
})

test('changing the hash after load opens the group of the new target', () => {
  // An in-page link or back/forward fires hashchange, not load. The scroll pass still picks the
  // heading above the target, so the group has to be opened from the new hash.
  const { list, listeners, headings, win } = run({ collapsible: true })
  const [, y2025, y2024] = list.children
  scrollTo(headings, '2026')
  listeners.load()
  assert.equal(typeof listeners.hashchange, 'function', 'a hashchange handler is registered on load')
  assert.equal(y2024.classList.contains('is-expanded'), false)

  win.location.hash = '#december-2024'
  scrollTo(headings, 'december-2024', 165)
  listeners.scroll()
  listeners.hashchange()

  const links = linksByHref(list)
  assert.equal(links['#october-2025'].classList.contains('is-active'), true, 'the scroll pass picks the heading above')
  assert.equal(y2024.classList.contains('is-expanded'), true, 'the hash opens the target group anyway')
  assert.equal(y2025.classList.contains('is-expanded'), true)
})

test('a hash that is not a TOC entry is ignored on load', () => {
  const { list, listeners, headings } = run({ collapsible: true, hash: '#feature-one' })
  scrollTo(headings, '2026')
  listeners.load()
  assert.deepEqual(list.children.map((g) => g.classList.contains('is-expanded')), [true, false, false])
})

test('scrolling into a collapsed group opens it and leaves the previous group open', () => {
  const { list, listeners, headings } = run({ collapsible: true })
  const [, y2025, y2024] = list.children
  scrollTo(headings, 'october-2025')
  listeners.load() // registers the scroll handler
  assert.equal(y2024.classList.contains('is-expanded'), false)

  scrollTo(headings, 'december-2024')
  listeners.scroll()

  const links = linksByHref(list)
  assert.equal(links['#december-2024'].classList.contains('is-active'), true)
  assert.equal(links['#october-2025'].classList.contains('is-active'), false)
  assert.equal(y2024.classList.contains('is-expanded'), true)
  assert.equal(y2025.classList.contains('is-expanded'), true, 'groups are revealed, never auto-collapsed')
})

test('reaching the end of the page opens the group of the trailing entries', () => {
  // At the bottom of the page every heading still on screen is marked active at once, through a
  // separate branch of onScroll from the single-active case.
  const { list, listeners, headings } = run({ collapsible: true, scrollY: 4200, scrollHeight: 5000 })
  const y2024 = list.children[2]
  scrollTo(headings, 'october-2025') // 2024 and its month sit below the activation line, on screen
  listeners.load()

  const links = linksByHref(list)
  assert.equal(links['#2024'].classList.contains('is-active'), true)
  assert.equal(links['#december-2024'].classList.contains('is-active'), true)
  assert.equal(y2024.classList.contains('is-expanded'), true)
  assert.equal(y2024.children[1].getAttribute('aria-expanded'), 'true')
})

test('entries before the first level-1 heading stay at the top level', () => {
  const { list } = run({
    collapsible: true,
    headings: [heading(3, 'intro-note', 'Intro note')].concat(HEADINGS),
  })
  assert.equal(list.children.length, 4)
  assert.equal(list.children[0].classList.contains('toc-group'), false)
  assert.equal(list.children[0].children[0].href, '#intro-note')
  assert.equal(list.children[1].classList.contains('is-expanded'), true, 'first real group is the expanded one')
})
