'use strict'

// Config strings the explorer shows and copies must be ones Redpanda accepts,
// and every valid string an author supplies must land on the controls. The
// accept/reject rules come from src/v/model/tests/iceberg_mode_test.cc.
const test = require('node:test')
const assert = require('node:assert')
const { buildConfigString, parseConfigString } = require('../../src/js/27-iceberg-explorer.js')

function cfg (o) {
  return Object.assign({
    keyMode: 'binary',
    valMode: 'binary',
    valLayout: 'flat',
    hdrType: 'binary',
    keySubject: '',
    keyProto: '',
    valSubject: '',
    valProto: '',
  }, o)
}

test('layout=nested is dropped outside a schema value mode', () => {
  // ParseNestedWithBinaryRejected / ParseNestedWithStringRejected
  assert.strictEqual(buildConfigString(cfg({ valLayout: 'nested' })).str, 'key_value')
  assert.strictEqual(
    buildConfigString(cfg({ valMode: 'string', valLayout: 'nested' })).str,
    'key:mode=binary;value:mode=string,layout=flat;headers:value_type=binary')
  assert.strictEqual(
    buildConfigString(cfg({ valMode: 'schema_id_prefix', valLayout: 'nested' })).str,
    'key:mode=binary;value:mode=schema_id_prefix,layout=nested;headers:value_type=binary')
})

test('subject and protobuf_name are emitted only for schema_latest', () => {
  // SubjectWithSchemaIdPrefixMode / SubjectWithBinaryMode / ProtobufNameWithBinaryMode
  assert.strictEqual(
    buildConfigString(cfg({ valMode: 'schema_id_prefix', valSubject: 'orders-value', valProto: 'a.B' })).str,
    'value_schema_id_prefix')
  assert.strictEqual(
    buildConfigString(cfg({ keyMode: 'schema_id_prefix', keySubject: 'orders-key', keyProto: 'a.K' })).str,
    'key:mode=schema_id_prefix;value:mode=binary,layout=flat;headers:value_type=binary')
  assert.strictEqual(
    buildConfigString(cfg({ keyMode: 'schema_latest', keySubject: 'orders-key', valMode: 'schema_latest', valSubject: 'orders-value' })).str,
    'key:mode=schema_latest,subject=orders-key;value:mode=schema_latest,subject=orders-value,layout=flat;headers:value_type=binary')
})

test('section strings with omitted sections are parsed', () => {
  assert.deepStrictEqual(parseConfigString('value:mode=schema_latest'), { valMode: 'schema_latest' })
  assert.deepStrictEqual(parseConfigString('headers:value_type=string'), { hdrType: 'string' })
  assert.deepStrictEqual(parseConfigString('key:mode=schema_id_prefix'), { keyMode: 'schema_id_prefix' })
  assert.deepStrictEqual(
    parseConfigString('value:mode=schema_latest,subject=orders-value,protobuf_name=com.example.Msg,layout=nested'),
    { valMode: 'schema_latest', valSubject: 'orders-value', valProto: 'com.example.Msg', valLayout: 'nested' })
  assert.deepStrictEqual(
    parseConfigString('headers:value_type=string;key:mode=schema_latest,subject=orders-key'),
    { hdrType: 'string', keyMode: 'schema_latest', keySubject: 'orders-key' })
})

test('legacy strings are parsed, including their options', () => {
  assert.deepStrictEqual(parseConfigString('key_value'), { valMode: 'binary' })
  assert.deepStrictEqual(parseConfigString('value_schema_id_prefix'), { valMode: 'schema_id_prefix' })
  assert.deepStrictEqual(parseConfigString('value_schema_latest'), { valMode: 'schema_latest' })
  assert.deepStrictEqual(
    parseConfigString('value_schema_latest:subject=my-topic-value,protobuf_name=com.example.Msg'),
    { valMode: 'schema_latest', valSubject: 'my-topic-value', valProto: 'com.example.Msg' })
})

test('parse inverts build for every option', () => {
  const full = cfg({
    keyMode: 'schema_latest',
    keySubject: 'k-sub',
    keyProto: 'k.P',
    valMode: 'schema_latest',
    valSubject: 'v-sub',
    valProto: 'v.P',
    valLayout: 'nested',
    hdrType: 'string',
  })
  assert.deepStrictEqual(cfg(parseConfigString(buildConfigString(full).str)), full)
  const legacy = cfg({ valMode: 'schema_latest', valSubject: 'v-sub', valProto: 'v.P' })
  assert.deepStrictEqual(cfg(parseConfigString(buildConfigString(legacy).str)), legacy)
})
