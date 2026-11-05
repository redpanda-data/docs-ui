'use strict'

// Accessibility semantics of the explorer markup and the helpers it uses.
const test = require('node:test')
const assert = require('node:assert')
const { ICEBERG_MODE: SPEC, template, copyText, isEnabled, enabledHintFor, build, fieldsOf } = require('../../src/js/27-iceberg-explorer.js')

const html = template(SPEC, 'ice9')
const entry = (path) => fieldsOf(SPEC).find((e) => e.path === path)
const optionEnabled = (option, section, mode) => isEnabled(entry(`${section}.${option}`), { [`${section}.mode`]: mode })
const visible = (s) => s.replace(/<span class="ice-sr">[^<]*<\/span>/g, '')
const text = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

test('every radio group is a fieldset whose legend names its section', () => {
  const legends = [...html.matchAll(/<fieldset[^>]*>\s*<legend[^>]*>([\s\S]*?)<\/legend>/g)].map((m) => text(m[1]))
  assert.deepStrictEqual(legends, ['Key Mode', 'Value Mode', 'Value Layout', 'Headers Value type'])
  const radios = (html.match(/type="radio"/g) || []).length
  const inFieldsets = [...html.matchAll(/<fieldset[\s\S]*?<\/fieldset>/g)].reduce((n, m) => n + (m[0].match(/type="radio"/g) || []).length, 0)
  assert.strictEqual(inFieldsets, radios, 'a radio sits outside a fieldset')
})

test('every text input has a label with its section', () => {
  const inputs = [...html.matchAll(/<input type="text" id="([^"]+)"/g)].map((m) => m[1])
  assert.strictEqual(inputs.length, 4)
  const names = inputs.map((id) => {
    const m = new RegExp(`<label for="${id}">([\\s\\S]*?)</label>`).exec(html)
    assert.ok(m, `no label for ${id}`)
    return text(m[1])
  })
  assert.deepStrictEqual(names, ['Key subject', 'Key protobuf_name', 'Value subject', 'Value protobuf_name'])
  assert.strictEqual(new Set(inputs).size, inputs.length)
  // The section word is for screen readers; the card heading shows it.
  assert.ok(!/>Key subject</.test(visible(html)))
})

test('only the config string is a live region, and Copy has a status', () => {
  const live = [...html.matchAll(/<(\w+)[^>]*aria-live="([^"]+)"[^>]*>/g)]
  assert.strictEqual(live.length, 1)
  assert.match(live[0][0], /data-out="config"/)
  assert.match(live[0][0], /aria-live="polite"/)
  assert.match(live[0][0], /aria-atomic="true"/)
  assert.match(html, /<span class="ice-sr" role="status" data-out="copy-status"><\/span>/)
})

test('disabled-state hints come from the enable rule and have ids to describe', () => {
  assert.strictEqual(enabledHintFor(entry('key.subject').field), 'Only with schema_latest')
  assert.strictEqual(enabledHintFor(entry('value.protobuf_name').field), 'Only with schema_latest')
  assert.strictEqual(enabledHintFor(entry('value.layout').field), 'Only with schema_id_prefix or schema_latest')
  // subject and protobuf_name share one rule, so one hint, under the first.
  for (const path of ['key.subject', 'value.subject', 'value.layout']) {
    const id = path.replace('.', '-')
    assert.match(html, new RegExp(`<p class="ice-hint" id="ice9-${id}-hint" data-hint="${path}" hidden>Only with `))
  }
  assert.strictEqual((html.match(/class="ice-hint"/g) || []).length, 3)
})

test('the builder drops exactly the options the enable rule disables', () => {
  const modes = ['binary', 'string', 'schema_id_prefix', 'schema_latest']
  for (const mode of modes) {
    const base = { 'key.mode': 'binary', 'value.mode': mode, 'value.layout': 'nested', 'headers.value_type': 'string', 'value.subject': 'S', 'value.protobuf_name': 'P' }
    const str = build(SPEC, base).str
    assert.strictEqual(/subject=S/.test(str), optionEnabled('subject', 'value', mode), `${mode}: ${str}`)
    assert.strictEqual(/protobuf_name=P/.test(str), optionEnabled('protobuf_name', 'value', mode), `${mode}: ${str}`)
    assert.strictEqual(/layout=nested/.test(str), optionEnabled('layout', 'value', mode), `${mode}: ${str}`)
    const k = build(SPEC, Object.assign({}, base, { 'key.mode': mode, 'key.subject': 'KS', 'value.mode': 'binary' })).str
    assert.strictEqual(/subject=KS/.test(k), optionEnabled('subject', 'key', mode), `key ${mode}: ${k}`)
  }
})

test('copyText reports failure instead of claiming success', async () => {
  assert.strictEqual(await copyText('x', undefined), false)
  assert.strictEqual(await copyText('x', {}), false)
  assert.strictEqual(await copyText('x', { writeText: () => Promise.reject(new Error('denied')) }), false)
  assert.strictEqual(await copyText('x', { writeText: () => { throw new Error('sync') } }), false)
  let got
  assert.strictEqual(await copyText('a;b', { writeText: (t) => { got = t; return Promise.resolve() } }), true)
  assert.strictEqual(got, 'a;b')
})
