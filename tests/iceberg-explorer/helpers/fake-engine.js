'use strict'

// Stand-ins for the per-release WASM engines in jsdom and browser tests,
// where emcc and Redpanda's (private) source are not available. Each answers
// parseIcebergMode the way the real engine built from that release does:
// tests/iceberg-engine/mode-vectors.test.js checks the real builds of
// v24.3.1, v25.1.1, v26.1.1 and v26.2.1, and that the explorer's reader and
// builder (which these stand-ins reuse) agree with them.
const fs = require('fs')
const path = require('path')

const SRC_PATH = path.join(__dirname, '../../../src/js/iceberg-explorer.js')

// Self-contained, so browserScript() can ship it to a page as source.
// `E` is the explorer module's exports.
function makeFakes (E) {
  var SPEC = E.ICEBERG_MODE
  function mod (ref, parseMode, extra) {
    var m = {
      parseIcebergMode: function (s) { return JSON.stringify(parseMode(s)) },
      formatIcebergMode: function (s) { var r = parseMode(s); return r.ok ? r.normalized : '' },
      icebergEngineInfo: function () { return JSON.stringify({ redpanda_ref: ref, redpanda_commit: new Array(41).join('0') }) },
    }
    Object.keys(extra || {}).forEach(function (k) { m[k] = extra[k] })
    return m
  }
  // v26.2 and later: the section format, with parse_iceberg_mode's messages.
  function sections (ref, extra) {
    return mod(ref || 'v26.2.1', function (s) {
      // boost::lexical_cast stops at whitespace and then rejects the rest.
      if (/\s/.test(s)) return { ok: false, error: "missing ':' in section '" + s + "'" }
      var r = E.parse(SPEC, s)
      if (r.errors.length) return { ok: false, error: r.errors[0].message + (r.errors[0].reason ? ' (' + r.errors[0].reason + ')' : '') }
      var b = E.build(SPEC, r.cfg)
      return { ok: true, normalized: b.str, extended: !b.legacy }
    }, extra)
  }
  // Before v26.2: legacy names only, and operator>> gives no message. v25.1
  // added value_schema_latest.
  function legacy (ref, opts, extra) {
    var schemaLatest = !!(opts && opts.schemaLatest)
    return mod(ref, function (s) {
      var r = E.parse(SPEC, s)
      var ok = !/\s/.test(s) && !r.errors.length && r.form !== 'sections' &&
        (/^(disabled|key_value|value_schema_id_prefix)$/.test(s) || (schemaLatest && /^value_schema_latest(:|$)/.test(s)))
      return ok ? { ok: true, normalized: E.build(SPEC, r.cfg).str } : { ok: false }
    }, extra)
  }
  // The engine a docs version's file name resolves to.
  function forVersion (version) {
    var m = /^(\d+)\.(\d+)$/.exec(version)
    if (!m) return null
    var maj = Number(m[1])
    var min = Number(m[2])
    var ref = 'v' + maj + '.' + min + '.1'
    if (maj > 26 || (maj === 26 && min >= 2)) return sections(ref)
    if (maj > 25 || (maj === 25 && min >= 1)) return legacy(ref, { schemaLatest: true })
    return legacy(ref)
  }
  // The module for an engine file name, or null for none.
  function forFile (file) {
    if (file === 'iceberg-engine.js') return sections()
    var v = /^iceberg-engine-(.+)\.js$/.exec(file)
    return v ? forVersion(v[1]) : null
  }
  return { sections: sections, legacy: legacy, forVersion: forVersion, forFile: forFile }
}

// A classic script that defines window.createIcebergEngine for `file`, as a
// built engine does. It evaluates the explorer source with no `document` in
// scope, so the copy does not hydrate the page a second time.
function browserScript (file) {
  const src = fs.readFileSync(SRC_PATH, 'utf8')
  return '(function (document) {\n  var module = { exports: {} }\n' + src + '\n' +
    '  var fakes = (' + makeFakes.toString() + ')(module.exports)\n' +
    '  var m = fakes.forFile(' + JSON.stringify(file) + ')\n' +
    '  if (m) window.createIcebergEngine = function () { return Promise.resolve(m) }\n' +
    '})(undefined)\n'
}

module.exports = Object.assign(makeFakes(require(SRC_PATH)), { browserScript })
