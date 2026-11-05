'use strict'

// The WASM engine is wrapped in an adapter that detects its methods, and
// each engine file is loaded once per page and shared only by mounts that
// ask for the same file (same dir and version).
const test = require('node:test')
const assert = require('node:assert')
const { makeEngineAdapter } = require('../../src/js/iceberg-explorer.js')
const { page, mount } = require('./helpers/dom')

const FIELDS = [{ name: 'order_id', type: 'string', required: false }]

test('the adapter detects what an engine build offers', () => {
  assert.strictEqual(makeEngineAdapter(null), null)
  assert.strictEqual(makeEngineAdapter({}), null, 'a module with no known method is not an engine')
  const a = makeEngineAdapter({ avroToIcebergJson: () => JSON.stringify({ fields: FIELDS }) }, '/_/e.js')
  assert.deepStrictEqual(a.has, { avroToIceberg: true, parseIcebergMode: false, formatIcebergMode: false })
  assert.deepStrictEqual(a.valueFields, FIELDS)
  assert.strictEqual(a.source, '/_/e.js')
  const broken = makeEngineAdapter({ avroToIcebergJson: () => '{"error":"bad schema"}' })
  assert.strictEqual(broken.valueFields, null)
  assert.deepStrictEqual(broken.avroToIceberg('{}'), { error: 'bad schema' })
  const future = makeEngineAdapter({ parseIcebergMode: () => '{}' })
  assert.strictEqual(future.has.parseIcebergMode, true)
  assert.match(future.avroToIceberg('{}').error, /no avroToIcebergJson/)
})

// Serve engine scripts from a table: url -> fields (or null for a 404).
function engines (table, requested) {
  return (window) => {
    const head = window.document.head
    const append = head.appendChild.bind(head)
    head.appendChild = (el) => {
      if (el.tagName === 'SCRIPT' && el.src) {
        const url = new URL(el.src).pathname
        requested.push(url)
        setTimeout(() => {
          if (!(url in table)) return el.onerror()
          const fields = table[url]
          window.createIcebergEngine = () => Promise.resolve({ avroToIcebergJson: () => JSON.stringify({ fields }) })
          el.onload()
        })
        return el
      }
      return append(el)
    }
  }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

test('mounts share an engine per version and fall back per version', async () => {
  const requested = []
  const table = {
    '/_/iceberg-engine-26.2.js': [{ name: 'from_262', type: 'string', required: false }],
    '/_/iceberg-engine.js': [{ name: 'from_unversioned', type: 'string', required: false }],
  }
  const body = '<script src="/_/js/site.js"></script>' +
    mount({ 'data-version': '26.2', 'data-config': 'value_schema_id_prefix' }) +
    mount({ 'data-version': '26.2', 'data-config': 'value_schema_id_prefix' }) +
    mount({ 'data-version': '26.3', 'data-config': 'value_schema_id_prefix' })
  const { mounts, ui } = await page(body, { beforeEval: engines(table, requested) })
  await settle()
  const schemas = mounts.map((m) => ui(m).q('[data-out="schema"]').textContent)
  assert.match(schemas[0], /from_262/)
  assert.match(schemas[1], /from_262/)
  assert.match(schemas[2], /from_unversioned/, 'a 26.3 page must not use the 26.2 engine')
  assert.strictEqual(ui(mounts[0]).q('[data-out="engine"]').textContent, 'real engine · wasm')
  // One request per file, not one per mount.
  assert.deepStrictEqual(requested.sort(), ['/_/iceberg-engine-26.2.js', '/_/iceberg-engine-26.3.js', '/_/iceberg-engine.js'])
})

test('engine fields are shown as the engine returns them, optional included', async () => {
  const requested = []
  const table = { '/_/iceberg-engine.js': [{ name: 'opt', type: 'int', required: false }, { name: 'req', type: 'int', required: true }] }
  const { mounts, ui } = await page('<script src="/_/js/site.js"></script>' + mount({ 'data-config': 'value_schema_id_prefix' }), { beforeEval: engines(table, requested) })
  await settle()
  const schema = ui(mounts[0]).q('[data-out="schema"]').textContent
  assert.match(schema, /opt: int optional/)
  assert.match(schema, /req: int required/)
})
