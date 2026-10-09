/**
 * Glossary terms are <a> elements that also carry a tooltip. On a touch device
 * a tap used to navigate before the definition could be read, and the tooltip
 * itself needed a long press. 12-activate-tooltips.js now opens the tooltip on
 * tap, swallows the navigation, and offers the destination as a link inside
 * the tooltip (on every device for glossary terms).
 *
 * Whether to swallow the navigation is decided per click from
 * tippy.currentInput.isTouch, not from a load-time capability sniff, so a
 * reader on a touch-capable laptop who is using a mouse keeps hover tooltips
 * and working links. That is what the hybrid cases below pin down.
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

// canTouch: the device reports touch capability (the load-time sniff).
// isTouch: the input tippy currently reports in use. They differ on a hybrid.
// omitCurrentInput drops tippy.currentInput entirely, standing in for a future
// bundle that no longer exposes it.
function run ({ canTouch, isTouch = false, omitCurrentInput = false, elements }) {
  const tippyCalls = []
  const created = []
  const tippy = (target, cfg) => { tippyCalls.push({ target, cfg }) }
  if (!omitCurrentInput) tippy.currentInput = { isTouch }
  const context = {
    navigator: { maxTouchPoints: canTouch ? 5 : 0 },
    tippy,
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
  context.window = canTouch ? { ontouchstart: null } : {}
  vm.runInNewContext(SRC, context)
  context.fire()
  return { tippyCalls, created, tippy }
}

// Does a click on this element navigate, or does the tooltip swallow it?
function clickNavigates (element) {
  let prevented = false
  const handlers = element.listeners.click || []
  handlers.forEach((fn) => fn({ preventDefault: () => { prevented = true } }))
  return !prevented
}

const glossaryTerm = () => el({ tag: 'a', classes: ['glossary-term'], attrs: { href: '../reference/glossary/#topic', 'data-tippy-content': 'A stream of <code>events</code>.' } })
const badge = () => el({ tag: 'span', attrs: { 'data-tippy-content': 'This is a beta feature.' } })
const enterprise = () => el({ tag: 'span', classes: ['enterprise-feature'], attrs: { title: 'Requires an Enterprise license.' }, children: [el({ tag: 'a', attrs: { href: '/licenses/' } })] })

test('every device gets the same triggers: hover and focus, with no hold on touch', () => {
  // touch: true (not 'hold') is what lets a tap open the tooltip through the
  // emulated mouseenter, so the trigger does not have to become 'click' and
  // mouse users keep hover. Identical config on both kinds of device.
  ;[false, true].forEach((canTouch) => {
    const term = glossaryTerm()
    const { tippyCalls } = run({ canTouch, isTouch: canTouch, elements: [term] })
    const cfg = tippyCalls.find((c) => c.target === term).cfg
    assert.equal(cfg.trigger, 'mouseenter focus', `trigger on canTouch=${canTouch}`)
    assert.equal(cfg.touch, true, `touch on canTouch=${canTouch}`)
    // true, not 'toggle'. tippy compares hideOnClick with === true before
    // hiding on a press outside the tooltip, so 'toggle' left a reader on a
    // touch device unable to dismiss a tooltip at all: tapping the page did
    // nothing, and tapping the term again does not close it either because
    // the tap re-triggers it. Verified in a browser with real touch events.
    // The opening tap does not dismiss what it just opened, because tippy
    // ignores a press on the reference while the input is touch.
    assert.equal(cfg.hideOnClick, true, `hideOnClick on canTouch=${canTouch}`)
  })
})

test('desktop: glossary tooltip carries a View in glossary link and the click still navigates', () => {
  const term = glossaryTerm()
  const { tippyCalls } = run({ canTouch: false, elements: [term, badge()] })
  const cfg = tippyCalls.find((c) => c.target === term).cfg
  assert.equal(cfg.ignoreAttributes, true, 'tippy must not let data-tippy-content override the built content')
  assert.equal(cfg.content.innerHTML, 'A stream of <code>events</code>.', 'glossary definitions keep their markup')
  const link = cfg.content.children[0]
  assert.equal(link.tagName, 'A')
  assert.equal(link.className, 'tippy-footer-link')
  assert.equal(link.href, '../reference/glossary/#topic')
  assert.equal(link.textContent, 'View in glossary')
  assert.equal(term.attrs['aria-haspopup'], undefined, 'no popup hint on a device that cannot touch')
  assert.equal(clickNavigates(term), true, 'a mouse click follows the link')
})

test('touch: the first tap on a glossary term does not navigate', () => {
  const term = glossaryTerm()
  run({ canTouch: true, isTouch: true, elements: [term] })
  assert.equal(term.attrs['aria-haspopup'], 'dialog')
  assert.equal(clickNavigates(term), false, 'the term opens the tooltip instead of navigating')
})

test('hybrid: touch capability but a mouse in use keeps the link clickable', () => {
  // A Surface, most Windows touch laptops, a Chromebook, an iPad with a
  // trackpad: 'ontouchstart' in window is true while the reader uses a mouse.
  // Deciding from the sniff swallowed those clicks, so the glossary link
  // became unreachable except through the tooltip footer.
  const term = glossaryTerm()
  const { tippyCalls, tippy } = run({ canTouch: true, isTouch: false, elements: [term] })
  const cfg = tippyCalls.find((c) => c.target === term).cfg
  assert.equal(cfg.trigger, 'mouseenter focus', 'hover and focus tooltips survive on a hybrid')
  assert.equal(clickNavigates(term), true, 'a mouse click on a hybrid follows the link')

  // Same element, same listener: the reader puts the mouse down and taps.
  // tippy flips currentInput.isTouch on touchstart, and the decision is read
  // at click time, so interception starts without a reload.
  tippy.currentInput.isTouch = true
  assert.equal(clickNavigates(term), false, 'once touch is the input in use, the tap opens the tooltip')

  // And back again, after tippy sees two quick mousemoves.
  tippy.currentInput.isTouch = false
  assert.equal(clickNavigates(term), true, 'switching back to the mouse restores the link')
})

test('a tippy build without currentInput leaves navigation alone', () => {
  const term = glossaryTerm()
  run({ canTouch: true, omitCurrentInput: true, elements: [term] })
  assert.equal(clickNavigates(term), true, 'fail open: never trap the reader on the page')
})

test('a tooltipped element with no link gets no footer link and no interception', () => {
  const b = badge()
  const { tippyCalls } = run({ canTouch: true, isTouch: true, elements: [b] })
  assert.equal(tippyCalls[0].cfg.content.children.length, 0)
  assert.equal(b.listeners.click, undefined)
  assert.equal(b.attrs['aria-haspopup'], undefined, 'nothing to pop up to')
})

test('enterprise terms wrapping a licensing link get a Learn more link, plain text only', () => {
  const e = enterprise()
  const { tippyCalls } = run({ canTouch: false, elements: [e] })
  const cfg = tippyCalls[0].cfg
  assert.equal(cfg.allowHTML, false)
  assert.equal(cfg.content.textContent, 'Requires an Enterprise license.')
  assert.equal(cfg.content.children[0].textContent, 'Learn more')
  assert.equal(cfg.content.children[0].href, '/licenses/')
  assert.equal(e.attrs.title, undefined, 'native title removed so there is no double tooltip')
})
