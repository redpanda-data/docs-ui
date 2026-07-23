;(function () {
  'use strict'

  // Iceberg Mode Explorer — docs-ui hydration module.
  //
  // The `[iceberg-explorer]` block (docs-extensions-and-macros) emits an empty
  // `<div class="iceberg-explorer" data-...>` mount point. This module finds
  // every such mount point and renders the interactive tool into it.
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
    { name: 'shipping_address', type: 'struct', fields: [
      { name: 'street', type: 'string' },
      { name: 'city', type: 'string' },
      { name: 'zip', type: 'string' },
      { name: 'tags', type: 'list<string>' },
    ] },
  ]
  var RECORD = {
    partition: 3, offset: 42, timestamp: 1720000000000,
    value: {
      order_id: 'ORD-98765', product: 'Redpanda Plushie', quantity: 3,
      price: 29.99, shipped: false,
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
    type: 'record', name: 'order', fields: [
      { name: 'order_id', type: 'string' },
      { name: 'product', type: 'string' },
      { name: 'quantity', type: 'int' },
      { name: 'price', type: 'double' },
      { name: 'shipped', type: 'boolean' },
      { name: 'shipping_address', type: { type: 'record', name: 'shipping_address', fields: [
        { name: 'street', type: 'string' },
        { name: 'city', type: 'string' },
        { name: 'zip', type: 'string' },
        { name: 'tags', type: { type: 'array', items: 'string' } }
      ] } }
    ]
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
  function engineCandidates (version, overrideBase) {
    var root = uiRoot()
    var list = []
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
        if (typeof createIcebergEngine !== 'function') { resolve(null); return }
        createIcebergEngine({ locateFile: function (p) { return cand.dir.replace(/\/$/, '') + '/' + p } })
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

  // ── Config-string builder — mirrors model/model.cc format_to():
  //    legacy strings when legacy-compatible, else the section-based DSL,
  //    always serializing all sections (matches PR #31035 behavior).
  function buildConfigString (cfg) {
    var keyDefault = cfg.keyMode === 'binary'
    var hdrDefault = cfg.hdrType === 'binary'
    var valLayoutDefault = cfg.valLayout === 'flat'
    var valNotString = cfg.valMode !== 'string'
    var legacyCompat = keyDefault && hdrDefault && valLayoutDefault && valNotString

    if (legacyCompat) {
      if (cfg.valMode === 'binary') return { str: 'key_value', legacy: true }
      if (cfg.valMode === 'schema_id_prefix') return { str: 'value_schema_id_prefix', legacy: true }
      if (cfg.valMode === 'schema_latest') {
        // Legacy option order (model.cc format_to): protobuf_name then subject.
        var s = 'value_schema_latest'
        var opts = []
        if (cfg.valProto) opts.push('protobuf_name=' + cfg.valProto)
        if (cfg.valSubject) opts.push('subject=' + cfg.valSubject)
        if (opts.length) s += ':' + opts.join(',')
        return { str: s, legacy: true }
      }
    }

    // Section format (model.cc): always emit all sections and all options so
    // defaults are frozen at set-time. Key: mode, subject?, protobuf_name?.
    // Value: mode, subject?, protobuf_name?, layout (always, last).
    var sections = []
    var keyOpts = ['mode=' + cfg.keyMode]
    if (cfg.keySubject) keyOpts.push('subject=' + cfg.keySubject)
    if (cfg.keyProto) keyOpts.push('protobuf_name=' + cfg.keyProto)
    sections.push('key:' + keyOpts.join(','))

    var valOpts = ['mode=' + cfg.valMode]
    if (cfg.valSubject) valOpts.push('subject=' + cfg.valSubject)
    if (cfg.valProto) valOpts.push('protobuf_name=' + cfg.valProto)
    valOpts.push('layout=' + cfg.valLayout)
    sections.push('value:' + valOpts.join(','))

    sections.push('headers:value_type=' + cfg.hdrType)
    return { str: sections.join(';'), legacy: false }
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
  function template (nid) {
    var r = function (group, value, checked) { return radio(nid, group, value, checked) }
    return '' +
    '<div class="ice-grid">' +
      '<div class="ice-left">' +
        '<div class="ice-card"><h3>Key configuration</h3>' +
          '<div class="ice-label">Mode</div>' +
          '<div class="ice-radios" data-group="key-mode">' +
            r('key-mode', 'binary', true) + r('key-mode', 'string') + r('key-mode', 'schema_id_prefix') + r('key-mode', 'schema_latest') +
          '</div>' +
          textRow('key-subject', 'subject', '(default: &lt;topic&gt;-key)') +
          textRow('key-proto', 'protobuf_name', '(default: first message)') +
        '</div>' +
        '<div class="ice-card"><h3>Value configuration</h3>' +
          '<div class="ice-label">Mode</div>' +
          '<div class="ice-radios" data-group="val-mode">' +
            r('val-mode', 'binary', true) + r('val-mode', 'string') + r('val-mode', 'schema_id_prefix') + r('val-mode', 'schema_latest') +
          '</div>' +
          '<div class="ice-label" style="margin-top:.75rem">Layout</div>' +
          '<div class="ice-radios" data-group="val-layout">' +
            r('val-layout', 'flat', true) + r('val-layout', 'nested') +
          '</div>' +
          textRow('val-subject', 'subject', '(default: &lt;topic&gt;-value)') +
          textRow('val-proto', 'protobuf_name', '(default: first message)') +
        '</div>' +
        '<div class="ice-card"><h3>Headers configuration</h3>' +
          '<div class="ice-label">Value type</div>' +
          '<div class="ice-radios" data-group="hdr-type">' +
            r('hdr-type', 'binary', true) + r('hdr-type', 'string') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="ice-right">' +
        '<div class="ice-configbar"><span class="ice-configlabel">Config string</span>' +
          '<code class="ice-configstr" data-out="config"></code>' +
          '<button type="button" class="ice-copy" data-copy>Copy</button>' +
        '</div>' +
        '<div class="ice-card"><h3>Iceberg table schema <span class="ice-tag" data-out="engine"></span></h3><pre class="ice-tree" data-out="schema"></pre></div>' +
        '<div class="ice-card"><h3>Translated record</h3><pre class="ice-tree" data-out="record"></pre></div>' +
      '</div>' +
    '</div>'
  }
  // A radio's `name` is namespaced by the instance id (nid); its logical group
  // is kept in `data-group` so per-instance queries can find it without knowing
  // the prefix.
  function radio (nid, group, value, checked) {
    return '<label class="ice-radio"><input type="radio" name="' + nid + '__' + group + '" data-group="' + group + '" value="' + value + '"' + (checked ? ' checked' : '') + '>' +
      '<span>' + value + '</span></label>'
  }
  var instanceCounter = 0
  function textRow (id, label, ph) {
    return '<div class="ice-textrow" data-row="' + id + '"><label>' + label + '</label>' +
      '<input type="text" data-field="' + id + '" placeholder="' + ph + '" disabled></div>'
  }

  function hydrate (root) {
    var nid = 'ice' + (++instanceCounter)
    var engineValFields = null // real-engine value fields, set when WASM loads
    root.innerHTML = template(nid)
    var q = function (sel) { return root.querySelector(sel) }
    // Query radios within this mount by their logical group (data-group),
    // never by the global name attribute.
    var radios = function (group) { return root.querySelectorAll('input[data-group="' + group + '"]') }
    var val = function (group) { var el = root.querySelector('input[data-group="' + group + '"]:checked'); return el ? el.value : '' }
    var setRadioValue = function (group, value) {
      var el = root.querySelector('input[data-group="' + group + '"][value="' + value + '"]')
      if (el) el.checked = true
    }
    var field = function (id) { var el = root.querySelector('[data-field="' + id + '"]'); return el ? el.value.trim() : '' }

    function getConfig () {
      return {
        keyMode: val('key-mode'), valMode: val('val-mode'), valLayout: val('val-layout'), hdrType: val('hdr-type'),
        keySubject: field('key-subject'), keyProto: field('key-proto'),
        valSubject: field('val-subject'), valProto: field('val-proto'),
      }
    }

    // Apply an author-supplied initial config string (data-config) by mapping
    // its sections back onto the controls. Best-effort; unknown tokens ignored.
    function applyInitialConfig (str) {
      if (!str) return
      if (str.indexOf(':') === -1) {
        // legacy string
        if (str === 'key_value') { setRadioValue('val-mode', 'binary') }
        else if (str === 'value_schema_id_prefix') { setRadioValue('val-mode', 'schema_id_prefix') }
        else if (str.indexOf('value_schema_latest') === 0) { setRadioValue('val-mode', 'schema_latest') }
        return
      }
      // Map DSL section names to control-group prefixes. The value section is
      // named "value" in the DSL but its controls use the "val" prefix.
      var prefixFor = { key: 'key', value: 'val' }
      str.split(';').forEach(function (section) {
        var parts = section.split(':')
        var name = parts[0]
        var prefix = prefixFor[name]
        var opts = (parts[1] || '').split(',')
        opts.forEach(function (opt) {
          var kv = opt.split('=')
          if (kv[0] === 'mode' && prefix) setRadioValue(prefix + '-mode', kv[1])
          if (kv[0] === 'layout') setRadioValue('val-layout', kv[1])
          if (name === 'headers' && kv[0] === 'value_type') setRadioValue('hdr-type', kv[1])
        })
      })
    }

    function update () {
      var cfg = getConfig()
      // Enable subject/protobuf inputs only for schema_latest.
      ;['key', 'val'].forEach(function (p) {
        var mode = p === 'key' ? cfg.keyMode : cfg.valMode
        var on = mode === 'schema_latest'
        var sub = root.querySelector('[data-field="' + p + '-subject"]')
        var pr = root.querySelector('[data-field="' + p + '-proto"]')
        if (sub) sub.disabled = !on
        if (pr) pr.disabled = !on
      })
      // Layout only applies to schema modes.
      var valIsSchema = isSchemaMode(cfg.valMode)
      radios('val-layout').forEach(function (r) {
        r.disabled = !valIsSchema
        r.closest('.ice-radio').style.opacity = valIsSchema ? '1' : '0.4'
      })
      if (!valIsSchema) setRadioValue('val-layout', 'flat')

      // Use the real WASM engine's value fields when loaded and the value is
      // decoded via a schema; otherwise fall back to the interim JS rules.
      var useEngine = engineValFields && isSchemaMode(cfg.valMode)
      var out = translate(cfg, useEngine ? engineValFields : null)
      var cfgEl = q('[data-out="config"]')
      cfgEl.innerHTML = esc(out.config.str) +
        (out.config.legacy ? ' <span class="ice-tag ice-legacy">legacy format</span>' : ' <span class="ice-tag ice-new">new format</span>')
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
          engEl.className = 'ice-tag ice-engine-preview'
          engEl.textContent = 'preview engine'
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

    var copyBtn = q('[data-copy]')
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var text = q('[data-out="config"]').textContent.replace(/\s*(legacy|new) format$/, '')
        var done = function () { copyBtn.textContent = 'Copied!'; copyBtn.classList.add('ice-copied'); setTimeout(function () { copyBtn.textContent = 'Copy'; copyBtn.classList.remove('ice-copied') }, 1500) }
        if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, function () {}) } else { done() }
      })
    }

    // Author-supplied defaults: data-config (string) or data-defaults (JSON).
    var initial = root.getAttribute('data-config')
    if (!initial && root.getAttribute('data-defaults')) {
      try { initial = (JSON.parse(root.getAttribute('data-defaults')) || {}).config } catch (e) {}
    }
    applyInitialConfig(initial)
    update()
  }

  function init () {
    var mounts = document.querySelectorAll('.iceberg-explorer')
    for (var i = 0; i < mounts.length; i++) {
      if (!mounts[i].getAttribute('data-hydrated')) {
        mounts[i].setAttribute('data-hydrated', 'true')
        hydrate(mounts[i])
      }
    }
  }

  // DOM bootstrap only in a browser. Guarded so the module can be required in
  // Node for the config-string conformance test (see tests/iceberg-dsl).
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init)
    } else {
      init()
    }
  }

  // Export the pure DSL logic for conformance testing under Node. No effect in
  // the browser (module is undefined there).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildConfigString: buildConfigString, isSchemaMode: isSchemaMode }
  }
})()
