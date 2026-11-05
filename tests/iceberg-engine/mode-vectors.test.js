'use strict'

// The engine's redpanda.iceberg.mode parser is Redpanda's own model.cc, so
// these tests do not restate the grammar. They check two things for every
// engine build they find:
//
//   1. The explorer's JavaScript reader and builder agree with the engine on
//      every string the engine accepts: the explorer reads the engine's
//      normalized string back onto its controls, and builds candidate
//      strings for the engine to check, so a mismatch would show controls
//      that do not match what Redpanda stores.
//   2. A build that accepts the section format passes the upstream vectors
//      (tests/iceberg-explorer/fixtures/upstream-vectors.js, from
//      iceberg_mode_test.cc). `build.sh test` also runs the release's own
//      iceberg_mode_test.cc against the same compiled code.
//
// Engines: ICEBERG_ENGINES (colon-separated .js paths), else
// iceberg-editor/wasm/build/iceberg-engine-node.js and every
// iceberg-editor/wasm/build/engines/<ref>/iceberg-engine-node.js. Skipped
// when none has been built (build.sh needs emcc and the private source).
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const V = require('../iceberg-explorer/fixtures/upstream-vectors')
const { ICEBERG_MODE: SPEC, parse, build, defaultsOf, fieldsOf } = require('../../src/js/iceberg-explorer.js')

const BUILD = path.join(__dirname, '../../iceberg-editor/wasm/build')
function enginePaths () {
  if (process.env.ICEBERG_ENGINES) return process.env.ICEBERG_ENGINES.split(':').filter(Boolean)
  const out = []
  const main = path.join(BUILD, 'iceberg-engine-node.js')
  if (fs.existsSync(main)) out.push(main)
  const dir = path.join(BUILD, 'engines')
  if (fs.existsSync(dir)) {
    for (const ref of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, ref, 'iceberg-engine-node.js')
      if (fs.existsSync(p)) out.push(p)
    }
  }
  return out
}
const PATHS = enginePaths()

async function load (p) {
  const mod = await require(p)()
  if (typeof mod.parseIcebergMode !== 'function') return null
  return {
    path: p,
    info: JSON.parse(mod.icebergEngineInfo()),
    parse: (s) => JSON.parse(mod.parseIcebergMode(s)),
    format: (s) => mod.formatIcebergMode(s),
  }
}

// Every string the explorer's controls can build (all choices, with and
// without text values), plus every upstream input.
function candidates () {
  const out = new Set()
  const enums = fieldsOf(SPEC).filter((e) => e.field.type === 'enum')
  const texts = fieldsOf(SPEC).filter((e) => e.field.type === 'text')
  const walk = (i, cfg) => {
    if (i === enums.length) {
      out.add(build(SPEC, cfg).str)
      const withText = Object.assign({}, cfg)
      texts.forEach((t) => { withText[t.path] = t.field.name === 'subject' ? 'orders-' + t.section.name : 'com.example.M' })
      out.add(build(SPEC, withText).str)
      return
    }
    for (const v of enums[i].field.values) walk(i + 1, Object.assign({}, cfg, { [enums[i].path]: v.value }))
  }
  walk(0, defaultsOf(SPEC))
  for (const group of [V.accept, V.reject, V.errorMessages, V.format, V.roundtrip]) {
    for (const v of group) if (v.input !== undefined) out.add(v.input)
  }
  return [...out]
}

if (!PATHS.length) {
  test('engine vectors (no engine built: run iceberg-editor/wasm/build.sh node)', { skip: true }, () => {})
}

for (const p of PATHS) {
  test(`${path.relative(BUILD, p)}: the JavaScript reader and builder agree with the engine`, async () => {
    const e = await load(p)
    assert.ok(e, `${p} has no parseIcebergMode`)
    let accepted = 0
    for (const s of candidates()) {
      const r = e.parse(s)
      if (!r.ok) {
        assert.strictEqual(e.format(s), '', `${e.info.redpanda_ref}: format of a rejected string`)
        continue
      }
      accepted++
      const n = r.normalized
      assert.strictEqual(e.format(s), n, `${e.info.redpanda_ref}: ${s}`)
      assert.deepStrictEqual(e.parse(n), r, `${e.info.redpanda_ref}: normalized ${n} is not a fixed point`)
      const js = parse(SPEC, n)
      assert.deepStrictEqual(js.errors, [], `${e.info.redpanda_ref}: the explorer cannot read ${n}`)
      assert.strictEqual(build(SPEC, js.cfg).str, n, `${e.info.redpanda_ref}: the explorer rebuilds ${n} differently`)
    }
    assert.ok(accepted >= 3, `${e.info.redpanda_ref}: accepted only ${accepted} strings`)
  })

  test(`${path.relative(BUILD, p)}: a build with the section format passes the upstream vectors`, async (t) => {
    const e = await load(p)
    if (!e.parse('headers:value_type=string').ok) {
      t.skip(`${e.info.redpanda_ref} has no section format`)
      return
    }
    for (const v of V.accept) {
      const r = e.parse(v.input)
      assert.ok(r.ok, `${v.test}: ${v.input} rejected: ${r.error}`)
      if (v.equals) assert.strictEqual(r.normalized, e.parse(v.equals).normalized, v.test)
      const cfg = parse(SPEC, r.normalized).cfg
      for (const [k, want] of Object.entries(v.expect)) assert.strictEqual(cfg[k], want, `${v.test}: ${k}`)
    }
    for (const v of V.reject) assert.strictEqual(e.parse(v.input).ok, false, `${v.test}: ${v.input} accepted`)
    for (const v of V.errorMessages) {
      const msg = e.parse(v.input).error
      if (v.exact) assert.strictEqual(msg, v.exact, v.test)
      for (const part of v.contains || []) assert.ok(msg.includes(part), `${v.test}: "${msg}" lacks "${part}"`)
    }
    for (const v of V.format) {
      const s = v.input !== undefined ? v.input : build(SPEC, Object.assign(defaultsOf(SPEC), v.fields)).str
      assert.strictEqual(e.parse(s).normalized, v.expected, v.test)
    }
  })
}
