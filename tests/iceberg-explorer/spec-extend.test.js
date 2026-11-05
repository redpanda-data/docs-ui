'use strict'

// The explorer is generated from its spec: a new mode is one MODES entry, a
// new option one field, and a new property one spec plus an OUTPUTS renderer.
// Each case here changes only the spec and checks that the markup, the
// builder and the parser all follow.
const test = require('node:test')
const assert = require('node:assert')
const { ICEBERG_MODE, OUTPUTS, template, build, parse, defaultsOf } = require('../../src/js/iceberg-explorer.js')

const clone = (spec) => structuredClone(spec)
const radioValues = (html, path) => [...html.matchAll(new RegExp(`data-path="${path.replace('.', '\\.')}" value="([^"]+)"`, 'g'))].map((m) => m[1])

test('a mode added to the spec renders, builds and parses', () => {
  const spec = clone(ICEBERG_MODE)
  // Key and value share one MODES list, so one entry adds the mode to both.
  const keyModes = spec.sections.find((s) => s.name === 'key').fields.find((f) => f.name === 'mode').values
  assert.strictEqual(keyModes, spec.sections.find((s) => s.name === 'value').fields.find((f) => f.name === 'mode').values)
  keyModes.push({ value: 'json_schema', decodes: true, help: 'Decoded as JSON.' })
  const html = template(spec, 'x1')
  assert.deepStrictEqual(radioValues(html, 'key.mode'), ['binary', 'string', 'schema_id_prefix', 'schema_latest', 'json_schema'])
  assert.deepStrictEqual(radioValues(html, 'value.mode'), radioValues(html, 'key.mode'))

  const cfg = Object.assign(defaultsOf(spec), { 'value.mode': 'json_schema' })
  const str = build(spec, cfg).str
  assert.strictEqual(str, 'key:mode=binary;value:mode=json_schema,layout=flat;headers:value_type=binary')
  assert.deepStrictEqual(parse(spec, str), { cfg, errors: [], form: 'sections' })
  // The real spec does not know it.
  assert.match(parse(ICEBERG_MODE, str).errors[0].message, /unknown mode 'json_schema' in section 'value'/)
})

test('an option added to the spec renders, builds, parses and follows its enable rule', () => {
  const spec = clone(ICEBERG_MODE)
  const value = spec.sections.find((s) => s.name === 'value')
  // Written after protobuf_name and before layout, as listed.
  value.fields.splice(3, 0, { name: 'reader_schema', type: 'text', default: '', enabledWhen: { mode: ['schema_latest'] } })
  const html = template(spec, 'x2')
  assert.match(html, /<label for="x2-value-reader_schema"><span class="ice-sr">Value <\/span>reader_schema<\/label>/)
  assert.match(html, /<input type="text" id="x2-value-reader_schema" data-path="value\.reader_schema" disabled>/)

  const on = Object.assign(defaultsOf(spec), { 'value.mode': 'schema_latest', 'value.reader_schema': 'r1', 'value.layout': 'nested' })
  const str = build(spec, on).str
  assert.strictEqual(str, 'key:mode=binary;value:mode=schema_latest,reader_schema=r1,layout=nested;headers:value_type=binary')
  assert.deepStrictEqual(parse(spec, str).cfg, on)
  // Outside schema_latest the option is dropped from the string, and a
  // string that sets it there is rejected.
  assert.strictEqual(build(spec, Object.assign({}, on, { 'value.mode': 'binary' })).str, 'key_value')
  assert.match(parse(spec, 'value:mode=binary,reader_schema=r1').errors[0].message, /reader_schema requires mode=schema_latest in section 'value'/)
})

test('a new property is one spec plus an outputs renderer', () => {
  OUTPUTS.codecEcho = {
    template: () => '<pre class="ice-tree" data-out="echo"></pre>',
    update: (root, cfg) => { root.querySelector('[data-out="echo"]').textContent = JSON.stringify(cfg) },
  }
  const spec = {
    property: 'example.codec',
    grammar: 'sections',
    sectionsSince: 'v1.0',
    sections: [{
      name: 'codec',
      label: 'Codec',
      fields: [
        { name: 'algo', label: 'Algorithm', type: 'enum', default: 'none', values: [{ value: 'none', help: 'Stored as is.' }, { value: 'zstd', help: 'Compressed.' }] },
        { name: 'level', type: 'text', default: '', enabledWhen: { algo: ['zstd'] } },
      ],
    }],
    legacy: [{ str: 'off', set: { 'codec.algo': 'none' } }],
    outputs: 'codecEcho',
  }
  try {
    const html = template(spec, 'x3')
    assert.match(html, /<code class="ice-prop">example\.codec<\/code>/)
    assert.deepStrictEqual(radioValues(html, 'codec.algo'), ['none', 'zstd'])
    assert.match(html, /data-out="echo"/)
    assert.match(html, /data-hint="codec\.level" hidden>Only with zstd</)

    assert.strictEqual(build(spec, defaultsOf(spec)).str, 'off')
    const z = { 'codec.algo': 'zstd', 'codec.level': '3' }
    assert.strictEqual(build(spec, z).str, 'codec:algo=zstd,level=3')
    assert.deepStrictEqual(parse(spec, 'codec:algo=zstd,level=3').cfg, z)
    assert.deepStrictEqual(parse(spec, 'off').cfg, defaultsOf(spec))
    assert.match(parse(spec, 'codec:algo=lz4').errors[0].message, /unknown algo 'lz4' in section 'codec'/)
    assert.match(parse(spec, 'other:x=1').errors[0].message, /unknown section 'other'/)
  } finally {
    delete OUTPUTS.codecEcho
  }
})
