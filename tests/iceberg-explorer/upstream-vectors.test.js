'use strict'

// Replays Redpanda's own redpanda.iceberg.mode test cases (accept, reject,
// error messages, format and round trip) against the explorer's parser and
// builder, and checks that pages for older releases neither accept nor
// produce strings those releases reject.
const test = require('node:test')
const assert = require('node:assert')
const V = require('./fixtures/upstream-vectors')
const {
  ICEBERG_MODE: SPEC, ICEBERG_MODE_25_1: SPEC_25_1, ICEBERG_MODE_24_3: SPEC_24_3,
  specForVersion, parse, build, defaultsOf, fieldsOf,
} = require('../../src/js/27-iceberg-explorer.js')

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

test('the spec revision follows the page version', () => {
  for (const v of ['', 'master', 'beta', '26.2', 'v26.2', '26.2.1', '26.3', '27.1']) assert.strictEqual(specForVersion(v), SPEC, v)
  for (const v of ['25.1', 'v25.3', '26.1', '26.1.9']) assert.strictEqual(specForVersion(v), SPEC_25_1, v)
  for (const v of ['24.3', '24.2']) assert.strictEqual(specForVersion(v), SPEC_24_3, v)
})

test('older pages reject the section format with the version that added it', () => {
  for (const v of V.accept.filter((x) => ok(SPEC, x.input).form === 'sections')) {
    for (const [spec, version] of [[SPEC_25_1, '26.1'], [SPEC_24_3, '24.3']]) {
      const msg = parse(spec, v.input, { version }).errors[0].message
      assert.match(msg, new RegExp(`^the section format \\(key:, value:, headers:\\) requires Redpanda v26\\.2\\.1 or later, and this page documents ${version.replace('.', '\\.')}\\. Use one of: disabled, `), v.test)
    }
  }
  const msg = parse(SPEC_24_3, 'value_schema_latest:subject=s', { version: '24.3' }).errors[0].message
  assert.match(msg, /^value_schema_latest requires Redpanda v25\.1 or later, and this page documents 24\.3\. Use one of: disabled, key_value, or value_schema_id_prefix$/)
  assert.match(parse(SPEC_25_1, 'banana', { version: '25.3' }).errors[0].message, /^not a value Redpanda accepts in 25\.3\. Use one of: /)
})

test('older pages accept the legacy cases their release accepts, and only offer those', () => {
  for (const v of V.accept.filter((x) => ok(SPEC, x.input).form !== 'sections')) {
    const legacyLatest = v.input.startsWith('value_schema_latest')
    assert.deepStrictEqual(parse(SPEC_25_1, v.input).errors, [], v.test)
    assert.strictEqual(parse(SPEC_24_3, v.input).errors.length > 0, legacyLatest, v.test)
  }
  // Every combination the controls of an older page can produce is a legacy
  // name that release accepts.
  for (const [spec, names] of [[SPEC_25_1, /^(disabled|key_value|value_schema_id_prefix|value_schema_latest(:.*)?)$/], [SPEC_24_3, /^(disabled|key_value|value_schema_id_prefix)$/]]) {
    const enums = fieldsOf(spec).filter((e) => e.field.type === 'enum')
    assert.deepStrictEqual(enums.map((e) => e.path), ['value.mode'])
    for (const mode of enums[0].field.values.map((x) => x.value)) {
      for (const subject of ['', 's']) {
        const str = build(spec, { 'value.mode': mode, 'value.subject': subject }).str
        assert.match(str, names, `${mode}/${subject}`)
        assert.deepStrictEqual(parse(spec, str).errors, [], str)
      }
    }
  }
})

test('values Redpanda would split or cut short are rejected with a reason', () => {
  assert.match(parse(SPEC, 'value:mode=schema_latest,subject=a b').errors[0].message, /whitespace/)
  assert.match(parse(SPEC, ' key_value ').form, /legacy/)
  // ';' ends a section in the section format, but not in the legacy name.
  assert.deepStrictEqual(parse(SPEC, 'value_schema_latest:subject=a;b').errors, [])
  assert.ok(parse(SPEC, 'value:mode=schema_latest,subject=a;b').errors.length)
})
