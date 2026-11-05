'use strict'

// The explorer in a real DOM (jsdom): hydration of fixture mounts, isolation
// between mounts, bad input, the mount contract, Copy, enable state and
// hints, and round trips from the controls to the string and back.
const test = require('node:test')
const assert = require('node:assert')
const { ICEBERG_MODE, parse, fieldsOf } = require('../../src/js/iceberg-explorer.js')
const { page, mount, FALLBACK } = require('./helpers/dom')

const MODES = ['binary', 'string', 'schema_id_prefix', 'schema_latest']

test('hydration replaces the fallback and marks the mount', async () => {
  const { mounts, warnings, ui } = await page(mount({ 'data-iceberg-explorer': '1', 'data-property': null }) + mount())
  for (const m of mounts) {
    assert.strictEqual(m.getAttribute('data-hydrated'), 'true')
    assert.ok(!m.querySelector('.iceberg-explorer-fallback'))
    assert.ok(m.querySelector('.ice-grid'))
    assert.strictEqual(ui(m).config(), 'key_value')
    assert.strictEqual(ui(m).tag(), 'Works on all versions')
  }
  assert.deepStrictEqual(warnings, [])
})

test('mounts the build does not understand keep their fallback, and the rest still hydrate', async () => {
  const { mounts, warnings } = await page(
    mount({ 'data-iceberg-explorer': '3' }) +
    mount({ 'data-property': 'redpanda.iceberg.partition.spec' }) +
    // Quotes and backslashes in author input must never reach a selector.
    mount({ 'data-config': 'value:mode=sch"ema\\_latest' }) +
    mount())
  assert.strictEqual(mounts[0].getAttribute('data-hydrated'), 'skipped')
  assert.strictEqual(mounts[0].innerHTML, FALLBACK)
  assert.strictEqual(mounts[1].getAttribute('data-hydrated'), 'skipped')
  assert.strictEqual(mounts[1].innerHTML, FALLBACK)
  assert.strictEqual(mounts[2].getAttribute('data-hydrated'), 'true')
  assert.strictEqual(mounts[3].getAttribute('data-hydrated'), 'true')
  assert.ok(warnings.some((w) => /contract version "3"/.test(w)))
  assert.ok(warnings.some((w) => /data-property "redpanda\.iceberg\.partition\.spec"/.test(w)))
})

test('two mounts share no ids, radio groups or state', async () => {
  const { doc, mounts, ui } = await page(mount() + mount())
  const ids = [...doc.querySelectorAll('[id]')].map((e) => e.id)
  assert.strictEqual(new Set(ids).size, ids.length, 'duplicate ids on the page')
  const names = mounts.map((m) => new Set([...m.querySelectorAll('input[type="radio"]')].map((r) => r.name)))
  for (const n of names[0]) assert.ok(!names[1].has(n), `radio group ${n} spans both mounts`)
  // Every reference to an id resolves inside the same mount.
  for (const m of mounts) {
    for (const el of m.querySelectorAll('[for], [aria-describedby], [aria-labelledby]')) {
      const refs = [el.getAttribute('for'), el.getAttribute('aria-describedby'), el.getAttribute('aria-labelledby')].filter(Boolean).join(' ').split(/\s+/)
      for (const id of refs) assert.ok(m.querySelector(`[id="${id}"]`), `${id} is not in the same mount`)
    }
  }
  const [a, b] = mounts.map(ui)
  a.pick('value.mode', 'schema_latest')
  a.type('value.subject', 'orders-value')
  assert.strictEqual(a.config(), 'value_schema_latest:subject=orders-value')
  assert.strictEqual(b.config(), 'key_value')
  assert.strictEqual(b.checked('value.mode'), 'binary')
  assert.strictEqual(b.input('value.subject').value, '')
})

test('controls a mode does not allow are disabled with a hint, and keep their values', async () => {
  const { mounts, ui } = await page(mount())
  const u = ui(mounts[0])
  const subject = u.input('value.subject')
  const hint = u.q('[data-hint="value.subject"]')
  const layoutHint = u.q('[data-hint="value.layout"]')
  const layoutSet = u.q('[data-fieldset="value.layout"]')
  assert.ok(subject.disabled)
  assert.ok(!hint.hidden)
  assert.strictEqual(hint.textContent, 'Only with schema_latest')
  assert.ok(subject.getAttribute('aria-describedby').split(' ').includes(hint.id))
  assert.ok(u.radios('value.layout').every((r) => r.disabled))
  assert.ok(!layoutHint.hidden)
  assert.ok(layoutSet.getAttribute('aria-describedby').split(' ').includes(layoutHint.id))
  assert.strictEqual(u.q('[data-help="value.layout"]').textContent, '', 'a disabled group shows its hint, not help')

  u.pick('value.mode', 'schema_latest')
  assert.ok(!subject.disabled)
  assert.ok(hint.hidden)
  assert.ok(!(subject.getAttribute('aria-describedby') || '').includes(hint.id), 'a hidden hint is still described')
  u.type('value.subject', 'orders-value')
  u.pick('value.layout', 'nested')
  assert.strictEqual(u.config(), 'key:mode=binary;value:mode=schema_latest,subject=orders-value,layout=nested;headers:value_type=binary')
  assert.strictEqual(u.q('[data-help="value.layout"]').textContent, 'Value fields go in one value struct column.')

  // Away and back: the string drops them, the controls keep them.
  u.pick('value.mode', 'binary')
  assert.strictEqual(u.config(), 'key_value')
  u.pick('value.mode', 'schema_latest')
  assert.strictEqual(u.input('value.subject').value, 'orders-value')
  assert.strictEqual(u.checked('value.layout'), 'nested')
  assert.match(u.config(), /subject=orders-value,layout=nested/)
})

test('a text value Redpanda would split marks the field and turns Copy off', async () => {
  const { mounts, ui } = await page(mount({ 'data-config': 'value:mode=schema_latest,layout=nested' }))
  const u = ui(mounts[0])
  u.type('value.subject', 'a,b')
  assert.strictEqual(u.input('value.subject').getAttribute('aria-invalid'), 'true')
  assert.match(u.q('[data-error="value.subject"]').textContent, /comma/)
  assert.strictEqual(u.tag(), 'Not valid')
  assert.ok(u.copyButtons().every((b) => b.disabled))
  assert.strictEqual(u.alert(), null, 'a field problem is not the author alert')
  u.type('value.subject', 'a=b')
  assert.strictEqual(u.input('value.subject').getAttribute('aria-invalid'), null)
  assert.strictEqual(u.q('[data-error="value.subject"]').className, 'ice-note')
  assert.ok(u.copyButtons().every((b) => !b.disabled))
})

function clipboard (window, impl) {
  Object.defineProperty(window.navigator, 'clipboard', { value: impl, configurable: true })
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test('Copy writes the stored string, not the markup, and reports failure', async () => {
  const { window, mounts, ui } = await page(mount({ 'data-config': 'key:mode=schema_id_prefix;value:mode=schema_latest,layout=nested;headers:value_type=string' }))
  const u = ui(mounts[0])
  assert.match(u.configHtml(), /<wbr>/)
  const written = []
  clipboard(window, { writeText: (t) => { written.push(t); return Promise.resolve() } })
  const [copy, rpk] = u.copyButtons()
  copy.click()
  await tick()
  assert.deepStrictEqual(written, ['key:mode=schema_id_prefix;value:mode=schema_latest,layout=nested;headers:value_type=string'])
  assert.strictEqual(copy.textContent, 'Copied!')
  assert.strictEqual(u.q('[data-out="copy-status"]').textContent, 'Copied the config string')
  rpk.click()
  await tick()
  assert.strictEqual(written[1], "rpk topic alter-config <topic-name> --set 'redpanda.iceberg.mode=" + written[0] + "'")
  assert.strictEqual(copy.textContent, 'Copy', 'the other button is reset')

  clipboard(window, { writeText: () => Promise.reject(new Error('denied')) })
  copy.click()
  await tick()
  assert.strictEqual(copy.textContent, 'Copy failed')
  assert.strictEqual(u.q('[data-out="copy-status"]').textContent, 'Could not copy the config string')
  clipboard(window, undefined)
  copy.click()
  await tick()
  assert.strictEqual(copy.textContent, 'Copy failed', 'no clipboard API is a failure, not "Copied!"')
})

test('every control state round-trips through the string', async () => {
  const { mounts, ui } = await page(mount())
  const u = ui(mounts[0])
  const seen = new Set()
  for (const k of MODES) {
    for (const v of MODES) {
      for (const layout of ['flat', 'nested']) {
        for (const h of ['binary', 'string']) {
          for (const subject of ['', 'orders']) {
            u.pick('key.mode', k)
            u.pick('value.mode', v)
            if (!u.radios('value.layout')[0].disabled) u.pick('value.layout', layout)
            u.pick('headers.value_type', h)
            u.type('value.subject', subject)
            u.type('key.protobuf_name', subject && 'a.K')
            const str = u.config()
            const parsed = parse(ICEBERG_MODE, str)
            assert.deepStrictEqual(parsed.errors, [], str)
            // What the controls mean equals what the string says.
            for (const e of fieldsOf(ICEBERG_MODE)) {
              const control = e.field.type === 'enum' ? u.checked(e.path) : u.input(e.path).value
              const applies = !u.q(`[data-path="${e.path}"]`).disabled
              assert.strictEqual(parsed.cfg[e.path], applies ? control : e.field.default, `${str}: ${e.path}`)
            }
            seen.add(str)
          }
        }
      }
    }
  }
  assert.strictEqual(seen.size, 72, `${seen.size} distinct strings`)
  // And a mount given each string as data-config shows the same string.
  const strings = [...seen]
  const again = await page(strings.map((s) => mount({ 'data-config': s })).join(''))
  again.mounts.forEach((m, i) => assert.strictEqual(again.ui(m).config(), strings[i]))
  assert.deepStrictEqual(again.warnings, [])
})
