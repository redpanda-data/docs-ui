'use strict'

// The WASM engine is wrapped in an adapter that detects its methods, and
// each engine file is loaded once per page and shared only by mounts that
// ask for the same file (same dir and version).
const test = require('node:test')
const assert = require('node:assert')
const { makeEngineAdapter } = require('../../src/js/iceberg-explorer.js')
const { page, mount } = require('./helpers/dom')
const fake = require('./helpers/fake-engine')

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
  assert.deepStrictEqual(future.info, {}, 'an engine without icebergEngineInfo names no release')
  assert.match(broken.parseMode('key_value').error, /no parseIcebergMode/)
})

test('parseMode returns the engine\'s verdict, asks once per string, and survives bad output', () => {
  let calls = 0
  const a = makeEngineAdapter(Object.assign(fake.sections('v26.2.4'), {
    parseIcebergMode: (s) => { calls++; return s === 'boom' ? 'not json' : fake.sections().parseIcebergMode(s) },
  }))
  assert.deepStrictEqual(a.info, { redpanda_ref: 'v26.2.4', redpanda_commit: '0'.repeat(40) })
  assert.deepStrictEqual(a.parseMode('value:mode=schema_id_prefix'), { ok: true, normalized: 'value_schema_id_prefix', extended: false })
  a.parseMode('value:mode=schema_id_prefix')
  assert.strictEqual(calls, 1)
  assert.strictEqual(a.parseMode('boom').ok, false)
})

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))
const withFields = (ref, fields) => fake.sections(ref, { avroToIcebergJson: () => JSON.stringify({ fields }) })

test('mounts share an engine per version, and never use another release\'s', async () => {
  const requested = []
  const engines = {
    'iceberg-engine-26.2.js': withFields('v26.2.4', [{ name: 'from_262', type: 'string', required: false }]),
    'iceberg-engine-26.3.js': null,
    'iceberg-engine.js': withFields('v26.2.4', [{ name: 'from_unversioned', type: 'string', required: false }]),
  }
  const body = '<script src="/_/js/site.js"></script>' +
    mount({ 'data-version': '26.2', 'data-config': 'value_schema_id_prefix' }) +
    mount({ 'data-version': '26.2', 'data-config': 'value_schema_id_prefix' }) +
    mount({ 'data-version': '26.3', 'data-config': 'value_schema_id_prefix' }) +
    mount({ 'data-config': 'value_schema_id_prefix' })
  const { mounts, ui, warnings } = await page(body, { engines, requested })
  await settle()
  assert.match(ui(mounts[0]).q('[data-out="schema"]').textContent, /from_262/)
  assert.match(ui(mounts[1]).q('[data-out="schema"]').textContent, /from_262/)
  assert.strictEqual(ui(mounts[0]).q('[data-out="engine"]').textContent, 'real engine · wasm')
  // 26.3 has no engine of its own, and the unversioned one is v26.2.4.
  assert.strictEqual(mounts[2].getAttribute('data-hydrated'), 'no-engine')
  assert.ok(mounts[2].querySelector('.iceberg-explorer-fallback'))
  assert.ok(warnings.some((w) => /built from v26\.2\.4, not 26\.3/.test(w)), warnings.join('\n'))
  assert.match(ui(mounts[3]).q('[data-out="schema"]').textContent, /from_unversioned/)
  // One request per file, not one per mount.
  assert.deepStrictEqual(requested.sort(), ['/_/iceberg-engine-26.2.js', '/_/iceberg-engine-26.3.js', '/_/iceberg-engine.js'])
})

test('the layout\'s engine attachment is tried before the UI root', async () => {
  const requested = []
  const head = '<meta name="iceberg-engine-url" content="/streaming/current/reference/_attachments/iceberg-engine-26.2.js">'
  const { mounts } = await page(head + mount({ 'data-version': '26.2' }), { requested })
  assert.strictEqual(mounts[0].getAttribute('data-hydrated'), 'true')
  assert.deepStrictEqual(requested, ['/streaming/current/reference/_attachments/iceberg-engine-26.2.js'])
  // An attachment for another version, or another origin, is not used.
  for (const content of ['/streaming/26.1/reference/_attachments/iceberg-engine-26.1.js', '//evil.example/iceberg-engine-26.2.js']) {
    const seen = []
    await page(`<meta name="iceberg-engine-url" content="${content}">` + mount({ 'data-version': '26.2' }), { requested: seen })
    assert.deepStrictEqual(seen, ['/_/iceberg-engine-26.2.js'], content)
  }
})

test('a mount with no version uses the layout\'s engine, whatever its release', async () => {
  const requested = []
  const head = '<meta name="iceberg-engine-url" content="/streaming/current/reference/_attachments/iceberg-engine-26.2.js">'
  const { mounts } = await page(head + mount({ 'data-config': 'value_schema_id_prefix' }), { requested })
  assert.strictEqual(mounts[0].getAttribute('data-hydrated'), 'true')
  assert.strictEqual(requested[0], '/streaming/current/reference/_attachments/iceberg-engine-26.2.js')
})

test('without an engine the mount keeps its fallback text', async () => {
  const { mounts, warnings } = await page(mount({ 'data-version': '26.2' }), { engines: { 'iceberg-engine-26.2.js': null, 'iceberg-engine.js': null } })
  assert.strictEqual(mounts[0].getAttribute('data-hydrated'), 'no-engine')
  assert.ok(mounts[0].querySelector('.iceberg-explorer-fallback'))
  assert.ok(warnings.some((w) => /no Iceberg engine could be loaded for version 26\.2/.test(w)))
})

test('engine fields are shown as the engine returns them, optional included', async () => {
  const engines = { 'iceberg-engine.js': withFields('v26.2.1', [{ name: 'opt', type: 'int', required: false }, { name: 'req', type: 'int', required: true }]) }
  const { mounts, ui } = await page('<script src="/_/js/site.js"></script>' + mount({ 'data-config': 'value_schema_id_prefix' }), { engines })
  const schema = ui(mounts[0]).q('[data-out="schema"]').textContent
  assert.match(schema, /opt: int optional/)
  assert.match(schema, /req: int required/)
})
