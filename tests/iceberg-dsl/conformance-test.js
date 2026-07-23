#!/usr/bin/env node
'use strict'

// Conformance test for the Iceberg Mode Explorer's config-string builder.
//
// The DSL string is produced by pure JS in src/js/27-iceberg-explorer.js
// (buildConfigString). This test pins that JS to Redpanda's OWN format
// expectations, copied verbatim from the authoritative C++ unit test
// src/v/model/tests/iceberg_mode_test.cc (the IcebergModeFormat.* cases). If a
// future Redpanda release changes the DSL serialization, re-syncing these
// vectors from that test file (and updating the JS to match) is the single
// maintenance step — that is the "tracks releases" guarantee for the DSL,
// without needing to compile model.cc to WASM.
//
// CI can additionally fetch iceberg_mode_test.cc from a given redpanda ref and
// diff the expected strings to detect upstream format changes automatically.

const { buildConfigString } = require('../../src/js/27-iceberg-explorer.js')

// cfg shape matches getConfig() in the module.
function cfg (o) {
  return Object.assign({
    keyMode: 'binary', valMode: 'binary', valLayout: 'flat', hdrType: 'binary',
    keySubject: '', keyProto: '', valSubject: '', valProto: '',
  }, o)
}

// Each vector cites the corresponding C++ IcebergModeFormat test case.
const VECTORS = [
  // --- legacy strings (backward-compatible serialization) ---
  { name: 'KeyValue',
    cfg: cfg({}),
    expect: 'key_value' },
  { name: 'ValueSchemaIdPrefix',
    cfg: cfg({ valMode: 'schema_id_prefix' }),
    expect: 'value_schema_id_prefix' },
  { name: 'ValueSchemaLatestBare',
    cfg: cfg({ valMode: 'schema_latest' }),
    expect: 'value_schema_latest' },
  { name: 'ValueSchemaLatestWithSubject',
    cfg: cfg({ valMode: 'schema_latest', valSubject: 'my-topic-value' }),
    expect: 'value_schema_latest:subject=my-topic-value' },
  { name: 'ValueSchemaLatestWithProtobuf',
    cfg: cfg({ valMode: 'schema_latest', valProto: 'com.example.Msg', valSubject: 'my-topic-value' }),
    expect: 'value_schema_latest:protobuf_name=com.example.Msg,subject=my-topic-value' },
  // --- section-based format (new): all sections + options always emitted ---
  { name: 'NewKeySchema',
    cfg: cfg({ keyMode: 'schema_id_prefix' }),
    expect: 'key:mode=schema_id_prefix;value:mode=binary,layout=flat;headers:value_type=binary' },
  { name: 'NewHeadersString',
    cfg: cfg({ hdrType: 'string' }),
    expect: 'key:mode=binary;value:mode=binary,layout=flat;headers:value_type=string' },
]

let failures = 0
for (const v of VECTORS) {
  const got = buildConfigString(v.cfg).str
  const ok = got === v.expect
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${v.name}`)
  if (!ok) {
    console.log(`      expected: ${v.expect}`)
    console.log(`      got:      ${got}`)
  }
}

console.log(`\n${VECTORS.length - failures}/${VECTORS.length} conformance vectors passed`)
if (failures) {
  console.error('\nConfig-string DSL has drifted from iceberg_mode_test.cc vectors.')
  process.exit(1)
}
