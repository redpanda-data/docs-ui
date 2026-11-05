#!/usr/bin/env node
'use strict'

// Conformance test for the Iceberg Mode Explorer's config-string parser and
// builder (src/js/iceberg-explorer.js) against Redpanda's own test cases.
//
// The cases come from tests/iceberg-explorer/fixtures/upstream-vectors.js,
// which is copied from docs-extensions-and-macros and was extracted by hand
// from src/v/model/tests/iceberg_mode_test.cc in streaming-enterprise. It
// covers every IcebergModeFormat case and the parse, reject and normalize
// cases, but it is a hand-made copy, not a generated one: when upstream adds
// or changes a case, update the fixture (in both repos) and then the JS.
//
// This runs on every pull request. The scheduled job in
// .github/workflows/iceberg-dsl-conformance.yml also checks that each
// expected format string still appears in the upstream test file.

const { ICEBERG_MODE, build, parse, defaultsOf, init, MOUNT_SELECTOR } = require('../../src/js/iceberg-explorer.js')
const VECTORS = require('../iceberg-explorer/fixtures/upstream-vectors')

let failures = 0
let total = 0
function check (name, ok, detail) {
  total++
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) console.log('      ' + detail)
}

// Format: the string Redpanda writes for a config.
for (const v of VECTORS.format) {
  const parsed = v.input !== undefined ? parse(ICEBERG_MODE, v.input) : { cfg: Object.assign(defaultsOf(ICEBERG_MODE), v.fields), errors: [] }
  const got = parsed.errors.length ? 'rejected: ' + parsed.errors[0].message : build(ICEBERG_MODE, parsed.cfg).str
  check('format ' + v.test, got === v.expected, `expected ${v.expected}, got ${got}`)
}

// Reject: strings Redpanda refuses must not be accepted.
for (const v of VECTORS.reject) {
  const r = parse(ICEBERG_MODE, v.input)
  check('reject ' + v.test + ' ' + v.input, r.errors.length > 0, 'accepted')
}

// Error messages: Redpanda's wording.
for (const v of VECTORS.errorMessages) {
  const r = parse(ICEBERG_MODE, v.input)
  const msg = r.errors.length ? r.errors[0].message : '(accepted)'
  const ok = (v.exact === undefined || msg === v.exact) && (v.contains || []).every((c) => msg.includes(c))
  check('message ' + v.test, ok, `got "${msg}"`)
}

console.log(`\n${total - failures}/${total} conformance vectors passed`)
if (failures) {
  console.error('\nThe config-string parser or builder has drifted from the iceberg_mode_test.cc vectors.')
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
