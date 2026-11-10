'use strict'

// 31-solution-rail.js moves a too-tall sticky rail with the page by the
// amount it overflows, instead of giving it its own scrollbar. These tests run
// the module against a minimal fake window and check the offset it writes.

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(path.join(__dirname, '../../src/js/31-solution-rail.js'), 'utf8')

function setup ({ railHeight, innerHeight = 700, top = 112, wide = true }) {
  const listeners = {}
  const props = {}
  const classes = new Set()
  const rail = {
    offsetHeight: railHeight,
    classList: { add: (c) => classes.add(c) },
    style: { setProperty: (k, v) => { props[k] = v } },
    addEventListener: () => {},
  }
  const shiftPx = () => parseFloat(props['--sol-rail-shift'] || '0')
  const win = {
    innerHeight,
    pageYOffset: 0,
    matchMedia: () => ({ matches: wide, addEventListener: () => {} }),
    // The sticky top the browser resolves includes the current shift.
    getComputedStyle: () => ({ top: (top + shiftPx()) + 'px' }),
    requestAnimationFrame: (fn) => fn(),
    setTimeout: (fn) => fn(),
    addEventListener: (type, fn) => { listeners[type] = fn },
  }
  const doc = { querySelector: () => rail, addEventListener: () => {} }
  vm.runInNewContext(SOURCE, { window: win, document: doc })
  return {
    classes,
    shift: shiftPx,
    scrollTo (y) { win.pageYOffset = y; listeners.scroll() },
  }
}

test('a rail that fits never moves', () => {
  const r = setup({ railHeight: 400 })
  assert.ok(r.classes.has('is-tracked'))
  r.scrollTo(2000)
  assert.equal(r.shift(), 0)
})

test('a tall rail follows the page down until its bottom is in view, then sticks', () => {
  // available = 700 - 112 - 16 = 572, overflow = 900 - 572 = 328
  const r = setup({ railHeight: 900 })
  r.scrollTo(100)
  assert.equal(r.shift(), -100)
  r.scrollTo(2000)
  assert.equal(r.shift(), -328)
})

test('scrolling back up brings the top back straight away', () => {
  const r = setup({ railHeight: 900 })
  r.scrollTo(2000)
  r.scrollTo(1900)
  assert.equal(r.shift(), -228)
  r.scrollTo(1000)
  assert.equal(r.shift(), 0)
})

test('below 1281px the rail is static and gets no offset', () => {
  const r = setup({ railHeight: 900, wide: false })
  r.scrollTo(2000)
  assert.equal(r.shift(), 0)
})
