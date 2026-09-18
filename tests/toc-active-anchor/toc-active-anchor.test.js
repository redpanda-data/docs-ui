/**
 * Which "On this page" entry is highlighted after an in-page anchor jump.
 *
 * The bug this pins: a browser parks a linked heading at scroll-padding-top +
 * scroll-margin-top, which is BELOW the activation line onScroll compares
 * against, so the scroll pass picks the heading above the target and highlights
 * the wrong entry. Clicking any in-page property link showed it.
 *
 * onScroll's geometry is not the contract. The contract is that a hash the URL
 * names is the active entry, so these tests assert it at two landing positions:
 * level with the activation line, and below it. The second one fails if the
 * script goes back to inferring the active entry from pixels alone.
 *
 * A separate assertion covers the stylesheet, where the double offset came
 * from.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SCRIPT = path.join(__dirname, '../../src/js/02-on-this-page.js')
const CSS = path.join(__dirname, '../../src/css/doc.css')

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


// Landing positions a real browser produces. 80 is the activation line
// (scroll-padding-top in the harness). 165 is where a deep-linked heading
// actually lands today, because the stylesheet adds scroll-margin-top on top of
// scroll-padding-top.
const ON_THE_LINE = 80
const BELOW_THE_LINE = 165

for (const landing of [ON_THE_LINE, BELOW_THE_LINE]) {
  test(`a deep-linked heading is the active entry, landing at ${landing}px`, () => {
    const { list, listeners, headings } = run({ collapsible: false, hash: '#october-2025' })
    scrollTo(headings, 'october-2025', landing)
    listeners.load()

    const links = linksByHref(list)
    assert.ok(
      links['#october-2025'].classList.contains('is-active'),
      'the heading the URL names is active'
    )
    const others = Object.keys(links).filter((h) => h !== '#october-2025' && links[h].classList.contains('is-active'))
    assert.deepEqual(others, [], 'no other entry is left active')
  })

  test(`an in-page link fires hashchange and moves the highlight, landing at ${landing}px`, () => {
    // This is the reported case: click a property link in the body. No load, no
    // TOC click, just a hashchange.
    const { list, listeners, headings, win } = run({ collapsible: false, hash: '#november-2025' })
    scrollTo(headings, 'november-2025', landing)
    listeners.load()

    win.location.hash = '#december-2024'
    scrollTo(headings, 'december-2024', landing)
    listeners.hashchange()

    const links = linksByHref(list)
    assert.ok(links['#december-2024'].classList.contains('is-active'), 'the new target is active')
    assert.ok(!links['#november-2025'].classList.contains('is-active'), 'the old target is not still active')
  })
}

test('a percent-encoded hash still activates its entry', () => {
  const { list, listeners, headings, win } = run({ collapsible: false })
  scrollTo(headings, 'october-2025', BELOW_THE_LINE)
  listeners.load()
  win.location.hash = '#october%2D2025'
  listeners.hashchange()
  const links = linksByHref(list)
  assert.ok(links['#october-2025'].classList.contains('is-active'), 'decoded hash matches its entry')
})

test('a hash that names nothing on the page leaves the highlight alone', () => {
  const { list, listeners, headings, win } = run({ collapsible: false })
  scrollTo(headings, 'october-2025', ON_THE_LINE)
  listeners.load()
  const before = Object.keys(linksByHref(list)).filter((h) => linksByHref(list)[h].classList.contains('is-active'))
  win.location.hash = '#not-a-heading'
  listeners.hashchange()
  const after = Object.keys(linksByHref(list)).filter((h) => linksByHref(list)[h].classList.contains('is-active'))
  assert.deepEqual(after, before, 'an unknown hash is ignored rather than clearing the highlight')
})

test('the stylesheet offsets an anchor jump once, not twice', () => {
  // scroll-padding-top on html already clears the sticky bar for every anchor
  // jump. A scroll-margin-top on the headings adds a second offset, which is
  // what put a linked heading below the activation line and highlighted the
  // entry above it. One offset, in one place, so the browser and onScroll agree.
  const css = fs.readFileSync(CSS, 'utf8')
  assert.match(css, /html\s*\{[^}]*scroll-padding-top:/, 'html still carries scroll-padding-top')
  const headingMargin = css.match(/\.doc h[2-6]\[id\][^{]*\{[^}]*scroll-margin-top:[^}]*\}/g)
  assert.equal(headingMargin, null, 'headings do not add a second offset via scroll-margin-top')
})
