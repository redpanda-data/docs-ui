/**
 * Glossary terms are <a> elements that also carry a tooltip. On a touch device
 * a tap used to navigate before the definition could be read, and the tooltip
 * itself needed a long press. 12-activate-tooltips.js now opens the tooltip on
 * tap, swallows the navigation, and offers the destination as a link inside
 * the tooltip (on every device for glossary terms).
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '../..')
const SRC = fs.readFileSync(path.join(ROOT, 'src/js/12-activate-tooltips.js'), 'utf8')

// Minimal element stand-in with the handful of DOM methods the module uses.
function el ({ tag = 'span', attrs = {}, classes = [], children = [] } = {}) {
  const node = {
    tagName: tag.toUpperCase(),
    attrs: { ...attrs },
    classList: { contains: (c) => classes.includes(c) },
    listeners: {},
    children,
    getAttribute (n) { return n in this.attrs ? this.attrs[n] : null },
    setAttribute (n, v) { this.attrs[n] = String(v) },
    removeAttribute (n) { delete this.attrs[n] },
    hasAttribute (n) { return n in this.attrs },
    addEventListener (t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn) },
    querySelector (sel) { return sel === 'a[href]' ? (children.find((c) => c.tagName === 'A' && c.attrs.href) || null) : null },
    matches () { return false },
  }
  return node
}

function run ({ touch, elements }) {
  const tippyCalls = []
  const created = []
  const context = {
    navigator: { maxTouchPoints: touch ? 5 : 0 },
    tippy: (target, cfg) => { tippyCalls.push({ target, cfg }) },
    document: {
      addEventListener: (t, fn) => { if (t === 'DOMContentLoaded') context.fire = fn },
      querySelectorAll: (sel) => {
        if (sel.startsWith('[data-tippy-content]')) return elements.filter((e) => 'data-tippy-content' in e.attrs && !('data-tooltip' in e.attrs))
        if (sel === '[data-tooltip]') return elements.filter((e) => 'data-tooltip' in e.attrs)
        if (sel === '[data-enterprise-tooltip]') return elements.filter((e) => 'data-enterprise-tooltip' in e.attrs)
        if (sel === '.enterprise-feature[title]') return elements.filter((e) => e.classList.contains('enterprise-feature') && 'title' in e.attrs)
        return []
      },
      createElement: (tag) => {
        const n = { tagName: tag.toUpperCase(), children: [], set innerHTML (v) { this._html = v }, get innerHTML () { return this._html }, set textContent (v) { this._text = v }, get textContent () { return this._text }, appendChild (c) { this.children.push(c) } }
        created.push(n)
        return n
      },
      body: {},
    },
  }
  context.window = touch ? { ontouchstart: null } : {}
  vm.runInNewContext(SRC, context)
  context.fire()
  return { tippyCalls, created }
}

const glossaryTerm = () => el({ tag: 'a', classes: ['glossary-term'], attrs: { href: '../reference/glossary/#topic', 'data-tippy-content': 'A stream of <code>events</code>.' } })
const badge = () => el({ tag: 'span', attrs: { 'data-tippy-content': 'This is a beta feature.' } })
const enterprise = () => el({ tag: 'span', classes: ['enterprise-feature'], attrs: { title: 'Requires an Enterprise license.' }, children: [el({ tag: 'a', attrs: { href: '/licenses/' } })] })

test('desktop: hover trigger, glossary tooltip carries a View in glossary link, tap is not intercepted', () => {
  const term = glossaryTerm()
  const { tippyCalls } = run({ touch: false, elements: [term, badge()] })
  const cfg = tippyCalls.find((c) => c.target === term).cfg
  assert.equal(cfg.trigger, 'mouseenter focus')
  assert.equal(cfg.touch, 'hold')
  assert.equal(cfg.ignoreAttributes, true, 'tippy must not let data-tippy-content override the built content')
  assert.equal(cfg.content.innerHTML, 'A stream of <code>events</code>.', 'glossary definitions keep their markup')
  const link = cfg.content.children[0]
  assert.equal(link.tagName, 'A')
  assert.equal(link.className, 'tippy-footer-link')
  assert.equal(link.href, '../reference/glossary/#topic')
  assert.equal(link.textContent, 'View in glossary')
  assert.equal(term.listeners.click, undefined, 'no click interception on desktop')
})

test('touch: tap trigger, the first tap on a glossary term does not navigate', () => {
  const term = glossaryTerm()
  const { tippyCalls } = run({ touch: true, elements: [term] })
  const cfg = tippyCalls[0].cfg
  assert.equal(cfg.trigger, 'click')
  assert.equal(cfg.touch, true)
  assert.equal(cfg.hideOnClick, 'toggle')
  assert.equal(term.attrs['aria-haspopup'], 'dialog')
  let prevented = false
  term.listeners.click[0]({ preventDefault: () => { prevented = true }, target: { closest: () => null } })
  assert.equal(prevented, true, 'the term itself opens the tooltip instead of navigating')
  // A tap on the footer link inside the tooltip is left alone.
  prevented = false
  term.listeners.click[0]({ preventDefault: () => { prevented = true }, target: { closest: (s) => (s === '.tippy-box' ? {} : null) } })
  assert.equal(prevented, false)
})

test('a tooltipped element with no link gets no footer link and no interception', () => {
  const b = badge()
  const { tippyCalls } = run({ touch: true, elements: [b] })
  assert.equal(tippyCalls[0].cfg.content.children.length, 0)
  assert.equal(b.listeners.click, undefined)
})

test('enterprise terms wrapping a licensing link get a Learn more link, plain text only', () => {
  const e = enterprise()
  const { tippyCalls } = run({ touch: false, elements: [e] })
  const cfg = tippyCalls[0].cfg
  assert.equal(cfg.allowHTML, false)
  assert.equal(cfg.content.textContent, 'Requires an Enterprise license.')
  assert.equal(cfg.content.children[0].textContent, 'Learn more')
  assert.equal(cfg.content.children[0].href, '/licenses/')
  assert.equal(e.attrs.title, undefined, 'native title removed so there is no double tooltip')
})
