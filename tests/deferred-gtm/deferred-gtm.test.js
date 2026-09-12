/**
 * The Google Tag Manager snippet in head-scripts.hbs no longer injects gtm.js
 * during parsing. It creates dataLayer immediately (so early pushes queue as
 * before) and adds the container script after the load event, or on the first
 * interaction if that comes sooner, and never twice.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '../..')
const HEAD = fs.readFileSync(path.join(ROOT, 'src/partials/head-scripts.hbs'), 'utf8')

function snippet () {
  const start = HEAD.indexOf('<!-- Google Tag Manager -->')
  const end = HEAD.indexOf('<!-- End Google Tag Manager -->')
  assert.ok(start > 0 && end > start, 'GTM snippet present')
  const block = HEAD.slice(start, end)
  const js = block.match(/<script>([\s\S]*?)<\/script>/)[1]
  return js.replace(/\{\{\{this\}\}\}/g, 'GTM-TEST')
}

function run ({ readyState }) {
  const inserted = []
  const listeners = {}
  const firstScript = { parentNode: { insertBefore: (el) => inserted.push(el) } }
  const context = {
    Date,
    setTimeout: (fn) => fn(),
    document: {
      readyState,
      getElementsByTagName: () => [firstScript],
      createElement: (tag) => ({ tag }),
    },
  }
  context.window = {
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn) },
  }
  vm.runInNewContext(snippet(), context)
  return { inserted, listeners, context }
}

test('dataLayer exists immediately but gtm.js waits for the load event', () => {
  const { inserted, listeners, context } = run({ readyState: 'loading' })
  assert.ok(Array.isArray(context.window.dataLayer))
  assert.equal(context.window.dataLayer[0].event, 'gtm.js')
  assert.deepEqual(inserted, [], 'nothing injected while the document is still loading')
  listeners.load.forEach((fn) => fn())
  assert.equal(inserted.length, 1)
  assert.match(inserted[0].src, /googletagmanager\.com\/gtm\.js\?id=GTM-TEST/)
  assert.equal(inserted[0].async, true)
  // Later interactions must not add a second container.
  listeners.pointerdown.forEach((fn) => fn())
  listeners.load.forEach((fn) => fn())
  assert.equal(inserted.length, 1)
})

test('an interaction before load brings the container in early, once', () => {
  const { inserted, listeners } = run({ readyState: 'loading' })
  listeners.keydown.forEach((fn) => fn())
  assert.equal(inserted.length, 1)
  listeners.scroll.forEach((fn) => fn())
  listeners.load.forEach((fn) => fn())
  assert.equal(inserted.length, 1)
})

test('a document that is already complete loads the container straight away', () => {
  const { inserted } = run({ readyState: 'complete' })
  assert.equal(inserted.length, 1)
})
