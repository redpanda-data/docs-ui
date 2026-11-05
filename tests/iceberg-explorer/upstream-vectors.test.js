'use strict'

// Replays Redpanda's own redpanda.iceberg.mode test cases (accept, reject,
// error messages, format and round trip) against the explorer's reader and
// builder, which put the engine's normalized strings on the controls and
// build the candidate strings the engine checks.
const test = require('node:test')
const assert = require('node:assert')
const V = require('./fixtures/upstream-vectors')
const { ICEBERG_MODE: SPEC, parse, build, defaultsOf } = require('../../src/js/iceberg-explorer.js')

const withFields = (fields) => Object.assign(defaultsOf(SPEC), fields)
const ok = (spec, s) => {
  const r = parse(spec, s)
  assert.deepStrictEqual(r.errors, [], `${s} was rejected: ${JSON.stringify(r.errors)}`)
  return r
}

test('every upstream accept case parses to the fields upstream asserts', () => {
  for (const v of V.accept) {
    const r = ok(SPEC, v.input)
    for (const [k, want] of Object.entries(v.expect)) {
      assert.strictEqual(r.cfg[k], want, `${v.test}: ${k}`)
    }
    if (v.equals) assert.strictEqual(build(SPEC, r.cfg).str, build(SPEC, ok(SPEC, v.equals).cfg).str, v.test)
  }
})

test('every upstream reject case is rejected', () => {
  for (const v of V.reject) {
    const r = parse(SPEC, v.input)
    assert.ok(r.errors.length > 0, `${v.test}: ${v.input} was accepted`)
    assert.deepStrictEqual(r.cfg, defaultsOf(SPEC), `${v.test}: an invalid string still set controls`)
  }
})

test('error messages match upstream', () => {
  for (const v of V.errorMessages) {
    const msg = parse(SPEC, v.input).errors[0].message
    if (v.exact) assert.strictEqual(msg, v.exact, v.test)
    for (const part of v.contains || []) assert.ok(msg.includes(part), `${v.test}: "${msg}" lacks "${part}"`)
  }
})

test('every upstream format case builds the string upstream writes', () => {
  for (const v of V.format) {
    const cfg = v.input !== undefined ? ok(SPEC, v.input).cfg : withFields(v.fields)
    assert.strictEqual(build(SPEC, cfg).str, v.expected, v.test)
  }
})

test('every upstream round trip is stable', () => {
  for (const v of V.roundtrip) {
    const cfg = v.input !== undefined ? ok(SPEC, v.input).cfg : withFields(v.fields)
    const once = build(SPEC, cfg).str
    const back = ok(SPEC, once).cfg
    assert.deepStrictEqual(back, cfg, v.test)
    assert.strictEqual(build(SPEC, back).str, once, `${v.test}: not a fixed point`)
  }
})

test('values Redpanda would split or cut short are rejected with a reason', () => {
  assert.match(parse(SPEC, 'value:mode=schema_latest,subject=a b').errors[0].message, /whitespace/)
  assert.match(parse(SPEC, ' key_value ').form, /legacy/)
  // ';' ends a section in the section format, but not in the legacy name.
  assert.deepStrictEqual(parse(SPEC, 'value_schema_latest:subject=a;b').errors, [])
  assert.ok(parse(SPEC, 'value:mode=schema_latest,subject=a;b').errors.length)
})
