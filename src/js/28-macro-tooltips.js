/* global uiRootPath fetch */
/**
 * Inline macro tooltips
 *
 * Hover documentation for the inline references three AsciiDoc macros emit
 * (docs-extensions-and-macros, macros/blobl.js, connect.js and rpkcmd.js):
 *
 *   blobl:[now()]          <code class="bloblang-call" data-bloblang-function="now">
 *   blobl:[.uppercase()]   <code class="bloblang-call" data-bloblang-method="uppercase">
 *   connect:[inputs/kafka_franz.consumer_group]
 *                          <code class="connect-component" data-connect-component="inputs/kafka_franz"
 *                                data-connect-field="consumer_group">
 *   rpkcmd:[rpk topic create -p]
 *                          <code class="rpk-command" data-rpk-command="rpk topic create" data-rpk-flag="partitions">
 *
 * Each is inside the xref link the macro made. Marking is opt-in, as for
 * property tooltips: plain backticks are never matched. The content comes
 * only from the published data (the Connect JSON behind connect-json-url,
 * and the rpk JSON behind rpk-json-url): when the data or the entry is
 * missing there is no tooltip, never a made-up one.
 *
 * Bloblang data loading and rendering are 16-bloblang-interactive.js's,
 * shared through window.redpandaConnectDocs, so an inline call and the same
 * call in a code block show the same tooltip.
 *
 * Disable per page, one family at a time:
 *   :page-disable-bloblang-tooltips: true
 *   :page-disable-connect-tooltips: true
 *   :page-disable-rpk-tooltips: true
 */

;(function () {
  'use strict'

  var FAMILIES = {
    bloblang: { selector: 'code.bloblang-call[data-bloblang-function], code.bloblang-call[data-bloblang-method]' },
    connect: { selector: 'code.connect-component[data-connect-component]' },
    rpk: { selector: 'code.rpk-command[data-rpk-command]' },
  }

  function isDisabled (family) {
    var meta = document.querySelector('meta[name="disable-' + family + '-tooltips"]')
    return !!(meta && meta.content === 'true')
  }

  function isPreviewMode () {
    return (
      window.location.hostname.includes('docs-ui.netlify.app') ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    )
  }

  function escapeHtml (text) {
    if (text === null || text === undefined) return ''
    var div = document.createElement('div')
    div.textContent = String(text)
    return div.innerHTML
  }

  function escapeAttr (text) {
    return escapeHtml(text).replace(/"/g, '&quot;')
  }

  // --- Data -----------------------------------------------------------------

  var rpkDataPromise = null

  /**
   * The rpk JSON head-meta resolved (rpk-<tag>.json, published by the docs
   * rpk workflows), or the preview's trimmed fixture. Null when there is
   * none: no tooltips.
   */
  function loadRpkData () {
    if (rpkDataPromise) return rpkDataPromise
    var url
    if (isPreviewMode()) {
      url = (typeof uiRootPath !== 'undefined' ? uiRootPath : '/_') + '/rpk.json'
    } else {
      var meta = document.querySelector('meta[name="rpk-json-url"]')
      url = meta && meta.content
    }
    if (!url) {
      rpkDataPromise = Promise.resolve(null)
      return rpkDataPromise
    }
    rpkDataPromise = fetch(url)
      .then(function (response) { return response.ok ? response.json() : null })
      .then(function (data) { return data && data.tree && Array.isArray(data.tree.commands) ? data : null })
      .catch(function () { return null })
    return rpkDataPromise
  }

  function connectDocs () {
    return window.redpandaConnectDocs || null
  }

  // --- Lookups (pure) -------------------------------------------------------

  // The macros write types as the rp-connect-docs paths do (inputs,
  // rate_limits); the data keys are inputs, rate-limits. Both normalize to
  // the singular with underscores.
  function normalizeType (type) {
    var t = String(type || '').trim().toLowerCase().replace(/-/g, '_')
    return t.charAt(t.length - 1) === 's' ? t.slice(0, -1) : t
  }

  /**
   * The Connect component for data-connect-component="<type>/<name>".
   */
  function findConnectComponent (data, ref) {
    if (!data || !ref) return null
    var slash = String(ref).indexOf('/')
    if (slash <= 0) return null
    var type = normalizeType(ref.slice(0, slash))
    var name = ref.slice(slash + 1)
    var keys = Object.keys(data)
    for (var i = 0; i < keys.length; i++) {
      var list = data[keys[i]]
      if (!Array.isArray(list) || normalizeType(keys[i]) !== type) continue
      for (var j = 0; j < list.length; j++) {
        if (list[j] && list[j].name === name) return list[j]
      }
    }
    return null
  }

  /**
   * A field by dot-separated path through config children. An array of
   * objects is addressed without an index (sasl.mechanism), as the macros
   * address it.
   */
  function findConnectField (component, path) {
    var children = component && component.config && component.config.children
    var field = null
    var segments = String(path || '').split('.').filter(Boolean)
    if (!segments.length) return null
    for (var i = 0; i < segments.length; i++) {
      var name = segments[i].replace(/\[\]$/, '')
      var list = children || []
      field = null
      for (var j = 0; j < list.length; j++) {
        if (list[j] && String(list[j].name).replace(/\[\]$/, '') === name) {
          field = list[j]
          break
        }
      }
      if (!field) return null
      children = field.children
    }
    return field
  }

  /**
   * The command node for data-rpk-command="rpk topic create". The macro
   * writes the canonical names, aliases resolved; aliases still match here.
   */
  function findRpkCommand (tree, command) {
    if (!tree) return null
    var names = String(command || '').trim().split(/\s+/).filter(Boolean)
    if (names[0] === 'rpk') names.shift()
    var node = tree
    for (var i = 0; i < names.length; i++) {
      var next = null
      var commands = node.commands || []
      for (var j = 0; j < commands.length; j++) {
        var c = commands[j]
        if (c && (c.name === names[i] || (Array.isArray(c.aliases) && c.aliases.indexOf(names[i]) !== -1))) {
          next = c
          break
        }
      }
      if (!next) return null
      node = next
    }
    return node
  }

  /**
   * A flag on the command, then in the global flags, as rpkcmd: resolves
   * it. data-rpk-flag holds the long name; a shorthand matches too.
   */
  function findRpkFlag (tree, node, flag) {
    var name = String(flag || '').replace(/^-+/, '')
    if (!name) return null
    var match = function (flags) {
      var list = flags || []
      for (var i = 0; i < list.length; i++) {
        var f = list[i]
        if (!f) continue
        if (name.length === 1 ? f.shorthand === name : f.name === name) return f
      }
      return null
    }
    return (node && node !== tree ? match(node.flags) : null) || match(tree && tree.global_flags)
  }

  // --- Text (pure) ----------------------------------------------------------

  /**
   * The first paragraph of a description, skipping leading blank lines.
   */
  function firstParagraph (text) {
    var paragraphs = String(text || '').trim().split(/\n\s*\n/)
    return (paragraphs[0] || '').replace(/\s*\n\s*/g, ' ').trim()
  }

  /**
   * The first sentence of a description: up to the first ., ! or ? that is
   * followed by whitespace and a capital letter or a backtick, or the end.
   * Abbreviations (e.g., i.e.) are followed by a lowercase word and stay.
   * Backticked text is never split.
   */
  function firstSentence (text) {
    var para = firstParagraph(text)
    var inCode = false
    for (var i = 0; i < para.length; i++) {
      var ch = para.charAt(i)
      if (ch === '`') inCode = !inCode
      if (inCode || '.!?'.indexOf(ch) === -1) continue
      var rest = para.slice(i + 1)
      if (/^\s+[A-Z`]/.test(rest)) return para.slice(0, i + 1)
    }
    return para
  }

  // --- Rendering ------------------------------------------------------------

  function formatDescription (text) {
    var docs = connectDocs()
    if (docs && docs.formatDescription) return docs.formatDescription(text)
    return escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>')
  }

  function formatValue (value) {
    return JSON.stringify(value)
  }

  function footerLink (href) {
    if (!href) return ''
    return '<a href="' + escapeAttr(href) + '" class="prop-tooltip-link">View full documentation &rarr;</a>'
  }

  function badge (text, kind) {
    return '<span class="prop-badge prop-badge-' + kind + '">' + escapeHtml(text) + '</span>'
  }

  // Shown only for statuses a reader must notice; stable is the norm.
  var CONNECT_STATUS_BADGES = { beta: 'status', experimental: 'status', deprecated: 'deprecated' }

  function typeWords (type) {
    return String(type || '').replace(/_/g, ' ')
  }

  function renderConnectComponent (component, href) {
    var parts = []
    parts.push(
      '<div class="prop-tooltip-signature"><code>' + escapeHtml(component.name) + '</code>' +
        (component.type ? ' <span class="macro-tooltip-kind">' + escapeHtml(typeWords(component.type)) + '</span>' : '') +
        '</div>'
    )
    var kind = CONNECT_STATUS_BADGES[component.status]
    if (kind) parts.push('<div class="prop-tooltip-badges">' + badge(component.status, kind) + '</div>')
    if (component.summary) {
      parts.push('<div class="prop-tooltip-description">' + formatDescription(firstParagraph(component.summary)) + '</div>')
    }
    parts.push(footerLink(href))
    return '<div class="property-doc-tooltip macro-doc-tooltip">' + parts.join('') + '</div>'
  }

  // string, or array of string / map of string for a non-scalar kind
  function connectFieldType (field) {
    if (!field.type) return ''
    if (field.kind && field.kind !== 'scalar') return field.kind + ' of ' + field.type
    return field.type
  }

  function renderConnectField (component, path, field, href) {
    var parts = []
    var type = connectFieldType(field)
    parts.push(
      '<div class="prop-tooltip-signature"><code>' + escapeHtml(path) + '</code>' +
        (type ? ': <code>' + escapeHtml(type) + '</code>' : '') +
        '</div>'
    )
    if (field.is_deprecated) parts.push('<div class="prop-tooltip-badges">' + badge('deprecated', 'deprecated') + '</div>')
    var sentence = firstSentence(field.description)
    if (sentence) parts.push('<div class="prop-tooltip-description">' + formatDescription(sentence) + '</div>')
    if (Object.prototype.hasOwnProperty.call(field, 'default')) {
      parts.push(
        '<div class="prop-tooltip-default"><strong>Default:</strong> <code>' + escapeHtml(formatValue(field.default)) + '</code></div>'
      )
    }
    parts.push(
      '<div class="macro-tooltip-context">Field of the <code>' + escapeHtml(component.name) + '</code> ' +
        escapeHtml(typeWords(component.type)) + '</div>'
    )
    parts.push(footerLink(href))
    return '<div class="property-doc-tooltip macro-doc-tooltip">' + parts.join('') + '</div>'
  }

  function renderRpkCommand (node, command, href) {
    var parts = []
    parts.push('<div class="prop-tooltip-signature"><code>' + escapeHtml(node.usage || command) + '</code></div>')
    var para = firstParagraph(node.description)
    if (para) parts.push('<div class="prop-tooltip-description">' + formatDescription(para) + '</div>')
    parts.push(footerLink(href))
    return '<div class="property-doc-tooltip macro-doc-tooltip">' + parts.join('') + '</div>'
  }

  // A flag default worth showing: cobra reports unset string and list flags
  // as "" and [], which say nothing to a reader.
  function hasRpkDefault (flag) {
    if (!Object.prototype.hasOwnProperty.call(flag, 'default')) return false
    var d = flag.default
    return !(d === null || d === '' || (Array.isArray(d) && d.length === 0))
  }

  function renderRpkFlag (command, flag, href) {
    var parts = []
    parts.push(
      '<div class="prop-tooltip-signature"><code>--' + escapeHtml(flag.name) + '</code>' +
        (flag.shorthand ? ', <code>-' + escapeHtml(flag.shorthand) + '</code>' : '') +
        (flag.type ? ': <code>' + escapeHtml(flag.type) + '</code>' : '') +
        '</div>'
    )
    var para = firstParagraph(flag.description)
    if (para) parts.push('<div class="prop-tooltip-description">' + formatDescription(para) + '</div>')
    if (hasRpkDefault(flag)) {
      var value = typeof flag.default === 'string' ? flag.default : formatValue(flag.default)
      parts.push('<div class="prop-tooltip-default"><strong>Default:</strong> <code>' + escapeHtml(value) + '</code></div>')
    }
    parts.push('<div class="macro-tooltip-context">Flag of <code>' + escapeHtml(command) + '</code></div>')
    parts.push(footerLink(href))
    return '<div class="property-doc-tooltip macro-doc-tooltip">' + parts.join('') + '</div>'
  }

  /**
   * Tooltip HTML for one marked element, or null when the data has no entry.
   */
  function contentFor (family, el, data, href) {
    if (family === 'bloblang') {
      var fn = el.getAttribute('data-bloblang-function')
      var kind = fn ? 'functions' : 'methods'
      var name = fn || el.getAttribute('data-bloblang-method')
      var table = data && data[kind]
      if (!table || !Object.prototype.hasOwnProperty.call(table, name)) return null
      var doc = table[name]
      var docs = connectDocs()
      // The macro links the right anchor (and category copy); the URL the
      // data transform guesses does not know either. No example: hover is
      // for the signature and what it does.
      return docs.createDocTooltip({
        signature: doc.signature,
        description: firstParagraph(doc.description),
        parameters: doc.parameters,
        url: href || undefined,
      })
    }
    if (family === 'connect') {
      var component = findConnectComponent(data, el.getAttribute('data-connect-component'))
      if (!component) return null
      var path = el.getAttribute('data-connect-field')
      if (!path) return renderConnectComponent(component, href)
      var field = findConnectField(component, path)
      return field ? renderConnectField(component, path, field, href) : null
    }
    if (family === 'rpk') {
      var tree = data && data.tree
      var command = el.getAttribute('data-rpk-command')
      var node = findRpkCommand(tree, command)
      if (!node) return null
      var flagName = el.getAttribute('data-rpk-flag')
      if (!flagName) return renderRpkCommand(node, command, href)
      var flag = findRpkFlag(tree, node, flagName)
      return flag ? renderRpkFlag(command, flag, href) : null
    }
    return null
  }

  function labelFor (family, el) {
    if (family === 'bloblang') {
      var fn = el.getAttribute('data-bloblang-function')
      return fn ? fn + ' function' : el.getAttribute('data-bloblang-method') + ' method'
    }
    if (family === 'connect') {
      var field = el.getAttribute('data-connect-field')
      return field ? field + ' field' : el.getAttribute('data-connect-component') + ' component'
    }
    var flag = el.getAttribute('data-rpk-flag')
    return el.getAttribute('data-rpk-command') + (flag ? ' --' + flag + ' flag' : ' command')
  }

  function keyFor (family, el) {
    return [
      family,
      el.getAttribute('data-bloblang-function'),
      el.getAttribute('data-bloblang-method'),
      el.getAttribute('data-connect-component'),
      el.getAttribute('data-connect-field'),
      el.getAttribute('data-rpk-command'),
      el.getAttribute('data-rpk-flag'),
    ].join('|')
  }

  // --- Decoration -----------------------------------------------------------

  /**
   * Can this device take touch input at all? Only for the aria-haspopup
   * hint; behaviour reads tippy.currentInput.isTouch (12-activate-tooltips.js).
   */
  function canTouchDevice () {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0
  }

  function tippyConfig (content) {
    return {
      content: content,
      allowHTML: true,
      interactive: true,
      theme: 'bloblang-doc',
      placement: 'top',
      maxWidth: 450,
      appendTo: document.body,
      // Same as the property and glossary tooltips: a tap opens through the
      // emulated mouseenter, hover and keyboard focus work everywhere.
      touch: true,
      trigger: 'mouseenter focus',
      // Always true, never 'toggle'. See 12-activate-tooltips.js.
      hideOnClick: true,
      delay: [200, 0],
      // The tooltip describes the link it belongs to, so a screen reader
      // announces it on focus.
      aria: { content: 'describedby', expanded: 'auto' },
      // Only one tooltip open at a time. See 12-activate-tooltips.js.
      onShow: function (instance) {
        window.tippy.hideAll({ exclude: instance })
      },
      popperOptions: {
        modifiers: [
          { name: 'preventOverflow', options: { boundary: 'viewport' } },
          { name: 'flip', options: { fallbackPlacements: ['bottom', 'top'] } },
        ],
      },
    }
  }

  /**
   * Attach a tooltip to one marked element. The macros put the code inside
   * the link they made, so the tooltip goes on the link: it is already
   * focusable, and a second tab stop (or a button inside a link) would not
   * be. Without a link the code itself becomes the focusable reference.
   */
  function decorate (family, el, content, canTouch) {
    var anchor = el.closest('a[href]')
    var target = anchor || el
    el.classList.add('has-macro-tooltip')
    if (!anchor) {
      el.setAttribute('tabindex', '0')
      el.setAttribute('role', 'button')
      el.setAttribute('aria-label', labelFor(family, el) + ' documentation')
    }
    if (canTouch) target.setAttribute('aria-haspopup', 'dialog')
    if (anchor) {
      // A tap on the link opens the tooltip instead of navigating while touch
      // is the input in use; the tooltip's footer link goes through. A mouse
      // click follows the link as always. Same rule as glossary terms.
      anchor.addEventListener('click', function (e) {
        if (window.tippy.currentInput && window.tippy.currentInput.isTouch) e.preventDefault()
      })
    }
    target.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (target._tippy) target._tippy.hide()
      } else if (!anchor && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault()
        if (target._tippy) target._tippy.show()
      }
    })
    window.tippy(target, tippyConfig(content))
  }

  function loaderFor (family) {
    var docs = connectDocs()
    if (family === 'bloblang') return docs ? docs.loadBloblangDocsFromData() : Promise.resolve(null)
    if (family === 'connect') return docs ? docs.loadConnectData() : Promise.resolve(null)
    return loadRpkData()
  }

  function processFamily (family, article, canTouch, seen) {
    if (isDisabled(family)) return Promise.resolve()
    var selector = FAMILIES[family].selector
    // Look for marked elements before fetching anything: most pages have none.
    if (!article.querySelector(selector)) return Promise.resolve()
    return loaderFor(family).then(function (data) {
      if (!data) return
      article.querySelectorAll(selector).forEach(function (el) {
        if (el.classList.contains('has-macro-tooltip')) return
        var anchor = el.closest('a[href]')
        if ((anchor || el)._tippy) return
        // First mention per paragraph, list item or cell only, as for
        // property references, so a dense paragraph is not all underlines.
        var container = el.closest('p, li, td, th, dt, dd') || el.parentElement || article
        var keys = seen.get(container)
        if (!keys) seen.set(container, (keys = new Set()))
        var key = keyFor(family, el)
        if (keys.has(key)) return
        var content = contentFor(family, el, data, anchor && anchor.getAttribute('href'))
        if (!content) return
        keys.add(key)
        decorate(family, el, content, canTouch)
      })
    })
  }

  function processAll () {
    var article = document.querySelector('article.doc')
    if (!article) return Promise.resolve()
    var canTouch = canTouchDevice()
    var seen = new WeakMap()
    return Promise.all(Object.keys(FAMILIES).map(function (family) {
      return processFamily(family, article, canTouch, seen).catch(function (e) {
        console.warn('Macro tooltips (' + family + '):', e)
      })
    }))
  }

  function init () {
    var retries = 5
    function tryInit () {
      if (window.tippy) {
        var schedule = window.requestIdleCallback
          ? function (cb) { window.requestIdleCallback(cb, { timeout: 500 }) }
          : function (cb) { setTimeout(cb, 100) }
        schedule(function () { window.redpandaMacroTooltips.ready = processAll() })
      } else if (retries-- > 0) {
        setTimeout(tryInit, 100)
      }
    }
    tryInit()
  }

  // Exposed for tests: the pure lookups and renderers, and a promise that
  // settles once the page has been decorated.
  window.redpandaMacroTooltips = {
    findConnectComponent: findConnectComponent,
    findConnectField: findConnectField,
    findRpkCommand: findRpkCommand,
    findRpkFlag: findRpkFlag,
    firstParagraph: firstParagraph,
    firstSentence: firstSentence,
    contentFor: contentFor,
    processAll: processAll,
    ready: null,
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
