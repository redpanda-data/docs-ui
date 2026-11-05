'use strict'

// Which choices a page offers comes from its release's engine, not from a
// table of versions: probeSpec builds the string each choice makes and keeps
// the ones the engine accepts.
const test = require('node:test')
const assert = require('node:assert')
const { ICEBERG_MODE: SPEC, probeSpec, makeEngineAdapter, engineProblem, build, parse, fieldsOf } = require('../../src/js/iceberg-explorer.js')
const fake = require('./helpers/fake-engine')

const adapter = (mod) => makeEngineAdapter(mod, '/_/e.js')
const shape = (spec) => Object.fromEntries(fieldsOf(spec).map((e) => [e.path, e.field.type === 'enum' ? e.field.values.map((v) => v.value) : 'text']))

test('a release with the section format is offered every choice', () => {
  assert.deepStrictEqual(shape(probeSpec(SPEC, adapter(fake.sections()))), shape(SPEC))
})

test('older releases are offered only the choices their parser accepts', () => {
  assert.deepStrictEqual(shape(probeSpec(SPEC, adapter(fake.legacy('v25.1.1', { schemaLatest: true })))), {
    'value.mode': ['binary', 'schema_id_prefix', 'schema_latest'],
    'value.subject': 'text',
    'value.protobuf_name': 'text',
  })
  assert.deepStrictEqual(shape(probeSpec(SPEC, adapter(fake.legacy('v24.3.1')))), { 'value.mode': ['binary', 'schema_id_prefix'] })
})

test('every string an older page can build is one its engine accepts', () => {
  for (const mod of [fake.legacy('v25.1.1', { schemaLatest: true }), fake.legacy('v24.3.1')]) {
    const e = adapter(mod)
    const spec = probeSpec(SPEC, e)
    for (const v of fieldsOf(spec).find((x) => x.path === 'value.mode').field.values) {
      for (const subject of ['', 's']) {
        const str = build(spec, { 'value.mode': v.value, 'value.subject': subject }).str
        assert.ok(e.parseMode(str).ok, `${e.info.redpanda_ref}: ${str}`)
        assert.deepStrictEqual(parse(spec, str).errors, [], str)
      }
    }
  }
})

test('a choice the engine rejects drops its dependants', () => {
  // An engine that knows schema_latest but not subject or protobuf_name.
  const base = fake.sections()
  const noSubject = Object.assign({}, base, {
    parseIcebergMode: (s) => /subject=|protobuf_name=/.test(s) ? '{"ok":false}' : base.parseIcebergMode(s),
  })
  const spec = probeSpec(SPEC, adapter(noSubject))
  assert.ok(!fieldsOf(spec).some((e) => e.field.name === 'subject' || e.field.name === 'protobuf_name'))
  assert.deepStrictEqual(shape(spec)['value.layout'], ['flat', 'nested'])
})

test('a grammar engine must come from the release the mount documents', () => {
  const e262 = adapter(fake.sections('v26.2.4'))
  assert.strictEqual(engineProblem(e262, '26.2'), null)
  assert.strictEqual(engineProblem(e262, 'v26.2.1'), null)
  assert.strictEqual(engineProblem(e262, ''), null, 'an unversioned mount takes the page\'s engine')
  assert.strictEqual(engineProblem(e262, 'beta'), null)
  assert.match(engineProblem(e262, '26.3'), /built from v26\.2\.4, not 26\.3/)
  assert.match(engineProblem(null, '26.1'), /no Iceberg engine could be loaded for version 26\.1/)
  const schemaOnly = adapter({ avroToIcebergJson: () => '{"fields":[]}' })
  assert.match(engineProblem(schemaOnly, ''), /has no parseIcebergMode/)
})
