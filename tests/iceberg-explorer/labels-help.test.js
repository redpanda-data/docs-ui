'use strict'

// Labels, help text and copy helpers must describe what Redpanda does.
const test = require('node:test')
const assert = require('node:assert')
const { execFileSync } = require('child_process')
const {
  ICEBERG_MODE: SPEC, template, rpkCommand, valueProblem, formatInfo, build, fieldsOf, defaultsOf,
} = require('../../src/js/iceberg-explorer.js')

const html = template(SPEC, 'ice3')
const optionValueProblem = (v, sectionForm) => valueProblem(SPEC, v, sectionForm)
const buildConfigString = (c) => build(SPEC, c)
// The help line for each choice of each choice field, from the spec.
const CHOICE_HELP = Object.fromEntries(fieldsOf(SPEC).filter((e) => e.field.type === 'enum')
  .map((e) => [e.path, Object.fromEntries(e.field.values.map((v) => [v.value, v.help]))]))

test('the config bar names the property', () => {
  assert.match(html, /<code class="ice-prop">redpanda\.iceberg\.mode<\/code>/)
})

test('no warning-style or unexplained tags remain', () => {
  const js = require('fs').readFileSync(require.resolve('../../src/js/iceberg-explorer.js'), 'utf8')
  for (const s of ['legacy format', 'new format', 'preview engine']) assert.ok(!js.includes(s), s)
  assert.match(html, /fixed Avro key and value schema/)
})

test('every choice in every group has one line of help', () => {
  for (const group of Object.keys(CHOICE_HELP)) {
    const values = [...html.matchAll(new RegExp(`data-path="${group}" value="([^"]+)"`, 'g'))].map((m) => m[1])
    assert.ok(values.length > 1, group)
    assert.deepStrictEqual(Object.keys(CHOICE_HELP[group]).sort(), values.sort(), group)
    for (const v of values) assert.ok(!/\n/.test(CHOICE_HELP[group][v]) && CHOICE_HELP[group][v].length < 120, `${group}=${v}`)
    assert.match(html, new RegExp(`data-help="${group}"`))
  }
})

const cfg = (o) => Object.assign(defaultsOf(SPEC), o)

test('the version tag follows the form the builder chose', () => {
  assert.strictEqual(formatInfo(SPEC, buildConfigString(cfg({}))).tag, 'Works on all versions')
  assert.strictEqual(formatInfo(SPEC, buildConfigString(cfg({ 'value.mode': 'schema_id_prefix' }))).tag, 'Works on all versions')
  assert.strictEqual(formatInfo(SPEC, buildConfigString(cfg({ 'value.mode': 'schema_latest', 'value.subject': 's' }))).tag, 'Requires v25.1 or later')
  for (const o of [{ 'key.mode': 'string' }, { 'headers.value_type': 'string' }, { 'value.mode': 'string' }, { 'value.mode': 'schema_latest', 'value.layout': 'nested' }]) {
    const b = buildConfigString(cfg(o))
    assert.strictEqual(b.legacy, false, JSON.stringify(o))
    assert.strictEqual(formatInfo(SPEC, b).tag, 'Requires v26.2.1 or later', b.str)
  }
})

test('subject and protobuf_name values Redpanda rejects are flagged', () => {
  assert.strictEqual(optionValueProblem('orders-value', true), null)
  assert.strictEqual(optionValueProblem('com.example.Order', false), null)
  assert.ok(optionValueProblem('a,b', false).error)
  assert.ok(optionValueProblem('a,b', true).error)
  assert.ok(optionValueProblem('a b', false).error)
  assert.ok(optionValueProblem('a\tb', true).error)
  // ';' splits sections, but the legacy value_schema_latest form is not split.
  assert.ok(optionValueProblem('a;b', true).error)
  assert.strictEqual(optionValueProblem('a;b', false), null)
  // Only the first '=' separates the option name, so '=' is accepted.
  const eq = optionValueProblem('a=b', true)
  assert.ok(eq && eq.note && !eq.error)
})

test('the rpk command passes the value to --set as one shell word', () => {
  for (const value of [
    'key:mode=schema_id_prefix;value:mode=schema_latest,layout=nested;headers:value_type=string',
    "value_schema_latest:subject=it's",
    'key_value',
  ]) {
    const cmd = rpkCommand(value)
    assert.ok(cmd.startsWith('rpk topic alter-config <topic-name> --set '), cmd)
    const arg = cmd.slice('rpk topic alter-config <topic-name> --set '.length)
    const out = execFileSync('/bin/sh', ['-c', 'printf "%s|" ' + arg + '; printf "%s" "$#"', 'sh'], { encoding: 'utf8' })
    assert.strictEqual(out, 'redpanda.iceberg.mode=' + value + '|0', cmd)
  }
})
