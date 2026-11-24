/**
 * Accessibility rules for the shared tooltip path (12-activate-tooltips.js):
 * - no aria-expanded on tooltip references (a tooltip opens nothing to operate)
 * - Escape dismisses an open tooltip without moving focus (WCAG 1.4.13)
 * - badges inside a data-tooltip-nofocus container get no tab stop
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SCRIPT = fs.readFileSync(path.join(__dirname, '../../src/js/12-activate-tooltips.js'), 'utf8')

function badge (inNoFocus) {
  return {
    tagName: 'SPAN',
    attrs: { 'data-tooltip': 'Requires an Enterprise Edition license.' },
    parentElement: { closest: () => null },
    classList: { contains: () => false },
    matches: () => false,
    closest: (sel) => (sel === '[data-tooltip-nofocus]' && inNoFocus ? {} : null),
    getAttribute (n) { return n in this.attrs ? this.attrs[n] : null },
    setAttribute (n, v) { this.attrs[n] = String(v) },
    removeAttribute (n) { delete this.attrs[n] },
    addEventListener () {},
    querySelector () { return null },
  }
}

function run (elements) {
  const configs = []
  const hideAllCalls = []
  const listeners = {}
  const tippy = (el, cfg) => { configs.push(cfg); return {} }
  tippy.hideAll = (opts) => hideAllCalls.push(opts)
  const context = {
    navigator: { maxTouchPoints: 0 },
    window: {},
    tippy,
    document: {
      addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn) },
      querySelectorAll: (sel) => (sel === '[data-tooltip]' ? elements : []),
      createElement: () => ({ appendChild () {}, set textContent (v) {}, set innerHTML (v) {} }),
      body: {},
    },
  }
  vm.runInNewContext(SCRIPT, context)
  listeners.DOMContentLoaded.forEach((fn) => fn())
  return { configs, hideAllCalls, listeners }
}

test('tooltip references never get aria-expanded', () => {
  const { configs } = run([badge(false)])
  assert.ok(configs.length > 0)
  for (const cfg of configs) assert.equal(cfg.aria.expanded, false)
})

test('Escape hides every open tooltip', () => {
  const { listeners, hideAllCalls } = run([badge(false)])
  const keydown = listeners.keydown || []
  assert.ok(keydown.length > 0, 'no keydown listener')
  keydown.forEach((fn) => fn({ key: 'a' }))
  assert.equal(hideAllCalls.length, 0, 'a non-Escape key closed tooltips')
  keydown.forEach((fn) => fn({ key: 'Escape' }))
  assert.equal(hideAllCalls.length, 1)
})

test('a badge gets a tab stop unless a container opts out', () => {
  const plain = badge(false)
  const listed = badge(true)
  run([plain, listed])
  assert.equal(plain.attrs.tabindex, '0')
  assert.equal(listed.attrs.tabindex, undefined)
})
