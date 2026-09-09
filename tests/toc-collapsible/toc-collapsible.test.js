/**
 * Collapsible groups in the "On this page" TOC (opt-in with :page-toc-collapsible: true).
 *
 * The grouping is the part worth testing: level-1 entries become toggleable groups holding the
 * deeper entries that follow them, only the first group starts expanded, and a group must open
 * when one of its entries is activated. Pages without the attribute must keep the flat list.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SCRIPT = path.join(__dirname, '../../src/js/02-on-this-page.js')
const PARTIAL = path.join(__dirname, '../../src/partials/toc.hbs')

test('toc.hbs exposes the page attribute as data-collapsible on the sidebar', () => {
  const hbs = fs.readFileSync(PARTIAL, 'utf8')
  const aside = hbs.match(/<aside class="toc sidebar"[^>]*>/)
  assert.ok(aside, 'sidebar aside is in the partial')
  assert.match(aside[0], /\{\{#if page\.attributes\.toc-collapsible\}\} data-collapsible="true"\{\{\/if\}\}/)
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

// Drive the IIFE against a stub DOM and hand back the built list.
function run ({ collapsible, headings = HEADINGS }) {
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
      documentElement: {},
      querySelector: (sel) => {
        if (sel === 'aside.toc.sidebar') return sidebar
        if (sel === 'article.doc') return article
        return null
      },
    },
    window: {
      addEventListener: (t, fn) => { listeners[t] = fn },
      scrollY: 0,
      innerHeight: 800,
      getComputedStyle: () => ({}),
    },
  }
  vm.runInNewContext(fs.readFileSync(SCRIPT, 'utf8'), context)
  const list = menu.children[0]
  return { sidebar, menu, list, listeners }
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

test('activating an entry inside a collapsed group opens that group', () => {
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
