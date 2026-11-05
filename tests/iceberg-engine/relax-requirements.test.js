'use strict'

// The engine must report the field requirements Redpanda writes to the
// table, not the ones in the source schema. record_translator.cc
// relax_field_requirements makes every key and value field optional (map
// keys excepted, which Iceberg requires) before the table is created, so a
// non-null Avro field is still an optional column.
//
// Needs the Node build of the engine: iceberg-editor/wasm/build.sh node
// (see iceberg-editor/README.md). Skipped when it has not been built.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const ENGINE = path.join(__dirname, '../../iceberg-editor/wasm/build/iceberg-engine-node.js')
const built = fs.existsSync(ENGINE)

const SCHEMA = JSON.stringify({
  type: 'record',
  name: 'order',
  fields: [
    { name: 'order_id', type: 'string' },
    { name: 'quantity', type: 'int' },
    { name: 'note', type: ['null', 'string'], default: null },
    { name: 'tags', type: { type: 'array', items: 'string' } },
    { name: 'counts', type: { type: 'map', values: 'long' } },
    {
      name: 'address',
      type: { type: 'record', name: 'address', fields: [{ name: 'city', type: 'string' }, { name: 'zip', type: 'int' }] },
    },
  ],
})

function walk (fields, out = []) {
  for (const f of fields) {
    out.push(f)
    if (f.fields) walk(f.fields, out)
  }
  return out
}

test('every field the engine reports is optional, as in the real table', { skip: !built && 'engine not built' }, async (t) => {
  const createIcebergEngine = require(ENGINE)
  const mod = await createIcebergEngine()
  // A release whose schema mapper is not built (ICEBERG_SCHEMA_MAPPER=0, or
  // one from before iceberg/conversion) has the parser only.
  if (typeof mod.avroToIcebergJson !== 'function') return t.skip('parser-only engine')
  const out = JSON.parse(mod.avroToIcebergJson(SCHEMA))
  assert.ok(!out.error, out.error)
  const all = walk(out.fields)
  assert.deepStrictEqual(all.map((f) => f.name), ['order_id', 'quantity', 'note', 'tags', 'counts', 'address', 'city', 'zip'])
  for (const f of all) assert.strictEqual(f.required, false, `${f.name} is required`)
  assert.strictEqual(all.find((f) => f.name === 'counts').type, 'map<string, long>')
})
