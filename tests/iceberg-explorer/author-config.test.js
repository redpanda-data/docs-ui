'use strict'

// An author's data-config that Redpanda would reject must not be replaced
// by defaults without a word: the bar keeps the author's string, says why
// it is invalid in a role=alert, offers nothing to copy, and logs a warning.
const test = require('node:test')
const assert = require('node:assert')
const { page, mount } = require('./helpers/dom')

test('an invalid data-config is shown with Redpanda\'s reason', async () => {
  const { mounts, warnings, ui } = await page(mount({ 'data-config': 'value:mode=schema_lastest' }))
  const u = ui(mounts[0])
  assert.strictEqual(u.config(), 'value:mode=schema_lastest')
  assert.strictEqual(u.q('[data-out="config-alert"]').getAttribute('role'), 'alert')
  assert.match(u.alert(), /unknown mode 'schema_lastest' in section 'value'/)
  assert.strictEqual(u.tag(), 'Not valid')
  assert.ok(u.copyButtons().every((b) => b.disabled))
  assert.strictEqual(u.checked('value.mode'), 'binary', 'controls show the defaults')
  assert.ok(warnings.some((w) => /data-config "value:mode=schema_lastest" is not a valid redpanda\.iceberg\.mode in v26\.2\.1: unknown mode/.test(w)), warnings.join('\n'))

  // The first change to a control replaces it with a string Redpanda accepts.
  u.pick('value.mode', 'schema_latest')
  assert.strictEqual(u.alert(), null)
  assert.strictEqual(u.config(), 'value_schema_latest')
  assert.ok(u.copyButtons().every((b) => !b.disabled))
})

test('each kind of upstream rejection reaches the bar', async () => {
  const cases = {
    'key:layout=nested': "layout is only valid in the value section, not 'key'",
    'value:mode=binary;value:mode=string': "duplicate section 'value'",
    'key_value:subject=x': "unknown section 'key_value'",
    'value:mode=binary,subject=x': "subject and protobuf_name require mode=schema_latest in section 'value'",
    'value_schema_latest:layout=nested': "unknown option 'layout' in value_schema_latest",
    'value:mode=': "malformed options in section 'value' (option 'mode' has no value)",
  }
  const { mounts, ui } = await page(Object.keys(cases).map((c) => mount({ 'data-config': c })).join(''))
  Object.values(cases).forEach((msg, i) => {
    const alert = ui(mounts[i]).alert()
    assert.ok(alert && alert.includes(msg), `${Object.keys(cases)[i]}: ${alert}`)
  })
})

test('a page for an older release offers only what its engine accepts', async () => {
  const { mounts, ui } = await page(
    mount({ 'data-version': '26.1', 'data-config': 'key:mode=string' }) +
    mount({ 'data-version': '25.1', 'data-config': 'value_schema_latest:subject=orders-value' }) +
    mount({ 'data-version': '24.3' }))
  const [a, b, c] = mounts.map(ui)
  // Releases before v26.2 only set failbit, so there is no reason to quote.
  assert.match(a.alert(), /Redpanda v26\.1\.1 does not accept this value/)
  assert.strictEqual(a.config(), 'key:mode=string')
  for (const u of [a, b, c]) {
    assert.strictEqual(u.q('[data-section="key"]'), null)
    assert.strictEqual(u.q('[data-section="headers"]'), null)
    assert.strictEqual(u.radios('value.layout').length, 0)
    assert.strictEqual(u.tag(), u === a ? 'Not valid' : '', 'no version tag')
  }
  assert.strictEqual(b.alert(), null)
  assert.strictEqual(b.config(), 'value_schema_latest:subject=orders-value')
  assert.deepStrictEqual(b.radios('value.mode').map((r) => r.value), ['binary', 'schema_id_prefix', 'schema_latest'])
  assert.deepStrictEqual(c.radios('value.mode').map((r) => r.value), ['binary', 'schema_id_prefix'])
  assert.strictEqual(c.input('value.subject'), null)
})

test('disabled is valid, shown as written, and explained', async () => {
  const { mounts, warnings, ui } = await page(mount({ 'data-config': 'disabled' }))
  const u = ui(mounts[0])
  assert.strictEqual(u.config(), 'disabled')
  assert.strictEqual(u.alert(), null)
  assert.match(u.q('[data-out="format-help"]').textContent, /Iceberg is off for the topic/)
  assert.ok(u.copyButtons().every((b) => !b.disabled))
  assert.deepStrictEqual(warnings, [])
})

test('the grammar follows the mount\'s data-version, never the nav\'s', async () => {
  // The nav can show another component (Connect 4.x, Cloud), so its version
  // says nothing about which Redpanda release the mount documents.
  const nav = '<div class="nav-container" data-version="24.3"></div>'
  const requested = []
  const { mounts, ui } = await page(nav + mount({ 'data-config': 'key:mode=string' }) + mount({ 'data-version': '24.3', 'data-config': 'key:mode=string' }), { requested })
  assert.strictEqual(ui(mounts[0]).alert(), null)
  assert.strictEqual(ui(mounts[0]).config(), 'key:mode=string;value:mode=binary,layout=flat;headers:value_type=binary')
  assert.match(ui(mounts[1]).alert(), /Redpanda v24\.3\.1 does not accept this value/)
  assert.deepStrictEqual(requested.sort(), ['/_/iceberg-engine-24.3.js', '/_/iceberg-engine.js'])
})
