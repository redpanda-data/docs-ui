;(function () {
  'use strict'

  // Iceberg Mode Explorer: docs-ui hydration module.
  //
  // Not part of site.js: 27-iceberg-explorer.js loads it, built as
  // js/vendor/iceberg-explorer.js (src/js/vendor/iceberg-explorer.bundle.js),
  // only on pages that have an explorer mount.
  //
  // The `[iceberg-explorer]` block (docs-extensions-and-macros) emits a mount
  // point carrying the `data-iceberg-explorer` attribute (its value is the
  // mount contract version) plus a fallback paragraph. That attribute is the
  // contract: the class names are presentation and have already changed once
  // (`.iceberg-explorer` to `.iceberg-explorer-mount`), which left this module
  // finding zero mounts while every page showed the fallback. This module
  // finds every such mount point and renders the interactive tool into it.
  //
  // Everything the tool knows about a property is in one declarative SPEC
  // (see ICEBERG_MODE below): its sections, fields, choices, defaults, which
  // fields depend on which, and how the string is written. The markup, the
  // config builder and parser, the enable rules and hints, and getConfig are
  // all generated from it. To add a mode, add one entry to MODES; to add an
  // option, add one field; to explore another property, add a spec and an
  // OUTPUTS renderer for its panels.
  //
  // ENGINE SEAM: the panels are drawn by the spec's `outputs` renderer. The
  // Iceberg renderer uses an in-browser port of the rules in Redpanda's
  // `model/iceberg_mode` and `iceberg/conversion` (an interim engine), and a
  // per-version WASM build of the real C++ mapper when one is published (see
  // docs-ui/iceberg-editor/).

  // ── Fixed sample data (illustrative). A future iteration swaps these for
  //    user-supplied schema/record via editors; the engine seam stays the same.
  var KEY_SCHEMA = [
    { name: 'user_id', type: 'long' },
    { name: 'region', type: 'string' },
  ]
  var VAL_SCHEMA = [
    { name: 'order_id', type: 'string' },
    { name: 'product', type: 'string' },
    { name: 'quantity', type: 'int' },
    { name: 'price', type: 'double' },
    { name: 'shipped', type: 'boolean' },
    {
      name: 'shipping_address',
      type: 'struct',
      fields: [
        { name: 'street', type: 'string' },
        { name: 'city', type: 'string' },
        { name: 'zip', type: 'string' },
        { name: 'tags', type: 'list<string>' },
      ],
    },
  ]
  var RECORD = {
    partition: 3,
    offset: 42,
    timestamp: 1720000000000,
    value: {
      order_id: 'ORD-98765',
      product: 'Redpanda Plushie',
      quantity: 3,
      price: 29.99,
      shipped: false,
      shipping_address: { street: '123 Main St', city: 'Seattle', zip: '98101', tags: ['residential', 'priority'] },
    },
    headers: [
      { key: 'content-type', value: 'application/json' },
      { key: 'x-request-id', value: 'req-abc-123' },
      { key: 'x-trace-id', value: 'trace-00f1e2d3' },
    ],
  }

  // The sample value schema expressed as real Avro JSON. When the WASM engine
  // is available, this is fed to the REAL Redpanda C++ mapper to compute the
  // Iceberg value fields (see below); otherwise the tool falls back to the
  // VAL_SCHEMA rules above (interim engine).
  var AVRO_VALUE_SCHEMA = JSON.stringify({
    type: 'record',
    name: 'order',
    fields: [
      { name: 'order_id', type: 'string' },
      { name: 'product', type: 'string' },
      { name: 'quantity', type: 'int' },
      { name: 'price', type: 'double' },
      { name: 'shipped', type: 'boolean' },
      {
        name: 'shipping_address',
        type: {
          type: 'record',
          name: 'shipping_address',
          fields: [
            { name: 'street', type: 'string' },
            { name: 'city', type: 'string' },
            { name: 'zip', type: 'string' },
            { name: 'tags', type: { type: 'array', items: 'string' } },
          ],
        },
      },
    ],
  })

  // ── Real WASM engine loader. Resolves to an engine adapter, or null if no
  //    engine can be loaded (then the interim JS engine is used).
  //
  //    The engine is versioned: schema-translation rules can change per release,
  //    so each docs version loads the engine built from that release tag. We try
  //    candidates in priority order and fall back gracefully:
  //      1. data-engine-base override on the mount (CI/author points this at the
  //         versioned content-attachments dir where release-tag CI publishes
  //         iceberg-engine-<version>.js/.wasm).
  //      2. versioned filename in the UI root: <uiRoot>/iceberg-engine-<v>.js
  //      3. unversioned <uiRoot>/iceberg-engine.js (single-bundle / preview).
  //      4. none -> interim JS engine.
  //
  //    Each candidate is loaded at most once per page and shared by every mount
  //    that asks for the same file, so two mounts for different versions get
  //    different engines.
  var engineCache = {}
  function uiRoot () {
    // Derive the UI root (…/_) from the already-loaded site.js script src so
    // this works at any doc version/path.
    var s = document.querySelector('script[src*="/js/site.js"]')
    if (s) return s.src.replace(/\/js\/site\.js.*$/, '')
    return '/_'
  }
  // data-engine-base comes from page source, and the engine is loaded as a
  // script, so only a same-origin root-relative path is trusted. The macro
  // that emits the attribute applies the same rule; this is the second check.
  function isSafeEngineBase (base) {
    if (typeof base !== 'string' || !base) return false
    if (!/^\/(?![/\\])/.test(base)) return false
    // eslint-disable-next-line no-control-regex
    if (/[\\\s\x00-\x1f\x7f]/.test(base)) return false
    if (/%(?:[01][0-9a-f]|7f|5c)/i.test(base)) return false
    return true
  }
  function engineCandidates (version, overrideBase) {
    var root = uiRoot()
    var list = []
    if (overrideBase && !isSafeEngineBase(overrideBase)) {
      if (window.console) console.warn('iceberg-explorer: ignoring data-engine-base that is not a root-relative path: ' + overrideBase)
      overrideBase = ''
    }
    if (overrideBase && version) {
      list.push({ dir: overrideBase, file: 'iceberg-engine-' + version + '.js' })
    }
    if (version) {
      list.push({ dir: root, file: 'iceberg-engine-' + version + '.js' })
    }
    list.push({ dir: root, file: 'iceberg-engine.js' })
    return list
  }

  // Wrap a loaded Emscripten module. Methods are detected, not assumed, so an
  // engine built before or after a binding was added still loads; callers
  // check `has` before using an optional one. Null when the module offers
  // nothing this UI can use.
  function makeEngineAdapter (mod, source) {
    if (!mod) return null
    var has = {
      avroToIceberg: typeof mod.avroToIcebergJson === 'function',
      parseIcebergMode: typeof mod.parseIcebergMode === 'function',
      formatIcebergMode: typeof mod.formatIcebergMode === 'function',
    }
    if (!has.avroToIceberg && !has.parseIcebergMode && !has.formatIcebergMode) return null
    var adapter = {
      source: source,
      has: has,
      // { fields } or { error } for an Avro schema (JSON string).
      avroToIceberg: function (schemaJson) {
        if (!has.avroToIceberg) return { error: 'this engine build has no avroToIcebergJson' }
        try { return JSON.parse(mod.avroToIcebergJson(schemaJson)) } catch (e) { return { error: String(e && e.message) } }
      },
      valueFields: null,
    }
    if (has.avroToIceberg) {
      var sample = adapter.avroToIceberg(AVRO_VALUE_SCHEMA)
      adapter.valueFields = sample.error ? null : sample.fields
    }
    return adapter
  }

  // Load one candidate; resolve to an adapter, or null on any failure so the
  // caller can try the next candidate.
  function tryCandidate (cand) {
    var url = cand.dir.replace(/\/$/, '') + '/' + cand.file
    if (engineCache[url]) return engineCache[url]
    engineCache[url] = new Promise(function (resolve) {
      var script = document.createElement('script')
      script.src = url
      script.onload = function () {
        // Emscripten is built with MODULARIZE + EXPORT_NAME=createIcebergEngine,
        // so the loaded classic script leaves the factory on `window`. Take it
        // now: another engine version loading later replaces the global.
        var factory = window.createIcebergEngine
        if (typeof factory !== 'function') { resolve(null); return }
        Promise.resolve(factory({ locateFile: function (p) { return cand.dir.replace(/\/$/, '') + '/' + p } }))
          .then(function (mod) {
            try { resolve(makeEngineAdapter(mod, url)) } catch (e) { resolve(null) }
          }, function () { resolve(null) })
      }
      script.onerror = function () { resolve(null) }
      document.head.appendChild(script)
    })
    return engineCache[url]
  }
  function loadEngine (version, overrideBase) {
    var cands = engineCandidates(version, overrideBase)
    return (function next (i) {
      if (i >= cands.length) return Promise.resolve(null)
      return tryCandidate(cands[i]).then(function (engine) {
        return engine || next(i + 1)
      })
    })(0)
  }

  function esc (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
  var hasOwn = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k) }

  // ══ The spec ════════════════════════════════════════════════════════════
  //
  // A spec describes one property for one range of Redpanda versions.
  //
  //   property     The property name shown in the config bar.
  //   sections     In the order Redpanda writes them. Each has `name` (the
  //                DSL section name), `label` (the word screen readers hear
  //                before each control), `heading` and `fields`.
  //   fields       In the order Redpanda writes them within the section. The
  //                form shows choice fields first, then text fields.
  //     name       The DSL option name. A field's path is `<section>.<name>`;
  //                the config object, the DOM (data-path) and the tests all
  //                use that path.
  //     type       'enum' (radio group) or 'text'.
  //     values     For enums: [{ value, help, decodes? }]. `help` is the one
  //                line shown under the group while that value is checked.
  //     default    The value Redpanda assumes when the option is left out.
  //     enabledWhen  { <field in the same section>: [values] }. Outside those
  //                values the control is disabled with a hint, and the
  //                option is left out of the string (it is reset to its
  //                default), because Redpanda rejects it there.
  //     requires   Redpanda's message when the option is set where
  //                enabledWhen says it does not apply. Generated if omitted.
  //     emit       'always' (enums) or 'ifSet' (text): whether the section
  //                format writes the option when it holds its default.
  //   misplaced    On a section: option names of other sections that Redpanda
  //                reports as "only valid in the <home> section" here.
  //   legacy       Short names Redpanda writes when a config fits one. Build
  //                tries them in order; `set` gives the paths the name fixes,
  //                `options` the options it may carry (in Redpanda's order).
  //                Every other path must hold its default.
  //   valueRules   Checks on text values, applied where the value is written.
  //   outputs      Name of the OUTPUTS renderer that draws the panels.

  // Value modes, shared by the key and value sections. `decodes` marks modes
  // that decode the bytes with a schema, so the table gets typed columns.
  var MODES = [
    { value: 'binary', help: 'Raw bytes, not decoded.' },
    { value: 'string', help: 'Decoded as UTF-8. Invalid bytes become U+FFFD.' },
    { value: 'schema_id_prefix', decodes: true, help: 'Decoded with the schema whose ID is embedded in each record, in Schema Registry wire format.' },
    { value: 'schema_latest', decodes: true, help: 'Decoded with the latest schema registered for the subject.' },
  ]

  // Characters a subject or protobuf_name cannot contain. Redpanda splits
  // options on ',' and sections on ';' (parse_extended_iceberg_mode), and reads
  // the property with operator>>, which stops at whitespace, so the rest of
  // the string makes the whole setting invalid. The legacy value_schema_latest
  // form is not split on ';'. '=' is accepted: only the first '=' separates
  // the option name, so it is a note, not an error.
  var VALUE_RULES = [
    { re: /\s/, error: 'Remove the whitespace. Redpanda rejects a setting that contains it.' },
    { re: /,/, error: 'Remove the comma. Redpanda uses it to separate options.' },
    { re: /;/, error: 'Remove the semicolon. Redpanda uses it to separate sections.', sectionFormOnly: true },
    { re: /=/, note: 'Redpanda keeps "=" as part of the name.' },
  ]

  // subject and protobuf_name pick a schema in Schema Registry, so they only
  // apply to schema_latest: "subject and protobuf_name require
  // mode=schema_latest" (model.cc parse_extended_iceberg_mode).
  function schemaOptions (section) {
    var only = { mode: ['schema_latest'] }
    var requires = 'subject and protobuf_name require mode=schema_latest'
    return [
      { name: 'subject', type: 'text', default: '', placeholder: '(default: <topic>-' + section + ')', enabledWhen: only, requires: requires },
      { name: 'protobuf_name', type: 'text', default: '', placeholder: '(default: first message)', enabledWhen: only, requires: requires },
    ]
  }
  function modeField () {
    return { name: 'mode', label: 'Mode', type: 'enum', values: MODES, default: 'binary' }
  }

  // Which Redpanda versions accept a built string. Section strings are only
  // built when a setting has no short form, and those need the
  // iceberg_extended_mode_config feature: "extended key/headers config
  // requires the cluster to be fully upgraded to at least v26.2.1"
  // (config_utils.h iceberg_config_validator). value_schema_latest first
  // parses in v25.1.1; key_value and value_schema_id_prefix in every release
  // with Iceberg.
  var LEGACY_HELP = 'Short form. Redpanda shows a setting in this form whenever it fits, because older clusters accept it.'

  var ICEBERG_MODE = {
    property: 'redpanda.iceberg.mode',
    grammar: 'sections',
    sectionsSince: 'v26.2.1',
    sectionsHelp: 'Redpanda accepts this form once every broker in the cluster runs v26.2.1 or later.',
    sections: [
      {
        name: 'key',
        label: 'Key',
        heading: 'Key configuration',
        // Options of another section that Redpanda names when they appear
        // here: "layout is only valid in the value section, not 'key'".
        misplaced: ['layout'],
        fields: [modeField()].concat(schemaOptions('key')),
      },
      {
        name: 'value',
        label: 'Value',
        heading: 'Value configuration',
        fields: [modeField()].concat(schemaOptions('value'), [{
          name: 'layout',
          label: 'Layout',
          type: 'enum',
          default: 'flat',
          // "layout=nested requires a schema mode (schema_id_prefix or
          // schema_latest)" (model.cc parse_extended_iceberg_mode).
          enabledWhen: { mode: ['schema_id_prefix', 'schema_latest'] },
          requires: 'layout=nested requires a schema mode (schema_id_prefix or schema_latest)',
          values: [
            { value: 'flat', help: 'Value fields become top-level columns.' },
            { value: 'nested', help: 'Value fields go in one value struct column.' },
          ],
        }]),
      },
      {
        name: 'headers',
        label: 'Headers',
        heading: 'Headers configuration',
        fields: [{
          name: 'value_type',
          label: 'Value type',
          type: 'enum',
          default: 'binary',
          values: [
            { value: 'binary', help: 'Header values stay raw bytes. Header keys are always strings.' },
            { value: 'string', help: 'Header values are decoded as UTF-8. Invalid bytes become U+FFFD.' },
          ],
        }],
      },
    ],
    // model.cc format_to: a config whose key and headers are defaults and
    // whose value is flat and not string is written as a legacy name.
    legacy: [
      { str: 'key_value', set: { 'value.mode': 'binary' }, help: LEGACY_HELP },
      { str: 'value_schema_id_prefix', set: { 'value.mode': 'schema_id_prefix' }, help: LEGACY_HELP },
      // Legacy option order (model.cc format_to): protobuf_name then subject.
      { str: 'value_schema_latest', set: { 'value.mode': 'schema_latest' }, section: 'value', options: ['protobuf_name', 'subject'], since: 'v25.1', help: LEGACY_HELP },
    ],
    disabledLiteral: 'disabled',
    valueRules: VALUE_RULES,
    outputs: 'icebergRow',
  }

  // ── Older grammars. A page documents one release series, and the explorer
  //    must never offer or emit a string that series rejects. Before v26.2.1
  //    only the legacy names exist (model.cc operator>>): from v25.1.1
  //    `disabled`, `key_value`, `value_schema_id_prefix` and
  //    `value_schema_latest[:protobuf_name=..,subject=..]`; in v24.3 the
  //    first three only. Key and headers are always binary there, so only
  //    the value section has controls.
  function legacyRevision (modes, legacy, documents) {
    var value = {
      name: 'value',
      label: 'Value',
      heading: 'Value configuration',
      fields: [{ name: 'mode', label: 'Mode', type: 'enum', default: 'binary', values: MODES.filter(function (m) { return modes.indexOf(m.value) !== -1 }) }],
    }
    if (modes.indexOf('schema_latest') !== -1) value.fields = value.fields.concat(schemaOptions('value'))
    return {
      property: ICEBERG_MODE.property,
      grammar: 'legacy',
      documents: documents,
      successor: ICEBERG_MODE,
      sections: [value],
      legacy: ICEBERG_MODE.legacy.filter(function (e) { return legacy.indexOf(e.str) !== -1 }),
      disabledLiteral: 'disabled',
      valueRules: VALUE_RULES,
      outputs: 'icebergRow',
    }
  }
  var ICEBERG_MODE_25_1 = legacyRevision(['binary', 'schema_id_prefix', 'schema_latest'],
    ['key_value', 'value_schema_id_prefix', 'value_schema_latest'], 'a release from v25.1 to v26.1')
  var ICEBERG_MODE_24_3 = legacyRevision(['binary', 'schema_id_prefix'],
    ['key_value', 'value_schema_id_prefix'], 'a release before v25.1')

  // Newest first. `since` is the first release series a revision applies to.
  var REVISIONS = [
    { since: [26, 2], spec: ICEBERG_MODE },
    { since: [25, 1], spec: ICEBERG_MODE_25_1 },
    { since: [0, 0], spec: ICEBERG_MODE_24_3 },
  ]
  // "26.2", "v26.1", "26.2.1" -> [26, 2]. Anything else (unversioned,
  // "master", "beta") documents the latest release.
  function releaseSeries (version) {
    var m = /^v?(\d+)\.(\d+)(?:\.\d+)?$/.exec(String(version || '').trim())
    return m ? [Number(m[1]), Number(m[2])] : null
  }
  function specForVersion (version) {
    var series = releaseSeries(version)
    if (!series) return REVISIONS[0].spec
    for (var i = 0; i < REVISIONS.length; i++) {
      var since = REVISIONS[i].since
      if (series[0] > since[0] || (series[0] === since[0] && series[1] >= since[1])) return REVISIONS[i].spec
    }
    return REVISIONS[REVISIONS.length - 1].spec
  }

  // ══ Generic spec machinery ══════════════════════════════════════════════

  // Every field of a spec with its path, in spec order.
  function fieldsOf (spec) {
    var out = []
    spec.sections.forEach(function (sec) {
      sec.fields.forEach(function (f) {
        out.push({ path: sec.name + '.' + f.name, section: sec, field: f })
      })
    })
    return out
  }
  function fieldAt (spec, path) {
    var all = fieldsOf(spec)
    for (var i = 0; i < all.length; i++) if (all[i].path === path) return all[i]
    return null
  }
  function defaultsOf (spec) {
    var cfg = {}
    fieldsOf(spec).forEach(function (e) { cfg[e.path] = e.field.default })
    return cfg
  }
  // Whether a field applies, given the other values in its section.
  function isEnabled (entry, cfg) {
    var when = entry.field.enabledWhen
    if (!when) return true
    return Object.keys(when).every(function (dep) {
      return when[dep].indexOf(cfg[entry.section.name + '.' + dep]) !== -1
    })
  }
  function enabledHintFor (field) {
    var when = field.enabledWhen
    return 'Only with ' + Object.keys(when).map(function (dep) { return when[dep].join(' or ') }).join(', ')
  }
  // Whether a value is one of an enum's choices.
  function hasValue (field, v) {
    return field.values.some(function (x) { return x.value === v })
  }
  function valueInfo (spec, path, v) {
    var e = fieldAt(spec, path)
    if (!e || e.field.type !== 'enum') return null
    for (var i = 0; i < e.field.values.length; i++) if (e.field.values[i].value === v) return e.field.values[i]
    return null
  }
  // Fill in missing paths with defaults, and reset fields that do not apply
  // to their default: Redpanda rejects them, and a control can still hold a
  // value after the mode it depends on changes.
  function normalize (spec, cfg) {
    var n = defaultsOf(spec)
    Object.keys(n).forEach(function (p) {
      if (cfg && hasOwn(cfg, p) && cfg[p] !== undefined && cfg[p] !== null) n[p] = cfg[p]
    })
    fieldsOf(spec).forEach(function (e) {
      if (!isEnabled(e, n)) n[e.path] = e.field.default
    })
    if (cfg && cfg.disabled) n.disabled = true
    return n
  }

  // The legacy name for a normalized config, or null.
  function legacyFor (spec, n) {
    var all = fieldsOf(spec)
    for (var i = 0; i < (spec.legacy || []).length; i++) {
      var entry = spec.legacy[i]
      var fits = all.every(function (e) {
        if (entry.set && hasOwn(entry.set, e.path)) return n[e.path] === entry.set[e.path]
        if (entry.options && e.section.name === entry.section && entry.options.indexOf(e.field.name) !== -1) return true
        return n[e.path] === e.field.default
      })
      if (!fits) continue
      var s = entry.str
      var opts = (entry.options || []).filter(function (o) { return n[entry.section + '.' + o] })
        .map(function (o) { return o + '=' + n[entry.section + '.' + o] })
      if (opts.length) s += ':' + opts.join(',')
      return { str: s, entry: entry }
    }
    return null
  }

  // Build the string Redpanda writes for a config (model.cc format_to):
  // a legacy name when one fits, else every section with every option it
  // always writes, in spec order. Returns { str, legacy, entry }.
  function build (spec, cfg) {
    if (cfg && cfg.disabled && spec.disabledLiteral) return { str: spec.disabledLiteral, legacy: true, entry: null }
    var n = normalize(spec, cfg)
    var legacy = legacyFor(spec, n)
    if (legacy) return { str: legacy.str, legacy: true, entry: legacy.entry }
    var parts = spec.sections.map(function (sec) {
      var opts = sec.fields.filter(function (f) {
        var emit = f.emit || (f.type === 'enum' ? 'always' : 'ifSet')
        return emit === 'always' || n[sec.name + '.' + f.name]
      }).map(function (f) { return f.name + '=' + n[sec.name + '.' + f.name] })
      return sec.name + ':' + opts.join(',')
    })
    return { str: parts.join(';'), legacy: false, entry: null }
  }

  // "opt1=val1,opt2=val2" into ordered [name, value] pairs (model.cc
  // parse_section_opts). Duplicate names, empty names and empty values are
  // errors. An empty string has no options.
  function parseOpts (str) {
    var pairs = []
    var seen = {}
    if (str === '') return { pairs: pairs }
    var items = str.split(',')
    for (var i = 0; i < items.length; i++) {
      var eq = items[i].indexOf('=')
      var k = eq < 0 ? items[i] : items[i].slice(0, eq)
      var v = eq < 0 ? '' : items[i].slice(eq + 1)
      if (hasOwn(seen, k)) return { reason: "duplicate option '" + k + "'" }
      seen[k] = true
      pairs.push([k, v])
      if (k === '') return { reason: "option '" + items[i] + "' has no name" }
      if (v === '') return { reason: "option '" + k + "' has no value" }
    }
    return { pairs: pairs }
  }
  function err (message, reason) {
    return reason ? { message: message, reason: reason } : { message: message }
  }

  // Parse a string against a spec. Returns { cfg, errors, form }: `cfg` holds
  // every path (defaults where the string is silent, all defaults when it is
  // invalid), `errors` Redpanda's reasons for rejecting it ({ message,
  // reason? }, with Redpanda's own wording), and `form` one of 'disabled',
  // 'legacy' or 'sections'. `options.version` names the release the page
  // documents, for messages about strings that release does not accept.
  function parse (spec, str, options) {
    var s = String(str === undefined || str === null ? '' : str).trim()
    var fail = function (e) { return { cfg: defaultsOf(spec), errors: [e], form: null } }
    // operator>> stops reading at whitespace, and the rest of the string
    // makes the setting invalid.
    if (/\s/.test(s)) return fail(err(VALUE_RULES[0].error))
    var result = parseGrammar(spec, s, (options && options.version) || '')
    if (result.errors.length) return result
    // Text values Redpanda would split or cut short.
    var problems = fieldsOf(spec).filter(function (e) { return e.field.type === 'text' && result.cfg[e.path] })
      .map(function (e) {
        var p = valueProblem(spec, result.cfg[e.path], result.form === 'sections')
        return p && p.error ? err(e.field.name + " in section '" + e.section.name + "': " + p.error) : null
      }).filter(Boolean)
    return problems.length ? fail(problems[0]) : result
  }

  // The names an older grammar accepts, for its error messages.
  function legacyForms (spec) {
    var names = (spec.disabledLiteral ? [spec.disabledLiteral] : []).concat(spec.legacy.map(function (e) {
      return e.options ? e.str + ' with optional :' + e.options.map(function (o) { return o + '=<name>' }).join(',') : e.str
    }))
    return names.slice(0, -1).join(', ') + ', or ' + names[names.length - 1]
  }

  function parseGrammar (spec, s, version) {
    var cfg = defaultsOf(spec)
    var fail = function (e) { return { cfg: defaultsOf(spec), errors: [e], form: null } }
    if (spec.disabledLiteral && s === spec.disabledLiteral) {
      cfg.disabled = true
      return { cfg: cfg, errors: [], form: 'disabled' }
    }
    var legacy = spec.legacy || []
    for (var i = 0; i < legacy.length; i++) {
      var entry = legacy[i]
      if (!entry.options && s === entry.str) return { cfg: Object.assign(cfg, entry.set), errors: [], form: 'legacy' }
      if (entry.options && s.indexOf(entry.str) === 0) {
        Object.assign(cfg, entry.set)
        var suffix = s.slice(entry.str.length)
        if (suffix === '') return { cfg: cfg, errors: [], form: 'legacy' }
        if (suffix.charAt(0) !== ':') return fail(err("expected ':' or end of string after '" + entry.str + "'"))
        var rest = suffix.slice(1)
        if (rest === '') return fail(err("expected options after ':' in " + entry.str))
        var parsed = parseOpts(rest)
        if (!parsed.pairs) return fail(err('malformed options in ' + entry.str, parsed.reason))
        for (var j = 0; j < parsed.pairs.length; j++) {
          var k = parsed.pairs[j][0]
          if (entry.options.indexOf(k) === -1) return fail(err("unknown option '" + k + "' in " + entry.str))
          cfg[entry.section + '.' + k] = parsed.pairs[j][1]
        }
        return { cfg: cfg, errors: [], form: 'legacy' }
      }
    }
    if (spec.grammar === 'sections') return parseSections(spec, s)
    // An older grammar: say why, using what the newest release makes of it.
    var page = 'this page documents ' + (version || spec.documents)
    var use = '. Use one of: ' + legacyForms(spec)
    var newer = spec.successor && parse(spec.successor, s)
    if (newer && !newer.errors.length && newer.form === 'sections') {
      var names = spec.successor.sections.map(function (x) { return x.name + ':' }).join(', ')
      return fail(err('the section format (' + names + ') requires Redpanda ' + spec.successor.sectionsSince + ' or later, and ' + page + use))
    }
    if (newer && !newer.errors.length) {
      var later = spec.successor.legacy.filter(function (e) { return s.indexOf(e.str) === 0 })[0]
      if (later && later.since) return fail(err(later.str + ' requires Redpanda ' + later.since + ' or later, and ' + page + use))
    }
    return fail(err('not a value Redpanda accepts in ' + (version || spec.documents) + use))
  }

  // model.cc parse_extended_iceberg_mode, driven by the spec.
  function parseSections (spec, s) {
    var fail = function (e) { return { cfg: defaultsOf(spec), errors: [e], form: null } }
    var byName = {}
    spec.sections.forEach(function (sec) { byName[sec.name] = sec })
    var given = {}
    var parts = s.split(';')
    for (var i = 0; i < parts.length; i++) {
      var sec = parts[i]
      if (sec === '') return fail(err('empty section in iceberg_mode config'))
      var colon = sec.indexOf(':')
      if (colon < 0) return fail(err("missing ':' in section '" + sec + "'"))
      var name = sec.slice(0, colon)
      var parsed = parseOpts(sec.slice(colon + 1))
      if (!parsed.pairs) return fail(err("malformed options in section '" + name + "'", parsed.reason))
      if (!hasOwn(byName, name)) return fail(err("unknown section '" + name + "'"))
      if (hasOwn(given, name)) return fail(err("duplicate section '" + name + "'"))
      given[name] = parsed.pairs
    }
    var cfg = defaultsOf(spec)
    // Upstream checks the sections in its own order, whatever the source order.
    for (var si = 0; si < spec.sections.length; si++) {
      var section = spec.sections[si]
      var pairs = given[section.name]
      if (!pairs) continue
      for (var p = 0; p < pairs.length; p++) {
        var k = pairs[p][0]
        var v = pairs[p][1]
        var field = null
        section.fields.forEach(function (f) { if (f.name === k) field = f })
        if (!field) {
          var home = (section.misplaced || []).indexOf(k) !== -1 && spec.sections.filter(function (o) {
            return o.fields.some(function (f) { return f.name === k })
          })[0]
          if (home) return fail(err(k + ' is only valid in the ' + home.name + " section, not '" + section.name + "'"))
          return fail(err("unknown option '" + k + "' in section '" + section.name + "'"))
        }
        if (field.type === 'enum' && !hasValue(field, v)) {
          return fail(err('unknown ' + k + " '" + v + "' in section '" + section.name + "'"))
        }
        cfg[section.name + '.' + k] = v
      }
      // A field set away from its default where it does not apply.
      for (var fi = 0; fi < section.fields.length; fi++) {
        var f = section.fields[fi]
        var entry = { path: section.name + '.' + f.name, section: section, field: f }
        if (cfg[entry.path] !== f.default && !isEnabled(entry, cfg)) {
          return fail(err(dependencyMessage(f) + " in section '" + section.name + "'"))
        }
      }
    }
    return { cfg: cfg, errors: [], form: 'sections' }
  }
  function dependencyMessage (field) {
    if (field.requires) return field.requires
    var when = field.enabledWhen
    return field.name + ' requires ' + Object.keys(when).map(function (d) { return d + '=' + when[d].join(' or ') }).join(', ')
  }

  // A problem with one text value, where `sectionForm` says whether the
  // string being built is in the section format.
  function valueProblem (spec, value, sectionForm) {
    var rules = spec.valueRules || []
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i]
      if (r.sectionFormOnly && !sectionForm) continue
      if (r.re.test(value)) return r.error ? { error: r.error } : { note: r.note }
    }
    return null
  }

  // The version tag and help line for a built string.
  function formatInfo (spec, built) {
    if (!built.legacy) {
      return { tag: 'Requires ' + spec.sectionsSince + ' or later', help: spec.sectionsHelp }
    }
    var e = built.entry
    return { tag: e && e.since ? 'Requires ' + e.since + ' or later' : 'Works on all versions', help: (e && e.help) || LEGACY_HELP }
  }

  // A shell command that sets the property. The value is single-quoted
  // because ';' would end the command; rpk's --set is a string array, so ','
  // inside the value is not split.
  function rpkCommand (value, property) {
    return "rpk topic alter-config <topic-name> --set '" + ((property || ICEBERG_MODE.property) + '=' + value).replace(/'/g, "'\\''") + "'"
  }

  // ══ Outputs: the panels a spec's renderer draws ═════════════════════════
  //
  // A renderer has `template(nid)`, the panel markup under the config bar,
  // and `update(root, cfg, ctx)`, which fills it for a normalized config.
  // ctx: { spec, engine }, where engine is an adapter from makeEngineAdapter
  // or null.

  var S = function (cls, text) { return '<span class="' + cls + '">' + esc(text) + '</span>' }
  var indent = function (n) { var o = ''; for (var i = 0; i < n; i++) o += '  '; return o }

  function renderSchemaFields (lines, fields, depth) {
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i]
      // Honor an explicit `required` flag (present on real-engine output);
      // default to optional for the interim JS schema.
      var req = f.required === true ? 'required' : 'optional'
      if (f.type === 'struct' && f.fields) {
        lines.push(indent(depth) + S('field-name', f.name) + ': ' + S('struct-brace', '{') + ' ' + S('field-req', req))
        renderSchemaFields(lines, f.fields, depth + 1)
        lines.push(indent(depth) + S('struct-brace', '}'))
      } else {
        lines.push(indent(depth) + S('field-name', f.name) + ': ' + S('field-type', f.type) + ' ' + S('field-req', req))
      }
    }
  }
  function renderRecordFields (lines, fields, values, depth) {
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i]
      if (f.type === 'struct' && f.fields && values[f.name]) {
        lines.push(indent(depth) + S('field-name', f.name) + ': ' + S('struct-brace', '{'))
        renderRecordFields(lines, f.fields, values[f.name], depth + 1)
        lines.push(indent(depth) + S('struct-brace', '}'))
      } else {
        var v = values[f.name]
        if (Array.isArray(v)) {
          var items = v.map(function (x) { return S('field-val-str', '"' + x + '"') }).join(', ')
          lines.push(indent(depth) + S('field-name', f.name) + ': [' + items + ']')
        } else if (typeof v === 'string') {
          lines.push(indent(depth) + S('field-name', f.name) + ': ' + S('field-val-str', '"' + v + '"'))
        } else {
          lines.push(indent(depth) + S('field-name', f.name) + ': ' + S('field-val-num', String(v)))
        }
      }
    }
  }

  function decodes (spec, cfg, path) {
    var info = valueInfo(spec, path, cfg[path])
    return !!(info && info.decodes)
  }

  function renderSchema (spec, cfg, valFields) {
    var lines = []
    var keyMode = cfg['key.mode'] || 'binary'
    var valMode = cfg['value.mode'] || 'binary'
    var layout = cfg['value.layout'] || 'flat'
    var hdrType = cfg['headers.value_type'] || 'binary'
    var valSchema = valFields || VAL_SCHEMA

    lines.push(S('struct-brace', 'row {'))
    lines.push(indent(1) + S('field-name', 'redpanda') + ': ' + S('struct-brace', '{') + ' ' + S('field-req', 'optional'))
    lines.push(indent(2) + S('field-name', 'partition') + ': ' + S('field-type', 'int') + ' ' + S('field-req', 'optional'))
    lines.push(indent(2) + S('field-name', 'offset') + ': ' + S('field-type', 'long') + ' ' + S('field-req', 'optional'))
    lines.push(indent(2) + S('field-name', 'timestamp') + ': ' + S('field-type', 'timestamptz') + ' ' + S('field-req', 'optional'))
    var hdrValType = hdrType === 'string' ? 'string' : 'binary'
    lines.push(indent(2) + S('field-name', 'headers') + ': ' + S('struct-brace', 'list<{') + ' ' + S('field-req', 'optional'))
    lines.push(indent(3) + S('field-name', 'key') + ': ' + S('field-type', 'string') + ' ' + S('field-req', 'required'))
    lines.push(indent(3) + S('field-name', 'value') + ': ' + S('field-type', hdrValType) + ' ' + S('field-req', 'optional'))
    lines.push(indent(2) + S('struct-brace', '}>'))
    if (decodes(spec, cfg, 'key.mode')) {
      lines.push(indent(2) + S('field-name', 'key') + ': ' + S('struct-brace', '{') + ' ' + S('field-req', 'optional'))
      for (var i = 0; i < KEY_SCHEMA.length; i++) {
        lines.push(indent(3) + S('field-name', KEY_SCHEMA[i].name) + ': ' + S('field-type', KEY_SCHEMA[i].type) + ' ' + S('field-req', 'optional'))
      }
      lines.push(indent(2) + S('struct-brace', '}'))
    } else {
      var keyType = keyMode === 'string' ? 'string' : 'binary'
      lines.push(indent(2) + S('field-name', 'key') + ': ' + S('field-type', keyType) + ' ' + S('field-req', 'optional'))
    }
    lines.push(indent(2) + S('field-name', 'timestamp_type') + ': ' + S('field-type', 'int') + ' ' + S('field-req', 'optional'))
    lines.push(indent(1) + S('struct-brace', '}'))

    if (decodes(spec, cfg, 'value.mode')) {
      var baseIndent = layout === 'flat' ? 1 : 2
      if (layout === 'flat') {
        lines.push(indent(1) + S('comment', '// value fields (flat layout)'))
      } else {
        lines.push(indent(1) + S('field-name', 'value') + ': ' + S('struct-brace', '{') + ' ' + S('field-req', 'optional'))
      }
      renderSchemaFields(lines, valSchema, baseIndent)
      if (layout !== 'flat') lines.push(indent(1) + S('struct-brace', '}'))
    } else {
      var valType = valMode === 'string' ? 'string' : 'binary'
      lines.push(indent(1) + S('field-name', 'value') + ': ' + S('field-type', valType) + ' ' + S('field-req', 'optional'))
    }
    lines.push(S('struct-brace', '}'))
    return lines.join('\n')
  }

  function renderRecord (spec, cfg) {
    var lines = []
    var keyMode = cfg['key.mode'] || 'binary'
    var valMode = cfg['value.mode'] || 'binary'
    var layout = cfg['value.layout'] || 'flat'
    var hdrType = cfg['headers.value_type'] || 'binary'
    var tsUs = RECORD.timestamp * 1000

    lines.push(S('struct-brace', '{'))
    lines.push(indent(1) + S('field-name', 'redpanda') + ': ' + S('struct-brace', '{'))
    lines.push(indent(2) + S('field-name', 'partition') + ': ' + S('field-val-num', '3'))
    lines.push(indent(2) + S('field-name', 'offset') + ': ' + S('field-val-num', '42'))
    lines.push(indent(2) + S('field-name', 'timestamp') + ': ' + S('field-val-num', String(tsUs)))
    lines.push(indent(2) + S('field-name', 'headers') + ': [')
    for (var i = 0; i < RECORD.headers.length; i++) {
      var h = RECORD.headers[i]
      var valCls = hdrType === 'string' ? 'field-val-str' : 'field-val-bin'
      var valPrefix = hdrType === 'string' ? '' : 'b'
      lines.push(indent(3) + S('struct-brace', '{') + ' ' + S('field-name', 'key') + ': ' + S('field-val-str', '"' + h.key + '"') +
        ', ' + S('field-name', 'value') + ': ' + S(valCls, valPrefix + '"' + h.value + '"') + ' ' + S('struct-brace', '}'))
    }
    lines.push(indent(2) + ']')
    if (decodes(spec, cfg, 'key.mode')) {
      lines.push(indent(2) + S('field-name', 'key') + ': ' + S('struct-brace', '{'))
      lines.push(indent(3) + S('field-name', 'user_id') + ': ' + S('field-val-num', '12345'))
      lines.push(indent(3) + S('field-name', 'region') + ': ' + S('field-val-str', '"us-west-2"'))
      lines.push(indent(2) + S('struct-brace', '}'))
    } else if (keyMode === 'string') {
      lines.push(indent(2) + S('field-name', 'key') + ': ' + S('field-val-str', '"\\x00\\x00...us-west-2"'))
    } else {
      lines.push(indent(2) + S('field-name', 'key') + ': ' + S('field-val-bin', 'b"\\x00\\x00\\x00\\x00\\x01\\xf2\\xc0\\x01\\x12us-west-2"'))
    }
    lines.push(indent(2) + S('field-name', 'timestamp_type') + ': ' + S('field-val-num', '0'))
    lines.push(indent(1) + S('struct-brace', '}'))
    if (decodes(spec, cfg, 'value.mode')) {
      var baseIndent = layout === 'flat' ? 1 : 2
      if (layout !== 'flat') lines.push(indent(1) + S('field-name', 'value') + ': ' + S('struct-brace', '{'))
      renderRecordFields(lines, VAL_SCHEMA, RECORD.value, baseIndent)
      if (layout !== 'flat') lines.push(indent(1) + S('struct-brace', '}'))
    } else if (valMode === 'string') {
      lines.push(indent(1) + S('field-name', 'value') + ': ' + S('field-val-str', '"\\x00\\x00...ORD-98765..."'))
    } else {
      lines.push(indent(1) + S('field-name', 'value') + ': ' + S('field-val-bin', 'b"\\x00\\x00\\x00\\x00\\x02\\x12ORD-98765..."'))
    }
    lines.push(S('struct-brace', '}'))
    return lines.join('\n')
  }

  var OUTPUTS = {
    // An Iceberg table row: the table schema and one translated record.
    icebergRow: {
      template: function () {
        return '<div class="ice-card"><h3>Iceberg table schema <span class="ice-tag" data-out="engine"></span></h3>' +
          '<p class="ice-help">Illustrative: a fixed Avro key and value schema with one sample record. ' +
            'subject and protobuf_name pick a schema in Schema Registry, so they do not change this sample.</p>' +
          '<pre class="ice-tree" data-out="schema"></pre></div>' +
          '<div class="ice-card"><h3>Translated record</h3><pre class="ice-tree" data-out="record"></pre></div>'
      },
      update: function (root, cfg, ctx) {
        // Use the real WASM engine's value fields when loaded and the value is
        // decoded via a schema; otherwise fall back to the interim JS rules.
        var valueFields = ctx.engine && ctx.engine.valueFields
        var useEngine = valueFields && decodes(ctx.spec, cfg, 'value.mode')
        root.querySelector('[data-out="schema"]').innerHTML = renderSchema(ctx.spec, cfg, useEngine ? valueFields : null)
        root.querySelector('[data-out="record"]').innerHTML = renderRecord(ctx.spec, cfg)
        // Engine provenance badge on the schema card.
        var engEl = root.querySelector('[data-out="engine"]')
        if (!engEl) return
        if (useEngine) {
          engEl.className = 'ice-tag ice-engine-real'
          engEl.textContent = 'real engine · wasm'
        } else if (valueFields) {
          engEl.className = 'ice-tag ice-engine-real'
          engEl.textContent = 'real engine · wasm ready'
        } else {
          // No engine build is published yet; the illustrative note under
          // the heading says what the panels show.
          engEl.className = 'ice-tag'
          engEl.textContent = ''
        }
      },
    },
  }

  // ══ Markup, generated from the spec ═════════════════════════════════════
  //
  // `nid` is a per-instance id so radio `name` attributes and element ids are
  // unique: browsers group radios by name document-wide, so two explorers on
  // one page would otherwise fight over the checked state of same-named
  // groups. Every control is labelled with its section ("Key mode", "Value
  // subject"): key, value and headers all offer the same choices, so a bare
  // "binary" or "subject" would not say which section it sets. The section
  // word is in a visually hidden span because the card heading already shows
  // it.

  var idOf = function (nid, path, suffix) { return nid + '-' + path.replace(/\./g, '-') + (suffix ? '-' + suffix : '') }

  // Text fields in a section that share one enable rule share one hint; the
  // hint belongs to the first of them.
  function hintPathFor (sec, field) {
    if (!field.enabledWhen) return null
    if (field.type === 'enum') return sec.name + '.' + field.name
    var key = JSON.stringify(field.enabledWhen)
    var first = sec.fields.filter(function (f) { return f.type === 'text' && f.enabledWhen && JSON.stringify(f.enabledWhen) === key })[0]
    return sec.name + '.' + first.name
  }

  function hintHtml (nid, path, field) {
    return '<p class="ice-hint" id="' + idOf(nid, path, 'hint') + '" data-hint="' + path + '" hidden>' + esc(enabledHintFor(field)) + '</p>'
  }

  function enumFieldHtml (nid, sec, f) {
    var path = sec.name + '.' + f.name
    var radios = f.values.map(function (v) {
      return '<label class="ice-radio"><input type="radio" name="' + nid + '__' + path + '" data-path="' + path + '" value="' + esc(v.value) + '"' +
        (v.value === f.default ? ' checked' : '') + '><span>' + esc(v.value) + '</span></label>'
    }).join('')
    return '<fieldset class="ice-field" data-fieldset="' + path + '">' +
      '<legend class="ice-label"><span class="ice-sr">' + esc(sec.label) + ' </span>' + esc(f.label || f.name) + '</legend>' +
      '<div class="ice-radios">' + radios + '</div>' +
      '<p class="ice-help" id="' + idOf(nid, path, 'help') + '" data-help="' + path + '"></p>' +
      (f.enabledWhen ? hintHtml(nid, path, f) : '') +
      '</fieldset>'
  }

  function textFieldHtml (nid, sec, f) {
    var path = sec.name + '.' + f.name
    var inputId = idOf(nid, path)
    return '<div class="ice-textrow" data-row="' + path + '">' +
      '<label for="' + inputId + '"><span class="ice-sr">' + esc(sec.label) + ' </span>' + esc(f.label || f.name) + '</label>' +
      '<input type="text" id="' + inputId + '" data-path="' + path + '"' +
        (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') + (f.enabledWhen ? ' disabled' : '') + '>' +
      '<p class="ice-error" id="' + idOf(nid, path, 'error') + '" data-error="' + path + '" hidden></p></div>'
  }

  function sectionHtml (nid, sec) {
    var enums = sec.fields.filter(function (f) { return f.type === 'enum' })
    var texts = sec.fields.filter(function (f) { return f.type === 'text' })
    var html = '<div class="ice-card" data-section="' + sec.name + '"><h3>' + esc(sec.heading || sec.label) + '</h3>'
    html += enums.map(function (f) { return enumFieldHtml(nid, sec, f) }).join('')
    if (texts.length) {
      html += '<div class="ice-opts">' + texts.map(function (f) { return textFieldHtml(nid, sec, f) }).join('')
      texts.forEach(function (f) {
        var hp = hintPathFor(sec, f)
        if (hp === sec.name + '.' + f.name) html += hintHtml(nid, hp, f)
      })
      html += '</div>'
    }
    return html + '</div>'
  }

  function template (spec, nid) {
    var outputs = OUTPUTS[spec.outputs]
    return '' +
    '<div class="ice-grid">' +
      '<div class="ice-left">' + spec.sections.map(function (sec) { return sectionHtml(nid, sec) }).join('') + '</div>' +
      '<div class="ice-right">' +
        '<div class="ice-configbar">' +
          '<div class="ice-confighead"><span class="ice-configlabel" id="' + nid + '-cfglabel">Value for <code class="ice-prop">' + esc(spec.property) + '</code></span>' +
            '<span class="ice-tag" data-out="format"></span>' +
            '<span class="ice-copies">' +
              '<button type="button" class="ice-copy" data-copy="value">Copy</button>' +
              '<button type="button" class="ice-copy" data-copy="rpk">Copy rpk command</button>' +
            '</span>' +
            '<span class="ice-sr" role="status" data-out="copy-status"></span></div>' +
          // Announce the string, and only the string, when a control changes it.
          '<code class="ice-configstr" data-out="config" aria-live="polite" aria-atomic="true" aria-labelledby="' + nid + '-cfglabel"></code>' +
          '<p class="ice-help" data-out="format-help"></p>' +
          '<p class="ice-error" data-out="config-error" hidden></p>' +
          // Why the page's own data-config was not used. role=alert, because
          // it replaces what the author meant to show.
          '<p class="ice-error" data-out="config-alert" role="alert" hidden></p>' +
        '</div>' +
        (outputs ? outputs.template(nid) : '') +
      '</div>' +
    '</div>'
  }

  // Copy text to the clipboard. Resolves true only when the write succeeded,
  // so the button never says "Copied!" for a write that did not happen.
  function copyText (text, clipboard) {
    if (!clipboard || typeof clipboard.writeText !== 'function') return Promise.resolve(false)
    try {
      return Promise.resolve(clipboard.writeText(text)).then(function () { return true }, function () { return false })
    } catch (e) {
      return Promise.resolve(false)
    }
  }

  // ══ Hydration ═══════════════════════════════════════════════════════════

  var instanceCounter = 0
  function pageVersion (root) {
    var nav = typeof document !== 'undefined' && document.querySelector('.nav-container')
    return root.getAttribute('data-version') || (nav && nav.getAttribute('data-version')) ||
      (typeof document !== 'undefined' && document.body && document.body.getAttribute('data-version')) || ''
  }

  function hydrate (root, spec) {
    var docVersion = pageVersion(root)
    spec = spec || specForVersion(docVersion)
    var nid = 'ice' + (++instanceCounter)
    // The page's data-config while it is shown instead of the controls'
    // string: { str, errors } when Redpanda would reject it, { str, note }
    // when it is valid but the controls cannot show it (disabled). Cleared by
    // the first change to a control.
    var authorState = null
    var engine = null // engine adapter, set when a WASM build loads
    // The config string update() last rendered. Copy uses this, never the DOM
    // text, so markup in the code element (<wbr>, tags) cannot reach the clipboard.
    var currentConfig = ''
    var entries = fieldsOf(spec)
    root.innerHTML = template(spec, nid)
    var q = function (sel) { return root.querySelector(sel) }
    // Controls are found by data-path within this mount, never by the global
    // radio name. Paths come from the spec, never from the page.
    var controls = function (path) { return Array.prototype.slice.call(root.querySelectorAll('[data-path="' + path + '"]')) }
    var byData = function (attr, path) { return q('[' + attr + '="' + path + '"]') }

    function getConfig () {
      var cfg = {}
      entries.forEach(function (e) {
        var els = controls(e.path)
        if (e.field.type === 'enum') {
          var checked = els.filter(function (r) { return r.checked })[0]
          cfg[e.path] = checked ? checked.value : e.field.default
        } else {
          cfg[e.path] = els[0] ? els[0].value.trim() : ''
        }
      })
      return cfg
    }

    // Put a parsed config onto the controls. Values are compared, never put
    // into a selector: they can come from the author's data-config.
    function setConfig (cfg) {
      entries.forEach(function (e) {
        if (!hasOwn(cfg, e.path)) return
        var els = controls(e.path)
        if (e.field.type === 'enum') {
          var el = els.filter(function (r) { return r.value === cfg[e.path] })[0]
          if (el) el.checked = true
        } else if (els[0]) {
          els[0].value = cfg[e.path]
        }
      })
    }

    // Apply an author-supplied initial config string (data-config). A string
    // Redpanda rejects is shown as written, with Redpanda's reason, rather
    // than replaced by defaults without a word.
    function applyInitialConfig (str) {
      if (str === null || str === undefined || str === '') return
      var parsed = parse(spec, str, { version: docVersion })
      if (parsed.errors.length) {
        authorState = { str: str, errors: parsed.errors }
        var e = parsed.errors[0]
        warn('data-config "' + str + '" is not a valid ' + spec.property + (docVersion ? ' for ' + docVersion : '') +
          ': ' + e.message + (e.reason ? ' (' + e.reason + ')' : ''))
        return
      }
      setConfig(parsed.cfg)
      if (parsed.form === 'disabled') {
        authorState = { str: spec.disabledLiteral, note: 'Iceberg is off for the topic, so no table is written. Pick a mode to see one.' }
      }
    }

    // aria-describedby lists only the ids of visible descriptions.
    function describe (el, ids) {
      if (!el) return
      var live = ids.filter(function (id) { var d = root.querySelector('[id="' + id + '"]'); return d && !d.hidden && d.textContent })
      if (live.length) el.setAttribute('aria-describedby', live.join(' '))
      else el.removeAttribute('aria-describedby')
    }

    function update (event) {
      if (event) authorState = null
      var raw = getConfig()
      var built = build(spec, raw)
      var invalid = false

      entries.forEach(function (e) {
        var on = isEnabled(e, raw)
        var hp = hintPathFor(e.section, e.field)
        // Values are kept while a field is disabled, so switching back
        // restores them; build() leaves disabled fields out of the string.
        controls(e.path).forEach(function (el) { el.disabled = !on })
        if (hp === e.path) byData('data-hint', hp).hidden = on
        var hintId = hp ? idOf(nid, hp, 'hint') : null

        if (e.field.type === 'enum') {
          // Help line for the checked choice. A disabled group gets its hint
          // instead of help for a choice that does not apply.
          var help = byData('data-help', e.path)
          var info = valueInfo(spec, e.path, raw[e.path])
          if (help) help.textContent = on && info ? (info.help || '') : ''
          describe(byData('data-fieldset', e.path), [idOf(nid, e.path, 'help')].concat(hintId ? [hintId] : []))
          return
        }

        // Check text values where they are written. An invalid value marks
        // the field and the string, and nothing is offered for copy.
        var input = controls(e.path)[0]
        var errEl = byData('data-error', e.path)
        var problem = on ? valueProblem(spec, raw[e.path], !built.legacy) : null
        if (problem && problem.error) invalid = true
        if (errEl) {
          errEl.textContent = problem ? (problem.error || problem.note) : ''
          errEl.hidden = !problem
          errEl.className = problem && problem.note ? 'ice-note' : 'ice-error'
        }
        if (input) {
          if (problem && problem.error) input.setAttribute('aria-invalid', 'true')
          else input.removeAttribute('aria-invalid')
          describe(input, [idOf(nid, e.path, 'error')].concat(hintId ? [hintId] : []))
        }
      })

      var shown = built.str
      var info = formatInfo(spec, built)
      var alert = q('[data-out="config-alert"]')
      var authorBad = !!(authorState && authorState.errors)
      if (authorState) {
        shown = authorState.str
        if (authorBad) {
          invalid = true
          var e = authorState.errors[0]
          alert.textContent = "This page's setting is not valid: " + e.message + (e.reason ? ' (' + e.reason + ')' : '') +
            '. The controls show the defaults.'
        } else {
          info = { tag: formatInfo(spec, { legacy: true }).tag, help: authorState.note }
        }
      }
      alert.hidden = !authorBad
      if (!authorBad) alert.textContent = ''

      currentConfig = invalid ? '' : shown
      var cfgEl = q('[data-out="config"]')
      // Line breaks go after the separators, so a long string wraps between
      // sections and options instead of inside a key.
      cfgEl.innerHTML = esc(shown).replace(/([;,])/g, '$1<wbr>')
      cfgEl.classList.toggle('ice-invalid', invalid)
      var errBox = q('[data-out="config-error"]')
      var fieldBad = invalid && !authorBad
      errBox.hidden = !fieldBad
      errBox.textContent = fieldBad ? 'Not a valid setting. Fix the highlighted field to copy it.' : ''
      root.querySelectorAll('[data-copy]').forEach(function (b) { b.disabled = invalid })
      var fmtEl = q('[data-out="format"]')
      fmtEl.className = 'ice-tag ' + (invalid ? 'ice-bad' : 'ice-info')
      fmtEl.textContent = invalid ? 'Not valid' : info.tag
      q('[data-out="format-help"]').textContent = invalid ? '' : info.help

      var outputs = OUTPUTS[spec.outputs]
      if (outputs) outputs.update(root, normalize(spec, raw), { spec: spec, engine: engine })
    }

    root.querySelectorAll('input[type="radio"]').forEach(function (r) { r.addEventListener('change', update) })
    root.querySelectorAll('input[type="text"]').forEach(function (i) { i.addEventListener('input', update) })

    // Load the real WASM engine (shared singleton) for this doc version;
    // re-render when its value fields are available so the schema panel
    // reflects production behavior. Falls back to the interim JS engine.
    if (spec.outputs === 'icebergRow') {
      loadEngine(docVersion, root.getAttribute('data-engine-base')).then(function (loaded) {
        if (loaded) { engine = loaded; update() }
      })
    }

    var copyStatus = q('[data-out="copy-status"]')
    var copyTimer = null
    root.querySelectorAll('[data-copy]').forEach(function (btn) {
      var label = btn.textContent
      var what = btn.getAttribute('data-copy') === 'rpk' ? 'rpk command' : 'config string'
      btn.addEventListener('click', function () {
        if (!currentConfig) return
        var text = btn.getAttribute('data-copy') === 'rpk' ? rpkCommand(currentConfig, spec.property) : currentConfig
        copyText(text, navigator.clipboard).then(function (ok) {
          root.querySelectorAll('[data-copy]').forEach(function (b) {
            b.textContent = b.getAttribute('data-copy') === 'rpk' ? 'Copy rpk command' : 'Copy'
            b.classList.remove('ice-copied', 'ice-copy-failed')
          })
          btn.textContent = ok ? 'Copied!' : 'Copy failed'
          btn.classList.add(ok ? 'ice-copied' : 'ice-copy-failed')
          if (copyStatus) copyStatus.textContent = ok ? 'Copied the ' + what : 'Could not copy the ' + what
          if (copyTimer) clearTimeout(copyTimer)
          copyTimer = setTimeout(function () {
            copyTimer = null
            btn.textContent = label
            btn.classList.remove('ice-copied', 'ice-copy-failed')
            if (copyStatus) copyStatus.textContent = ''
          }, 1500)
        })
      })
    })

    // Author-supplied initial config. The macro also emits data-defaults, but
    // its config is always the same string as data-config, so only that is read.
    applyInitialConfig(root.getAttribute('data-config'))
    update()
  }

  // Keep in step with MOUNT_ATTRIBUTE in docs-extensions-and-macros
  // macros/iceberg-explorer.js. tests/iceberg-dsl/conformance-test.js pins it.
  var MOUNT_SELECTOR = '[data-iceberg-explorer]'

  // The value of the mount attribute is the contract version the macro wrote.
  // A mount this module does not understand keeps its fallback text.
  //   1: data-config, data-version, data-engine-base.
  //   2: as 1, plus data-property naming the property the mount explores.
  var SPECS = [ICEBERG_MODE]
  function mountProblem (root) {
    var contract = root.getAttribute('data-iceberg-explorer')
    if (contract === '1') return null
    if (contract === '2') {
      var prop = root.getAttribute('data-property')
      if (prop === null || SPECS.some(function (s) { return s.property === prop })) return null
      return 'unsupported data-property "' + prop + '" (this build supports ' + SPECS.map(function (s) { return s.property }).join(', ') + ')'
    }
    return 'unsupported contract version "' + contract + '" (this build supports 1 and 2)'
  }
  // The spec revision for the mount's property and the release its page
  // documents.
  function specFor (root) {
    var prop = root.getAttribute('data-property')
    if (prop && prop !== ICEBERG_MODE.property) return SPECS.filter(function (s) { return s.property === prop })[0]
    return specForVersion(pageVersion(root))
  }

  function warn (msg) {
    if (typeof console !== 'undefined' && console.warn) console.warn('iceberg-explorer: ' + msg)
  }

  function init (doc) {
    doc = doc || document
    var mounts = doc.querySelectorAll(MOUNT_SELECTOR)
    for (var i = 0; i < mounts.length; i++) {
      var root = mounts[i]
      if (root.getAttribute('data-hydrated')) continue
      var problem = mountProblem(root)
      if (problem) {
        root.setAttribute('data-hydrated', 'skipped')
        warn('kept the fallback for a mount with ' + problem)
        continue
      }
      root.setAttribute('data-hydrated', 'true')
      // One broken mount must not stop the rest of the page.
      var fallback = root.innerHTML
      try {
        hydrate(root, specFor(root))
      } catch (e) {
        root.innerHTML = fallback
        root.setAttribute('data-hydrated', 'failed')
        warn('could not render a mount, kept the fallback: ' + (e && e.message))
      }
    }
  }

  // DOM bootstrap only in a browser (the bundle defines `module`, so this
  // does not test for it). Under Node there is no document and only the
  // exports below apply.
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      // init takes a document; the event listener would pass it the Event.
      document.addEventListener('DOMContentLoaded', function () { init() })
    } else {
      init()
    }
  }

  // Export the logic for tests under Node and for the bundle.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      ICEBERG_MODE: ICEBERG_MODE,
      ICEBERG_MODE_25_1: ICEBERG_MODE_25_1,
      ICEBERG_MODE_24_3: ICEBERG_MODE_24_3,
      specForVersion: specForVersion,
      specFor: specFor,
      MODES: MODES,
      SPECS: SPECS,
      OUTPUTS: OUTPUTS,
      build: build,
      parse: parse,
      normalize: normalize,
      defaultsOf: defaultsOf,
      fieldsOf: fieldsOf,
      isEnabled: isEnabled,
      enabledHintFor: enabledHintFor,
      valueProblem: valueProblem,
      formatInfo: formatInfo,
      template: template,
      hydrate: hydrate,
      init: init,
      copyText: copyText,
      rpkCommand: rpkCommand,
      mountProblem: mountProblem,
      MOUNT_SELECTOR: MOUNT_SELECTOR,
      isSafeEngineBase: isSafeEngineBase,
      makeEngineAdapter: makeEngineAdapter,
      loadEngine: loadEngine,
    }
  }
})()
