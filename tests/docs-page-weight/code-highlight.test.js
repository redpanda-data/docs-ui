/**
 * 10-code-highlight.js takes over Prism's automatic pass: blocks near the
 * viewport are highlighted at once, the rest when they scroll close.
 * 11-editable-placeholders.js triggers it after making placeholders editable,
 * the ordering keep-markup needs.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '../..')
const SRC = fs.readFileSync(path.join(ROOT, 'src/js/10-code-highlight.js'), 'utf8')

function block (top, id) {
  return {
    id,
    dataset: {},
    getBoundingClientRect: () => ({ top, bottom: top + 100 }),
    closest: () => null,
    querySelector: () => null,
  }
}

function load ({ blocks, withObserver = true }) {
  const highlighted = []
  const observed = []
  const listeners = {}
  const context = {
    Prism: { highlightElement: (el) => highlighted.push(el.id) },
    document: {
      querySelectorAll: () => blocks,
      addEventListener: (t, fn) => { listeners[t] = fn },
      getElementById: () => null,
    },
  }
  context.setTimeout = (fn) => { context.pendingTimer = fn; return 1 }
  context.window = {
    innerHeight: 800,
    location: { hash: '' },
    addEventListener: (t, fn) => { listeners[t] = fn },
  }
  if (withObserver) {
    context.window.IntersectionObserver = class {
      constructor (cb) { this.cb = cb }
      observe (el) { observed.push(el.id) }
      unobserve () {}
    }
  }
  vm.runInNewContext(SRC, context)
  return { context, highlighted, observed, listeners }
}

test('turns Prism automatic highlighting off and exposes the on-demand entry point', () => {
  const { context } = load({ blocks: [] })
  assert.equal(context.Prism.manual, true)
  assert.equal(typeof context.window.highlightCodeBlocks, 'function')
})

test('near-viewport blocks highlight now, far ones wait for the observer, none twice', () => {
  const blocks = [block(100, 'visible'), block(1100, 'near'), block(5000, 'far')]
  const { context, highlighted, observed } = load({ blocks })
  context.window.highlightCodeBlocks()
  assert.deepEqual(highlighted, ['visible', 'near'], 'within 400px below the fold counts as near')
  assert.deepEqual(observed, ['far'])
  context.window.highlightCodeBlocks()
  assert.deepEqual(highlighted, ['visible', 'near'], 'a second pass does no repeat work')
})

test('keeps working after something else overwrites window.Prism', () => {
  // The stock Kapa widget assigns its own highlighter to window.Prism (no
  // highlightElement). Deferred blocks must still go through the real one.
  const blocks = [block(100, 'now'), block(5000, 'later')]
  const { context, highlighted } = load({ blocks })
  context.window.highlightCodeBlocks()
  context.Prism = { languages: {}, util: {} } // clobbered
  const io = context.window.IntersectionObserver
  // Re-create the observer callback path: the module holds its own instance,
  // so drive the element through the exposed per-element entry point instead.
  assert.equal(typeof io, 'function')
  context.window.highlightCodeElement(blocks[1], true)
  assert.deepEqual(highlighted, ['now', 'later'])
})

test('without IntersectionObserver everything is highlighted immediately', () => {
  const blocks = [block(100, 'a'), block(9000, 'b')]
  const { context, highlighted } = load({ blocks, withObserver: false })
  context.window.highlightCodeBlocks()
  assert.deepEqual(highlighted, ['a', 'b'])
})

test('a scroll sweep catches blocks the observer has not reported yet', () => {
  const far = block(5000, 'far')
  const { context, highlighted, listeners } = load({ blocks: [far] })
  context.window.highlightCodeBlocks()
  assert.deepEqual(highlighted, [], 'far block is only observed')
  // The reader scrolls it into range while observer delivery is paused
  // (hidden tab): the debounced sweep highlights it anyway.
  far.getBoundingClientRect = () => ({ top: 300, bottom: 400 })
  listeners.scroll()
  assert.equal(typeof context.pendingTimer, 'function', 'sweep is debounced through a timer')
  context.pendingTimer()
  assert.deepEqual(highlighted, ['far'])
  assert.equal(typeof listeners.visibilitychange, 'function')
})

test('a fragment target inside a far block is highlighted before the browser scrolls to it', () => {
  const code = block(9000, 'deep')
  const pre = { querySelector: () => code }
  const target = { closest: () => pre, querySelector: () => null }
  const { context, highlighted, listeners } = load({ blocks: [code] })
  context.window.location.hash = '#L12'
  context.document.getElementById = (id) => (id === 'L12' ? target : null)
  listeners.DOMContentLoaded()
  assert.deepEqual(highlighted, ['deep'])
})

test('11-editable-placeholders hands off to the on-demand pass instead of highlightAll', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/js/11-editable-placeholders.js'), 'utf8')
  assert.match(src, /makePlaceholdersEditable\(\)\s*[\s\S]{0,400}window\.highlightCodeBlocks\(\)/)
  assert.ok(src.indexOf('makePlaceholdersEditable()') < src.indexOf('window.highlightCodeBlocks()'), 'placeholders first, then highlight')
})
