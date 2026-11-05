'use strict'

// Config strings the explorer shows and copies must be ones Redpanda accepts,
// and every valid string an author supplies must land on the controls. The
// accept/reject rules come from src/v/model/tests/iceberg_mode_test.cc.
const test = require('node:test')
const assert = require('node:assert')
const { ICEBERG_MODE: SPEC, build, parse, defaultsOf } = require('../../src/js/iceberg-explorer.js')

const cfg = (o) => Object.assign(defaultsOf(SPEC), o)
const buildConfigString = (c) => build(SPEC, c)
// The paths a string sets away from their defaults.
function parseConfigString (s) {
  const r = parse(SPEC, s)
  assert.deepStrictEqual(r.errors, [], s)
  const d = defaultsOf(SPEC)
  return Object.fromEntries(Object.entries(r.cfg).filter(([k, v]) => d[k] !== v))
}

test('layout=nested is dropped outside a schema value mode', () => {
  // ParseNestedWithBinaryRejected / ParseNestedWithStringRejected
  assert.strictEqual(buildConfigString(cfg({ 'value.layout': 'nested' })).str, 'key_value')
  assert.strictEqual(
    buildConfigString(cfg({ 'value.mode': 'string', 'value.layout': 'nested' })).str,
    'key:mode=binary;value:mode=string,layout=flat;headers:value_type=binary')
  assert.strictEqual(
    buildConfigString(cfg({ 'value.mode': 'schema_id_prefix', 'value.layout': 'nested' })).str,
    'key:mode=binary;value:mode=schema_id_prefix,layout=nested;headers:value_type=binary')
})

test('subject and protobuf_name are emitted only for schema_latest', () => {
  // SubjectWithSchemaIdPrefixMode / SubjectWithBinaryMode / ProtobufNameWithBinaryMode
  assert.strictEqual(
    buildConfigString(cfg({ 'value.mode': 'schema_id_prefix', 'value.subject': 'orders-value', 'value.protobuf_name': 'a.B' })).str,
    'value_schema_id_prefix')
  assert.strictEqual(
    buildConfigString(cfg({ 'key.mode': 'schema_id_prefix', 'key.subject': 'orders-key', 'key.protobuf_name': 'a.K' })).str,
    'key:mode=schema_id_prefix;value:mode=binary,layout=flat;headers:value_type=binary')
  assert.strictEqual(
    buildConfigString(cfg({ 'key.mode': 'schema_latest', 'key.subject': 'orders-key', 'value.mode': 'schema_latest', 'value.subject': 'orders-value' })).str,
    'key:mode=schema_latest,subject=orders-key;value:mode=schema_latest,subject=orders-value,layout=flat;headers:value_type=binary')
})

test('section strings with omitted sections are parsed', () => {
  assert.deepStrictEqual(parseConfigString('value:mode=schema_latest'), { 'value.mode': 'schema_latest' })
  assert.deepStrictEqual(parseConfigString('headers:value_type=string'), { 'headers.value_type': 'string' })
  assert.deepStrictEqual(parseConfigString('key:mode=schema_id_prefix'), { 'key.mode': 'schema_id_prefix' })
  assert.deepStrictEqual(
    parseConfigString('value:mode=schema_latest,subject=orders-value,protobuf_name=com.example.Msg,layout=nested'),
    { 'value.mode': 'schema_latest', 'value.subject': 'orders-value', 'value.protobuf_name': 'com.example.Msg', 'value.layout': 'nested' })
  assert.deepStrictEqual(
    parseConfigString('headers:value_type=string;key:mode=schema_latest,subject=orders-key'),
    { 'headers.value_type': 'string', 'key.mode': 'schema_latest', 'key.subject': 'orders-key' })
})

test('legacy strings are parsed, including their options', () => {
  assert.deepStrictEqual(parseConfigString('key_value'), {})
  assert.deepStrictEqual(parseConfigString('value_schema_id_prefix'), { 'value.mode': 'schema_id_prefix' })
  assert.deepStrictEqual(parseConfigString('value_schema_latest'), { 'value.mode': 'schema_latest' })
  assert.deepStrictEqual(
    parseConfigString('value_schema_latest:subject=my-topic-value,protobuf_name=com.example.Msg'),
    { 'value.mode': 'schema_latest', 'value.subject': 'my-topic-value', 'value.protobuf_name': 'com.example.Msg' })
})

test('parse inverts build for every option', () => {
  const full = cfg({
    'key.mode': 'schema_latest',
    'key.subject': 'k-sub',
    'key.protobuf_name': 'k.P',
    'value.mode': 'schema_latest',
    'value.subject': 'v-sub',
    'value.protobuf_name': 'v.P',
    'value.layout': 'nested',
    'headers.value_type': 'string',
  })
  assert.deepStrictEqual(cfg(parseConfigString(buildConfigString(full).str)), full)
  const legacy = cfg({ 'value.mode': 'schema_latest', 'value.subject': 'v-sub', 'value.protobuf_name': 'v.P' })
  assert.deepStrictEqual(cfg(parseConfigString(buildConfigString(legacy).str)), legacy)
})
