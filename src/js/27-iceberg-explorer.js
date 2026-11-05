;(function () {
  'use strict'

  // Iceberg Mode Explorer — docs-ui hydration module.
  //
  // The `[iceberg-explorer]` block (docs-extensions-and-macros) emits a mount
  // point carrying the `data-iceberg-explorer` attribute (its value is the
  // mount contract version) plus a fallback paragraph. That attribute is the
  // contract: the class names are presentation and have already changed once
  // (`.iceberg-explorer` to `.iceberg-explorer-mount`), which left this module
  // finding zero mounts while every page showed the fallback. This module
  // finds every such mount point and renders the interactive tool into it.
  //
  // ENGINE SEAM: all translation logic lives behind `translate(cfg)` below.
  // Today that is an in-browser port of the rules in Redpanda's
  // `model/iceberg_mode` + `iceberg/conversion` (an interim engine). It is
  // structured so a per-version WASM build of the real C++ engine can be
  // dropped in later without touching the UI — see docs-ui/iceberg-editor/.

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

  // ── Real WASM engine loader (lazy singleton). Resolves to the parsed value
  //    fields computed by Redpanda's actual C++ Avro->Iceberg mapper, or null
  //    if no engine can be loaded (then the interim JS engine is used).
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
  var enginePromise = null
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
  // Load one candidate; resolve to value fields, or null on any failure so the
  // caller can try the next candidate.
  function tryCandidate (cand) {
    return new Promise(function (resolve) {
      var url = cand.dir.replace(/\/$/, '') + '/' + cand.file
      var script = document.createElement('script')
      script.src = url
      script.onload = function () {
        // Emscripten is built with MODULARIZE + EXPORT_NAME=createIcebergEngine,
        // so the loaded classic script leaves the factory on `window`.
        if (typeof window.createIcebergEngine !== 'function') { resolve(null); return }
        window.createIcebergEngine({ locateFile: function (p) { return cand.dir.replace(/\/$/, '') + '/' + p } })
          .then(function (mod) {
            try {
              var parsed = JSON.parse(mod.avroToIcebergJson(AVRO_VALUE_SCHEMA))
              resolve(parsed.error ? null : parsed.fields)
            } catch (e) { resolve(null) }
          }, function () { resolve(null) })
      }
      script.onerror = function () { resolve(null) }
      document.head.appendChild(script)
    })
  }
  function loadEngineValueFields (version, overrideBase) {
    if (enginePromise) return enginePromise
    var cands = engineCandidates(version, overrideBase)
    enginePromise = (function next (i) {
      if (i >= cands.length) return Promise.resolve(null)
      return tryCandidate(cands[i]).then(function (fields) {
        return fields || next(i + 1)
      })
    })(0)
    return enginePromise
  }

  function esc (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
  function isSchemaMode (mode) {
    return mode === 'schema_id_prefix' || mode === 'schema_latest'
  }

  // Which modes of its section each dependent option is valid with. This is
  // the one copy of the rule: buildConfigString drops an option outside these
  // modes, update() disables its control, and the hint under the control is
  // generated from it. Upstream: "subject and protobuf_name require
  // mode=schema_latest" and "layout=nested requires a schema mode
  // (schema_id_prefix or schema_latest)" in model.cc parse_extended_iceberg_mode.
  var ENABLED_WITH = {
    subject: ['schema_latest'],
    protobuf_name: ['schema_latest'],
    layout: ['schema_id_prefix', 'schema_latest'],
  }
  function optionEnabled (option, mode) {
    return ENABLED_WITH[option].indexOf(mode) !== -1
  }
  function enabledHint (option) {
    return 'Only with ' + ENABLED_WITH[option].join(' or ')
  }

  // One line of help per choice, shown under its group for the checked value.
  // Wording follows the "Specify Iceberg Schema" docs page.
  var MODE_HELP = {
    binary: 'Raw bytes, not decoded.',
    string: 'Decoded as UTF-8. Invalid bytes become U+FFFD.',
    schema_id_prefix: 'Decoded with the schema whose ID is embedded in each record, in Schema Registry wire format.',
    schema_latest: 'Decoded with the latest schema registered for the subject.',
  }
  var CHOICE_HELP = {
    'key-mode': MODE_HELP,
    'val-mode': MODE_HELP,
    'val-layout': {
      flat: 'Value fields become top-level columns.',
      nested: 'Value fields go in one value struct column.',
    },
    'hdr-type': {
      binary: 'Header values stay raw bytes. Header keys are always strings.',
      string: 'Header values are decoded as UTF-8. Invalid bytes become U+FFFD.',
    },
  }

  // Which Redpanda versions accept a built string. Section strings are only
  // built when a setting has no short form, and those need the
  // iceberg_extended_mode_config feature: "extended key/headers config
  // requires the cluster to be fully upgraded to at least v26.2.1"
  // (config_utils.h iceberg_config_validator). value_schema_latest first
  // parses in v25.1.1; key_value and value_schema_id_prefix in every release
  // with Iceberg.
  function formatInfo (built) {
    if (!built.legacy) {
      return { tag: 'Requires v26.2.1 or later', help: 'Redpanda accepts this form once every broker in the cluster runs v26.2.1 or later.' }
    }
    if (/^value_schema_latest/.test(built.str)) {
      return { tag: 'Requires v25.1 or later', help: 'Short form. Redpanda shows a setting in this form whenever it fits, because older clusters accept it.' }
    }
    return { tag: 'Works on all versions', help: 'Short form. Redpanda shows a setting in this form whenever it fits, because older clusters accept it.' }
  }

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
  function optionValueProblem (value, sectionForm) {
    for (var i = 0; i < VALUE_RULES.length; i++) {
      var r = VALUE_RULES[i]
      if (r.sectionFormOnly && !sectionForm) continue
      if (r.re.test(value)) return r.error ? { error: r.error } : { note: r.note }
    }
    return null
  }

  // A shell command that sets the property. The value is single-quoted
  // because ';' would end the command; rpk's --set is a string array, so ','
  // inside the value is not split.
  function rpkCommand (value) {
    return "rpk topic alter-config <topic-name> --set '" + ('redpanda.iceberg.mode=' + value).replace(/'/g, "'\\''") + "'"
  }

  // ── Config-string builder — mirrors model/model.cc format_to():
  //    legacy strings when legacy-compatible, else the section-based DSL,
  //    always serializing all sections (matches PR #31035 behavior).
  function buildConfigString (cfg) {
    // Redpanda rejects layout=nested outside a schema mode, and subject or
    // protobuf_name outside schema_latest (iceberg_mode_test.cc
    // IcebergModeLayout.ParseNestedWith*Rejected, IcebergModeParseError.
    // SubjectWith*Mode). Controls can still hold those values after a mode
    // change, so drop them here instead of serializing a rejected string.
    var keySubject = optionEnabled('subject', cfg.keyMode) ? cfg.keySubject : ''
    var keyProto = optionEnabled('protobuf_name', cfg.keyMode) ? cfg.keyProto : ''
    var valSubject = optionEnabled('subject', cfg.valMode) ? cfg.valSubject : ''
    var valProto = optionEnabled('protobuf_name', cfg.valMode) ? cfg.valProto : ''
    var valLayout = optionEnabled('layout', cfg.valMode) ? cfg.valLayout : 'flat'
    var keyDefault = cfg.keyMode === 'binary'
    var hdrDefault = cfg.hdrType === 'binary'
    var valLayoutDefault = valLayout === 'flat'
    var valNotString = cfg.valMode !== 'string'
    var legacyCompat = keyDefault && hdrDefault && valLayoutDefault && valNotString

    if (legacyCompat) {
      if (cfg.valMode === 'binary') return { str: 'key_value', legacy: true }
      if (cfg.valMode === 'schema_id_prefix') return { str: 'value_schema_id_prefix', legacy: true }
      if (cfg.valMode === 'schema_latest') {
        // Legacy option order (model.cc format_to): protobuf_name then subject.
        var s = 'value_schema_latest'
        var opts = []
        if (valProto) opts.push('protobuf_name=' + valProto)
        if (valSubject) opts.push('subject=' + valSubject)
        if (opts.length) s += ':' + opts.join(',')
        return { str: s, legacy: true }
      }
    }

    // Section format (model.cc): always emit all sections and all options so
    // defaults are frozen at set-time. Key: mode, subject?, protobuf_name?.
    // Value: mode, subject?, protobuf_name?, layout (always, last).
    var sections = []
    var keyOpts = ['mode=' + cfg.keyMode]
    if (keySubject) keyOpts.push('subject=' + keySubject)
    if (keyProto) keyOpts.push('protobuf_name=' + keyProto)
    sections.push('key:' + keyOpts.join(','))

    var valOpts = ['mode=' + cfg.valMode]
    if (valSubject) valOpts.push('subject=' + valSubject)
    if (valProto) valOpts.push('protobuf_name=' + valProto)
    valOpts.push('layout=' + valLayout)
    sections.push('value:' + valOpts.join(','))

    sections.push('headers:value_type=' + cfg.hdrType)
    return { str: sections.join(';'), legacy: false }
  }

  // ── Config-string parser: the inverse of buildConfigString. Returns only the
  //    cfg keys the string sets. The legacy names are matched explicitly
  //    because the section format allows omitted sections, so a valid section
  //    string such as `value:mode=schema_latest` need not contain ';'.
  var LEGACY_VALUE_MODES = { key_value: 'binary', value_schema_id_prefix: 'schema_id_prefix', value_schema_latest: 'schema_latest' }
  var OPTION_KEYS = { subject: 'Subject', protobuf_name: 'Proto' }
  function parseConfigString (str) {
    var out = {}
    if (!str) return out
    str = String(str).trim()
    var colon = str.indexOf(':')
    var head = colon === -1 ? str : str.slice(0, colon)
    if (Object.prototype.hasOwnProperty.call(LEGACY_VALUE_MODES, head)) {
      out.valMode = LEGACY_VALUE_MODES[head]
      if (colon !== -1) parseOptions('val', str.slice(colon + 1), out)
      return out
    }
    var prefixFor = { key: 'key', value: 'val' }
    str.split(';').forEach(function (section) {
      var i = section.indexOf(':')
      if (i === -1) return
      var name = section.slice(0, i).trim()
      var opts = section.slice(i + 1)
      if (name === 'headers') {
        opts.split(',').forEach(function (opt) {
          var kv = opt.split('=')
          if (kv[0].trim() === 'value_type' && kv[1]) out.hdrType = kv[1].trim()
        })
      } else if (prefixFor[name]) {
        parseOptions(prefixFor[name], opts, out)
      }
    })
    return out
  }
  function parseOptions (prefix, opts, out) {
    opts.split(',').forEach(function (opt) {
      var eq = opt.indexOf('=')
      if (eq === -1) return
      var k = opt.slice(0, eq).trim()
      var v = opt.slice(eq + 1).trim()
      if (!v) return
      if (k === 'mode') out[prefix + 'Mode'] = v
      else if (k === 'layout' && prefix === 'val') out.valLayout = v
      else if (OPTION_KEYS[k]) out[prefix + OPTION_KEYS[k]] = v
    })
  }

  function renderSchemaFields (lines, fields, depth, S, indent) {
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i]
      // Honor an explicit `required` flag (present on real-engine output);
      // default to optional for the interim JS schema.
      var req = f.required === true ? 'required' : 'optional'
      if (f.type === 'struct' && f.fields) {
        lines.push(indent(depth) + S('field-name', f.name) + ': ' + S('struct-brace', '{') + ' ' + S('field-req', req))
        renderSchemaFields(lines, f.fields, depth + 1, S, indent)
        lines.push(indent(depth) + S('struct-brace', '}'))
      } else {
        lines.push(indent(depth) + S('field-name', f.name) + ': ' + S('field-type', f.type) + ' ' + S('field-req', req))
      }
    }
  }
  function renderRecordFields (lines, fields, values, depth, S, indent) {
    for (var i = 0; i < fields.length; i++) {
      var f = fields[i]
      if (f.type === 'struct' && f.fields && values[f.name]) {
        lines.push(indent(depth) + S('field-name', f.name) + ': ' + S('struct-brace', '{'))
        renderRecordFields(lines, f.fields, values[f.name], depth + 1, S, indent)
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

  function renderSchema (cfg, valFields) {
    var lines = []
    var S = function (cls, text) { return '<span class="' + cls + '">' + esc(text) + '</span>' }
    var indent = function (n) { var o = ''; for (var i = 0; i < n; i++) o += '  '; return o }
    var useKeySchema = isSchemaMode(cfg.keyMode)
    var useValSchema = isSchemaMode(cfg.valMode)
    var valSchema = valFields || VAL_SCHEMA

    lines.push(S('struct-brace', 'row {'))
    lines.push(indent(1) + S('field-name', 'redpanda') + ': ' + S('struct-brace', '{') + ' ' + S('field-req', 'optional'))
    lines.push(indent(2) + S('field-name', 'partition') + ': ' + S('field-type', 'int') + ' ' + S('field-req', 'optional'))
    lines.push(indent(2) + S('field-name', 'offset') + ': ' + S('field-type', 'long') + ' ' + S('field-req', 'optional'))
    lines.push(indent(2) + S('field-name', 'timestamp') + ': ' + S('field-type', 'timestamptz') + ' ' + S('field-req', 'optional'))
    var hdrValType = cfg.hdrType === 'string' ? 'string' : 'binary'
    lines.push(indent(2) + S('field-name', 'headers') + ': ' + S('struct-brace', 'list<{') + ' ' + S('field-req', 'optional'))
    lines.push(indent(3) + S('field-name', 'key') + ': ' + S('field-type', 'string') + ' ' + S('field-req', 'required'))
    lines.push(indent(3) + S('field-name', 'value') + ': ' + S('field-type', hdrValType) + ' ' + S('field-req', 'optional'))
    lines.push(indent(2) + S('struct-brace', '}>'))
    if (useKeySchema) {
      lines.push(indent(2) + S('field-name', 'key') + ': ' + S('struct-brace', '{') + ' ' + S('field-req', 'optional'))
      for (var i = 0; i < KEY_SCHEMA.length; i++) {
        lines.push(indent(3) + S('field-name', KEY_SCHEMA[i].name) + ': ' + S('field-type', KEY_SCHEMA[i].type) + ' ' + S('field-req', 'optional'))
      }
      lines.push(indent(2) + S('struct-brace', '}'))
    } else {
      var keyType = cfg.keyMode === 'string' ? 'string' : 'binary'
      lines.push(indent(2) + S('field-name', 'key') + ': ' + S('field-type', keyType) + ' ' + S('field-req', 'optional'))
    }
    lines.push(indent(2) + S('field-name', 'timestamp_type') + ': ' + S('field-type', 'int') + ' ' + S('field-req', 'optional'))
    lines.push(indent(1) + S('struct-brace', '}'))

    if (useValSchema) {
      var baseIndent = cfg.valLayout === 'flat' ? 1 : 2
      if (cfg.valLayout === 'flat') {
        lines.push(indent(1) + S('comment', '// value fields (flat layout)'))
      } else {
        lines.push(indent(1) + S('field-name', 'value') + ': ' + S('struct-brace', '{') + ' ' + S('field-req', 'optional'))
      }
      renderSchemaFields(lines, valSchema, baseIndent, S, indent)
      if (cfg.valLayout !== 'flat') lines.push(indent(1) + S('struct-brace', '}'))
    } else {
      var valType = cfg.valMode === 'string' ? 'string' : 'binary'
      lines.push(indent(1) + S('field-name', 'value') + ': ' + S('field-type', valType) + ' ' + S('field-req', 'optional'))
    }
    lines.push(S('struct-brace', '}'))
    return lines.join('\n')
  }

  function renderRecord (cfg) {
    var lines = []
    var S = function (cls, text) { return '<span class="' + cls + '">' + esc(text) + '</span>' }
    var indent = function (n) { var o = ''; for (var i = 0; i < n; i++) o += '  '; return o }
    var useKeySchema = isSchemaMode(cfg.keyMode)
    var useValSchema = isSchemaMode(cfg.valMode)
    var tsUs = RECORD.timestamp * 1000

    lines.push(S('struct-brace', '{'))
    lines.push(indent(1) + S('field-name', 'redpanda') + ': ' + S('struct-brace', '{'))
    lines.push(indent(2) + S('field-name', 'partition') + ': ' + S('field-val-num', '3'))
    lines.push(indent(2) + S('field-name', 'offset') + ': ' + S('field-val-num', '42'))
    lines.push(indent(2) + S('field-name', 'timestamp') + ': ' + S('field-val-num', String(tsUs)))
    lines.push(indent(2) + S('field-name', 'headers') + ': [')
    for (var i = 0; i < RECORD.headers.length; i++) {
      var h = RECORD.headers[i]
      var valCls = cfg.hdrType === 'string' ? 'field-val-str' : 'field-val-bin'
      var valPrefix = cfg.hdrType === 'string' ? '' : 'b'
      lines.push(indent(3) + S('struct-brace', '{') + ' ' + S('field-name', 'key') + ': ' + S('field-val-str', '"' + h.key + '"') +
        ', ' + S('field-name', 'value') + ': ' + S(valCls, valPrefix + '"' + h.value + '"') + ' ' + S('struct-brace', '}'))
    }
    lines.push(indent(2) + ']')
    if (useKeySchema) {
      lines.push(indent(2) + S('field-name', 'key') + ': ' + S('struct-brace', '{'))
      lines.push(indent(3) + S('field-name', 'user_id') + ': ' + S('field-val-num', '12345'))
      lines.push(indent(3) + S('field-name', 'region') + ': ' + S('field-val-str', '"us-west-2"'))
      lines.push(indent(2) + S('struct-brace', '}'))
    } else if (cfg.keyMode === 'string') {
      lines.push(indent(2) + S('field-name', 'key') + ': ' + S('field-val-str', '"\\x00\\x00...us-west-2"'))
    } else {
      lines.push(indent(2) + S('field-name', 'key') + ': ' + S('field-val-bin', 'b"\\x00\\x00\\x00\\x00\\x01\\xf2\\xc0\\x01\\x12us-west-2"'))
    }
    lines.push(indent(2) + S('field-name', 'timestamp_type') + ': ' + S('field-val-num', '0'))
    lines.push(indent(1) + S('struct-brace', '}'))
    if (useValSchema) {
      var baseIndent = cfg.valLayout === 'flat' ? 1 : 2
      if (cfg.valLayout !== 'flat') lines.push(indent(1) + S('field-name', 'value') + ': ' + S('struct-brace', '{'))
      renderRecordFields(lines, VAL_SCHEMA, RECORD.value, baseIndent, S, indent)
      if (cfg.valLayout !== 'flat') lines.push(indent(1) + S('struct-brace', '}'))
    } else if (cfg.valMode === 'string') {
      lines.push(indent(1) + S('field-name', 'value') + ': ' + S('field-val-str', '"\\x00\\x00...ORD-98765..."'))
    } else {
      lines.push(indent(1) + S('field-name', 'value') + ': ' + S('field-val-bin', 'b"\\x00\\x00\\x00\\x00\\x02\\x12ORD-98765..."'))
    }
    lines.push(S('struct-brace', '}'))
    return lines.join('\n')
  }

  // ── Engine seam. Returns the config string, table schema, and translated
  //    record for a given config. `valFields`, when provided, are the Iceberg
  //    value fields computed by the real C++ WASM engine; otherwise the interim
  //    JS rules (VAL_SCHEMA) are used.
  function translate (cfg, valFields) {
    return {
      config: buildConfigString(cfg),
      schema: renderSchema(cfg, valFields),
      record: renderRecord(cfg),
    }
  }

  // ── UI markup injected into each mount point. `nid` is a per-instance id so
  //    radio `name` attributes are unique — browsers group radios by name
  //    document-wide, so two explorers on one page would otherwise fight over
  //    the checked state of same-named groups.
  // Every control is labelled with its section ("Key mode", "Value subject"):
  // key, value and headers all offer the same choices, so a bare "binary" or
  // "subject" would not say which section it sets. The section word is in a
  // visually hidden span because the card heading already shows it.
  function template (nid) {
    var r = function (group, value, checked) { return radio(nid, group, value, checked) }
    var t = function (id, section, option, ph) { return textRow(nid, id, section, option, ph) }
    return '' +
    '<div class="ice-grid">' +
      '<div class="ice-left">' +
        '<div class="ice-card"><h3>Key configuration</h3>' +
          radioField(nid, 'key-mode', 'Key', 'Mode',
            r('key-mode', 'binary', true) + r('key-mode', 'string') + r('key-mode', 'schema_id_prefix') + r('key-mode', 'schema_latest')) +
          '<div class="ice-opts">' +
            t('key-subject', 'Key', 'subject', '(default: &lt;topic&gt;-key)') +
            t('key-proto', 'Key', 'protobuf_name', '(default: first message)') +
            hint(nid, 'key-opts', 'subject') +
          '</div>' +
        '</div>' +
        '<div class="ice-card"><h3>Value configuration</h3>' +
          radioField(nid, 'val-mode', 'Value', 'Mode',
            r('val-mode', 'binary', true) + r('val-mode', 'string') + r('val-mode', 'schema_id_prefix') + r('val-mode', 'schema_latest')) +
          radioField(nid, 'val-layout', 'Value', 'Layout',
            r('val-layout', 'flat', true) + r('val-layout', 'nested'), 'layout') +
          '<div class="ice-opts">' +
            t('val-subject', 'Value', 'subject', '(default: &lt;topic&gt;-value)') +
            t('val-proto', 'Value', 'protobuf_name', '(default: first message)') +
            hint(nid, 'val-opts', 'subject') +
          '</div>' +
        '</div>' +
        '<div class="ice-card"><h3>Headers configuration</h3>' +
          radioField(nid, 'hdr-type', 'Headers', 'Value type',
            r('hdr-type', 'binary', true) + r('hdr-type', 'string')) +
        '</div>' +
      '</div>' +
      '<div class="ice-right">' +
        '<div class="ice-configbar">' +
          '<div class="ice-confighead"><span class="ice-configlabel" id="' + nid + '-cfglabel">Value for <code class="ice-prop">redpanda.iceberg.mode</code></span>' +
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
        '</div>' +
        '<div class="ice-card"><h3>Iceberg table schema <span class="ice-tag" data-out="engine"></span></h3>' +
          '<p class="ice-help">Illustrative: a fixed Avro key and value schema with one sample record. ' +
            'subject and protobuf_name pick a schema in Schema Registry, so they do not change this sample.</p>' +
          '<pre class="ice-tree" data-out="schema"></pre></div>' +
        '<div class="ice-card"><h3>Translated record</h3><pre class="ice-tree" data-out="record"></pre></div>' +
      '</div>' +
    '</div>'
  }
  // A radio group is a fieldset whose legend names its section. `option`, when
  // set, is the ENABLED_WITH key that can disable the whole group.
  function radioField (nid, group, section, label, radiosHtml, option) {
    return '<fieldset class="ice-field" data-fieldset="' + group + '">' +
      '<legend class="ice-label"><span class="ice-sr">' + section + ' </span>' + label + '</legend>' +
      '<div class="ice-radios">' + radiosHtml + '</div>' +
      '<p class="ice-help" id="' + nid + '-' + group + '-help" data-help="' + group + '"></p>' +
      (option ? hint(nid, group, option) : '') +
      '</fieldset>'
  }
  // Shown, and linked with aria-describedby, while its controls are disabled.
  function hint (nid, id, option) {
    return '<p class="ice-hint" id="' + nid + '-' + id + '-hint" data-hint="' + id + '" hidden>' + esc(enabledHint(option)) + '</p>'
  }
  // A radio's `name` is namespaced by the instance id (nid); its logical group
  // is kept in `data-group` so per-instance queries can find it without knowing
  // the prefix.
  function radio (nid, group, value, checked) {
    return '<label class="ice-radio"><input type="radio" name="' + nid + '__' + group + '" data-group="' + group + '" value="' + value + '"' + (checked ? ' checked' : '') + '>' +
      '<span>' + value + '</span></label>'
  }
  var instanceCounter = 0
  function textRow (nid, id, section, option, ph) {
    var inputId = nid + '-' + id
    return '<div class="ice-textrow" data-row="' + id + '">' +
      '<label for="' + inputId + '"><span class="ice-sr">' + section + ' </span>' + option + '</label>' +
      '<input type="text" id="' + inputId + '" data-field="' + id + '" placeholder="' + ph + '" disabled>' +
      '<p class="ice-error" id="' + inputId + '-error" data-error="' + id + '" hidden></p></div>'
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

  function hydrate (root) {
    var nid = 'ice' + (++instanceCounter)
    var engineValFields = null // real-engine value fields, set when WASM loads
    // The config string update() last rendered. Copy uses this, never the DOM
    // text, so markup in the code element (<wbr>, tags) cannot reach the clipboard.
    var currentConfig = ''
    root.innerHTML = template(nid)
    var q = function (sel) { return root.querySelector(sel) }
    // Query radios within this mount by their logical group (data-group),
    // never by the global name attribute.
    var radios = function (group) { return root.querySelectorAll('input[data-group="' + group + '"]') }
    var val = function (group) { var el = root.querySelector('input[data-group="' + group + '"]:checked'); return el ? el.value : '' }
    // `value` can come from the author's data-config, so it is compared, never
    // put into a selector: a quote or backslash there throws a SyntaxError.
    var setRadioValue = function (group, value) {
      var el = Array.prototype.find.call(radios(group), function (r) { return r.value === value })
      if (el) el.checked = true
    }
    var field = function (id) { var el = root.querySelector('[data-field="' + id + '"]'); return el ? el.value.trim() : '' }

    function getConfig () {
      return {
        keyMode: val('key-mode'),
        valMode: val('val-mode'),
        valLayout: val('val-layout'),
        hdrType: val('hdr-type'),
        keySubject: field('key-subject'),
        keyProto: field('key-proto'),
        valSubject: field('val-subject'),
        valProto: field('val-proto'),
      }
    }

    // Apply an author-supplied initial config string (data-config) by mapping
    // it back onto the controls. Unknown tokens are ignored.
    function applyInitialConfig (str) {
      var parsed = parseConfigString(str)
      if (parsed.keyMode) setRadioValue('key-mode', parsed.keyMode)
      if (parsed.valMode) setRadioValue('val-mode', parsed.valMode)
      if (parsed.valLayout) setRadioValue('val-layout', parsed.valLayout)
      if (parsed.hdrType) setRadioValue('hdr-type', parsed.hdrType)
      var fields = { keySubject: 'key-subject', keyProto: 'key-proto', valSubject: 'val-subject', valProto: 'val-proto' }
      Object.keys(fields).forEach(function (k) {
        var el = root.querySelector('[data-field="' + fields[k] + '"]')
        if (el && parsed[k]) el.value = parsed[k]
      })
    }

    // Enable or disable controls and toggle the hint that says why. The hint is
    // only described while it is visible.
    function setEnabled (els, on, hintId) {
      var h = q('[data-hint="' + hintId + '"]')
      if (h) h.hidden = on
      els.forEach(function (el) {
        if (!el) return
        el.disabled = !on
      })
    }
    // aria-describedby lists only the ids of visible descriptions.
    function describe (el, ids) {
      if (!el) return
      var live = ids.filter(function (id) { var d = document.getElementById(id); return d && !d.hidden && d.textContent })
      if (live.length) el.setAttribute('aria-describedby', live.join(' '))
      else el.removeAttribute('aria-describedby')
    }

    function update () {
      var cfg = getConfig()
      // Disable options their section's mode does not allow (ENABLED_WITH)
      // and show why. Values are kept, so switching back restores them;
      // buildConfigString leaves disabled options out of the string.
      ;['key', 'val'].forEach(function (p) {
        var mode = p === 'key' ? cfg.keyMode : cfg.valMode
        var on = optionEnabled('subject', mode)
        setEnabled([root.querySelector('[data-field="' + p + '-subject"]'), root.querySelector('[data-field="' + p + '-proto"]')],
          on, p + '-opts')
      })
      var layoutOn = optionEnabled('layout', cfg.valMode)
      setEnabled(Array.prototype.slice.call(radios('val-layout')), layoutOn, 'val-layout')

      // Help line for the checked choice in each group.
      Object.keys(CHOICE_HELP).forEach(function (group) {
        var help = q('[data-help="' + group + '"]')
        // A disabled group gets its hint instead of help for a choice that
        // does not apply.
        var off = group === 'val-layout' && !layoutOn
        if (help) help.textContent = off ? '' : (CHOICE_HELP[group][val(group)] || '')
        describe(q('[data-fieldset="' + group + '"]'), [nid + '-' + group + '-help', nid + '-' + group + '-hint'])
      })

      // Use the real WASM engine's value fields when loaded and the value is
      // decoded via a schema; otherwise fall back to the interim JS rules.
      var useEngine = engineValFields && isSchemaMode(cfg.valMode)
      var out = translate(cfg, useEngine ? engineValFields : null)

      // Check subject and protobuf_name where they are emitted. An invalid
      // value marks the field and the string, and nothing is offered for copy.
      var invalid = false
      ;[['key-subject', 'subject', cfg.keyMode], ['key-proto', 'protobuf_name', cfg.keyMode],
        ['val-subject', 'subject', cfg.valMode], ['val-proto', 'protobuf_name', cfg.valMode]].forEach(function (f) {
        var input = q('[data-field="' + f[0] + '"]')
        var errEl = q('[data-error="' + f[0] + '"]')
        var on = optionEnabled(f[1], f[2])
        var problem = on ? optionValueProblem(field(f[0]), !out.config.legacy) : null
        if (problem && problem.error) invalid = true
        if (errEl) {
          errEl.textContent = problem ? (problem.error || problem.note) : ''
          errEl.hidden = !problem
          errEl.className = problem && problem.note ? 'ice-note' : 'ice-error'
        }
        if (input) {
          if (problem && problem.error) input.setAttribute('aria-invalid', 'true')
          else input.removeAttribute('aria-invalid')
          describe(input, [nid + '-' + f[0] + '-error', nid + '-' + f[0].slice(0, 3) + '-opts-hint'])
        }
      })

      currentConfig = invalid ? '' : out.config.str
      var cfgEl = q('[data-out="config"]')
      // Line breaks go after the separators, so a long string wraps between
      // sections and options instead of inside a key.
      cfgEl.innerHTML = esc(out.config.str).replace(/([;,])/g, '$1<wbr>')
      cfgEl.classList.toggle('ice-invalid', invalid)
      var errBox = q('[data-out="config-error"]')
      errBox.hidden = !invalid
      errBox.textContent = invalid ? 'Not a valid setting. Fix the highlighted field to copy it.' : ''
      root.querySelectorAll('[data-copy]').forEach(function (b) { b.disabled = invalid })
      var info = formatInfo(out.config)
      var fmtEl = q('[data-out="format"]')
      fmtEl.className = 'ice-tag ' + (invalid ? 'ice-bad' : 'ice-info')
      fmtEl.textContent = invalid ? 'Not valid' : info.tag
      q('[data-out="format-help"]').textContent = invalid ? '' : info.help
      q('[data-out="schema"]').innerHTML = out.schema
      q('[data-out="record"]').innerHTML = out.record

      // Engine provenance badge on the schema card.
      var engEl = q('[data-out="engine"]')
      if (engEl) {
        if (useEngine) {
          engEl.className = 'ice-tag ice-engine-real'
          engEl.textContent = 'real engine · wasm'
        } else if (engineValFields && !isSchemaMode(cfg.valMode)) {
          engEl.className = 'ice-tag ice-engine-real'
          engEl.textContent = 'real engine · wasm ready'
        } else {
          // No engine build is published yet; the illustrative note under
          // the heading says what the panels show.
          engEl.className = 'ice-tag'
          engEl.textContent = ''
        }
      }
    }

    root.querySelectorAll('input[type="radio"]').forEach(function (r) { r.addEventListener('change', update) })
    root.querySelectorAll('input[type="text"]').forEach(function (i) { i.addEventListener('input', update) })

    // Load the real WASM engine (shared singleton) for this doc version;
    // re-render when its value fields are available so the schema panel
    // reflects production behavior. Falls back to the interim JS engine.
    var docVersion = root.getAttribute('data-version') ||
      (document.querySelector('.nav-container') && document.querySelector('.nav-container').getAttribute('data-version')) ||
      (document.body && document.body.getAttribute('data-version')) || ''
    loadEngineValueFields(docVersion, root.getAttribute('data-engine-base')).then(function (fields) {
      if (fields) { engineValFields = fields; update() }
    })

    var copyStatus = q('[data-out="copy-status"]')
    var copyTimer = null
    root.querySelectorAll('[data-copy]').forEach(function (btn) {
      var label = btn.textContent
      var what = btn.getAttribute('data-copy') === 'rpk' ? 'rpk command' : 'config string'
      btn.addEventListener('click', function () {
        if (!currentConfig) return
        var text = btn.getAttribute('data-copy') === 'rpk' ? rpkCommand(currentConfig) : currentConfig
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
  var SUPPORTED_PROPERTY = 'redpanda.iceberg.mode'
  function mountProblem (root) {
    var contract = root.getAttribute('data-iceberg-explorer')
    if (contract === '1') return null
    if (contract === '2') {
      var prop = root.getAttribute('data-property')
      if (prop === null || prop === SUPPORTED_PROPERTY) return null
      return 'unsupported data-property "' + prop + '" (this build supports ' + SUPPORTED_PROPERTY + ')'
    }
    return 'unsupported contract version "' + contract + '" (this build supports 1 and 2)'
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
      // One broken mount must not stop the rest of the page (site.js is one
      // concatenated bundle, so a throw here would also skip later modules).
      var fallback = root.innerHTML
      try {
        hydrate(root)
      } catch (e) {
        root.innerHTML = fallback
        root.setAttribute('data-hydrated', 'failed')
        warn('could not render a mount, kept the fallback: ' + (e && e.message))
      }
    }
  }

  // DOM bootstrap only in a browser. Guarded so the module can be required in
  // Node for the config-string conformance test (see tests/iceberg-dsl).
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      // init takes a document; the event listener would pass it the Event.
      document.addEventListener('DOMContentLoaded', function () { init() })
    } else {
      init()
    }
  }

  // Export the pure DSL logic for conformance testing under Node. No effect in
  // the browser (module is undefined there).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      buildConfigString: buildConfigString,
      parseConfigString: parseConfigString,
      isSchemaMode: isSchemaMode,
      init: init,
      copyText: copyText,
      rpkCommand: rpkCommand,
      optionValueProblem: optionValueProblem,
      formatInfo: formatInfo,
      CHOICE_HELP: CHOICE_HELP,
      optionEnabled: optionEnabled,
      enabledHint: enabledHint,
      template: template,
      mountProblem: mountProblem,
      MOUNT_SELECTOR: MOUNT_SELECTOR,
      isSafeEngineBase: isSafeEngineBase,
    }
  }
})()
