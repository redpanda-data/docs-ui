'use strict'

// init() must never let one mount break the page: an unknown contract keeps
// its fallback, a mount that throws during rendering gets its fallback back,
// and the loop carries on to the next mount either way.
const test = require('node:test')
const assert = require('node:assert')
const { init, mountProblem } = require('../../src/js/27-iceberg-explorer.js')

const FALLBACK = '<p class="iceberg-explorer-fallback">Interactive Iceberg Mode Explorer.</p>'

// Just enough of an element for init(): attributes and innerHTML. Rendering
// calls querySelector, which throws here, standing in for any render error.
function mount (attrs) {
  const a = Object.assign({}, attrs)
  const el = {
    renders: 0,
    _html: FALLBACK,
    get innerHTML () { return this._html },
    set innerHTML (v) { if (v !== FALLBACK) this.renders++; this._html = v },
    getAttribute: (k) => (k in a ? a[k] : null),
    setAttribute: (k, v) => { a[k] = String(v) },
    querySelector () { throw new SyntaxError('boom') },
    querySelectorAll () { throw new SyntaxError('boom') },
    attrs: a,
  }
  return el
}
function doc (mounts) {
  return { querySelectorAll: () => mounts }
}
function withWarnings (fn) {
  const seen = []
  const orig = console.warn
  console.warn = (m) => seen.push(String(m))
  try { fn() } finally { console.warn = orig }
  return seen
}

test('contract versions 1 and 2 are accepted, anything else is refused', () => {
  assert.strictEqual(mountProblem(mount({ 'data-iceberg-explorer': '1' })), null)
  assert.strictEqual(mountProblem(mount({ 'data-iceberg-explorer': '2' })), null)
  assert.strictEqual(mountProblem(mount({ 'data-iceberg-explorer': '2', 'data-property': 'redpanda.iceberg.mode' })), null)
  assert.match(mountProblem(mount({ 'data-iceberg-explorer': '2', 'data-property': 'redpanda.iceberg.partition.spec' })), /data-property/)
  for (const v of ['3', '', 'true', '1.0']) {
    assert.match(mountProblem(mount({ 'data-iceberg-explorer': v })), /contract version/, JSON.stringify(v))
  }
})

test('a mount that fails to render keeps its fallback and later mounts still run', () => {
  const first = mount({ 'data-iceberg-explorer': '1' })
  const unknown = mount({ 'data-iceberg-explorer': '9' })
  const last = mount({ 'data-iceberg-explorer': '2' })
  const warnings = withWarnings(() => assert.doesNotThrow(() => init(doc([first, unknown, last]))))

  assert.strictEqual(first.renders, 1, 'first mount was not attempted')
  assert.strictEqual(first.innerHTML, FALLBACK)
  assert.strictEqual(first.attrs['data-hydrated'], 'failed')

  assert.strictEqual(unknown.renders, 0, 'a mount with an unknown contract was rendered')
  assert.strictEqual(unknown.innerHTML, FALLBACK)
  assert.strictEqual(unknown.attrs['data-hydrated'], 'skipped')

  assert.strictEqual(last.renders, 1, 'init stopped after the failing mount')
  assert.strictEqual(last.innerHTML, FALLBACK)

  assert.strictEqual(warnings.length, 3)
  assert.ok(warnings.every((w) => w.startsWith('iceberg-explorer: ')))
  assert.match(warnings[1], /contract version "9"/)
})

test('a mount is only tried once', () => {
  const m = mount({ 'data-iceberg-explorer': '1' })
  withWarnings(() => { init(doc([m])); init(doc([m])) })
  assert.strictEqual(m.renders, 1)
})
