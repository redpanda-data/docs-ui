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

const { buildConfigString, init, MOUNT_SELECTOR } = require('../../src/js/27-iceberg-explorer.js')

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


// --- Mount contract with docs-extensions-and-macros -------------------------
// The macro (macros/iceberg-explorer.js, MOUNT_ATTRIBUTE) marks its mount with
// `data-iceberg-explorer="<contract version>"`. Hydration must key on that
// attribute and nothing else: the class name changed once already and the UI
// silently found zero mounts. Drive init() with a stand-in document that
// serves exactly the markup the macro emits.
;(function mountContract () {
  var failures = 0
  if (MOUNT_SELECTOR !== '[data-iceberg-explorer]') {
    console.error('MOUNT_SELECTOR is ' + MOUNT_SELECTOR + ', expected [data-iceberg-explorer]')
    failures++
  }
  var macroMount = {
    attrs: { 'data-iceberg-explorer': '1', class: 'iceberg-explorer-mount' },
    getAttribute: function (k) { return this.attrs[k] === undefined ? null : this.attrs[k] },
    setAttribute: function (k, v) { this.attrs[k] = v },
    // hydrate() needs a real DOM; stop it at the first touch and record that
    // the mount was selected. Selection is what this check is about.
    get innerHTML () { throw new Error('selected') },
    set innerHTML (v) { throw new Error('selected') }
  }
  var asked = []
  var fakeDoc = { querySelectorAll: function (sel) { asked.push(sel); return sel === MOUNT_SELECTOR ? [macroMount] : [] } }
  var selected = false
  try { init(fakeDoc) } catch (e) { selected = /selected/.test(String(e)) || macroMount.attrs['data-hydrated'] === 'true' }
  if (!selected && macroMount.attrs['data-hydrated'] !== 'true') {
    console.error('init() did not select the macro mount; selectors asked: ' + JSON.stringify(asked))
    failures++
  }
  var legacy = { querySelectorAll: function (sel) { return sel === '.iceberg-explorer' ? [macroMount] : [] } }
  macroMount.attrs['data-hydrated'] = undefined
  var legacySelected = false
  try { init(legacy) } catch (e) { legacySelected = true }
  if (legacySelected || macroMount.attrs['data-hydrated'] === 'true') {
    console.error('init() still selects the retired .iceberg-explorer class')
    failures++
  }
  if (failures) process.exit(1)
  console.log('mount contract: init() selects ' + MOUNT_SELECTOR + ' and nothing else')
})()
