'use strict'

// Stand-ins for the per-release WASM engines in jsdom tests, where emcc and
// Redpanda's (private) source are not available. Each answers
// parseIcebergMode the way the real engine built from that release does:
// tests/iceberg-engine/mode-vectors.test.js checks the real builds of
// v24.3.1, v25.1.1, v26.1.1 and v26.2.1, and that the explorer's reader and
// builder (which these stand-ins reuse) agree with them.
const { ICEBERG_MODE: SPEC, parse, build } = require('../../../src/js/iceberg-explorer.js')

function module_ (ref, parseMode, extra) {
  return Object.assign({
    parseIcebergMode: (s) => JSON.stringify(parseMode(s)),
    formatIcebergMode: (s) => { const r = parseMode(s); return r.ok ? r.normalized : '' },
    icebergEngineInfo: () => JSON.stringify({ redpanda_ref: ref, redpanda_commit: '0'.repeat(40) }),
  }, extra || {})
}

// v26.2 and later: the section format, with parse_iceberg_mode's messages.
function sections (ref = 'v26.2.1', extra) {
  return module_(ref, (s) => {
    // boost::lexical_cast stops at whitespace and then rejects the rest.
    if (/\s/.test(s)) return { ok: false, error: "missing ':' in section '" + s + "'" }
    const r = parse(SPEC, s)
    if (r.errors.length) return { ok: false, error: r.errors[0].message + (r.errors[0].reason ? ' (' + r.errors[0].reason + ')' : '') }
    const b = build(SPEC, r.cfg)
    return { ok: true, normalized: b.str, extended: !b.legacy }
  }, extra)
}

// Before v26.2: legacy names only, and operator>> gives no message. v25.1
// added value_schema_latest.
function legacy (ref, { schemaLatest } = {}, extra) {
  const names = /^(disabled|key_value|value_schema_id_prefix)$/
  return module_(ref, (s) => {
    const r = parse(SPEC, s)
    const ok = !/\s/.test(s) && !r.errors.length && r.form !== 'sections' &&
      (names.test(s) || (schemaLatest && /^value_schema_latest(:|$)/.test(s)))
    return ok ? { ok: true, normalized: build(SPEC, r.cfg).str } : { ok: false }
  }, extra)
}

// The engine a docs version's file name resolves to.
function forVersion (version) {
  const m = /^(\d+)\.(\d+)$/.exec(version)
  if (!m) return null
  const [maj, min] = [Number(m[1]), Number(m[2])]
  const ref = `v${maj}.${min}.1`
  if (maj > 26 || (maj === 26 && min >= 2)) return sections(ref)
  if (maj > 25 || (maj === 25 && min >= 1)) return legacy(ref, { schemaLatest: true })
  return legacy(ref)
}

module.exports = { sections, legacy, forVersion }
