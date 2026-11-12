/* global localStorage, NodeFilter */
/**
 * Solution pages: remember the platform tab, and fill in the reader's own
 * Redpanda Cloud values (Your cluster).
 *
 * Platform. Solution pages group their platform tabs with
 * [tabs,sync-group-id=platform] and the labels Docker Compose, Kubernetes,
 * and Redpanda Cloud. The Asciidoctor tabs script (js/vendor/tabs.js, loaded
 * in head-scripts.hbs with data-sync-storage-key="preferred-tab") keeps the
 * choice in localStorage 'preferred-tab-platform' and nowhere else. A click on
 * one of those tabs is also recorded in the progress store as
 * prefs.platform (28-solution-progress.js), which syncs to the account for a
 * signed-in reader. When the store holds a platform that differs from the
 * tabs script's choice (a later pick on another device, merged in when
 * signed-in progress loads), the matching tab is clicked, which selects it in
 * every platform tab group on the page and writes the tabs script's own key,
 * so other pages open on it too. The merge decides which pick is newer: the
 * one with the later `at` wins.
 *
 * Your cluster. On a Redpanda Cloud tab (.platform-cloud), and on the
 * env.cloud.example listing wherever it is, a small form takes the bootstrap
 * server URL, the Schema Registry URL, and the SASL username, and the code
 * blocks there show them in place of <bootstrap-server-url>,
 * <schema-registry-url>, and <user>. <password> is never touched, and there
 * is no password field: the store has no place for one. Values go through
 * the same checks as docs-site before they are stored, and are written into
 * the page with textContent only, so a value cannot add markup. The copy
 * button (06-copy-to-clipboard.js) copies the code's rendered text, so it
 * copies the filled values. Clear stores an empty entry with a fresh time,
 * which wins over older copies, and puts the placeholders back. Signed out,
 * the values stay in this browser; they sync once the reader signs in.
 *
 * 11-editable-placeholders.js turns most placeholders into editable spans on
 * DOMContentLoaded, before this module's own handler runs (it is earlier in
 * site.js). Those spans are reused; a placeholder it left as text (a block
 * type it skips) is wrapped here. Comment lines are prose and are left
 * alone, the same rule that module follows. Prism's keep-markup plugin keeps
 * the spans when a block is highlighted later, but replaces the nodes, so
 * nothing here holds on to an element: every pass queries the attribute.
 */
;(function () {
  'use strict'

  var api = window.docsSolutions
  var body = document.body
  if (!api || typeof api.setPref !== 'function' || !body || !body.getAttribute('data-solution-id')) return

  function toArray (list) { return Array.prototype.slice.call(list || []) }
  function $$ (selector, root) { return toArray((root || document).querySelectorAll(selector)) }

  // ---------------------------------------------------------------------------
  // Platform
  // ---------------------------------------------------------------------------

  // tabs.js: data-sync-storage-key + '-' + the tab group's sync id.
  var TAB_STORAGE_KEY = 'preferred-tab-platform'
  var LABELS = { local: 'Docker Compose', kubernetes: 'Kubernetes', cloud: 'Redpanda Cloud' }

  function platformOf (label) {
    for (var key in LABELS) {
      if (Object.prototype.hasOwnProperty.call(LABELS, key) && LABELS[key] === label) return key
    }
    return null
  }

  // tabs.js moves the data-sync-group-id=platform class to an attribute when
  // it initializes; either form names the group.
  function isPlatformTabs (tabs) {
    return !!tabs && (tabs.getAttribute('data-sync-group-id') === 'platform' ||
      tabs.classList.contains('data-sync-group-id=platform'))
  }

  function tabLabel (tab) { return String(tab.textContent || '').trim() }

  function readTabChoice () {
    try { return localStorage.getItem(TAB_STORAGE_KEY) } catch (e) { return null }
  }

  function writeTabChoice (label) {
    try { localStorage.setItem(TAB_STORAGE_KEY, label) } catch (e) { /* storage blocked */ }
  }

  var applying = false

  // tabs.js handles the click on the tab itself; this runs after it, on the
  // way up. A pick is recorded even when it repeats the stored value, so it
  // is dated now and wins over an older pick from another device.
  function onTabClick (e) {
    if (applying || !e || !e.target || typeof e.target.closest !== 'function') return
    var tab = e.target.closest('.tablist li')
    var tabs = tab && tab.closest('.tabs')
    if (!isPlatformTabs(tabs)) return
    var platform = platformOf(tabLabel(tab))
    if (platform) api.setPref('platform', platform)
  }

  function applyPlatform () {
    var pref = api.getPrefs().platform
    var label = pref && LABELS[pref.value]
    if (!label || readTabChoice() === label) return
    // Written first, so a tabs script that has not initialized yet opens on
    // it; the click selects it now when it has.
    writeTabChoice(label)
    var groups = $$('.tabs').filter(isPlatformTabs)
    for (var i = 0; i < groups.length; i++) {
      var tab = $$('.tablist li', groups[i]).filter(function (li) { return tabLabel(li) === label })[0]
      if (!tab) continue
      if (tab.getAttribute('aria-selected') !== 'true' && typeof tab.click === 'function') {
        applying = true
        try { tab.click() } finally { applying = false }
      }
      return
    }
  }

  // ---------------------------------------------------------------------------
  // Your cluster
  // ---------------------------------------------------------------------------

  var FIELDS = [
    {
      key: 'bootstrap',
      placeholder: '<bootstrap-server-url>',
      label: 'Bootstrap server URL',
      error: 'Enter host:port, or several separated by commas.',
    },
    {
      key: 'schemaRegistry',
      placeholder: '<schema-registry-url>',
      label: 'Schema Registry URL',
      error: 'Enter a URL that starts with https://.',
    },
    {
      key: 'user',
      placeholder: '<user>',
      label: 'Username',
      error: 'Use only letters, digits, and . _ @ -',
    },
  ]
  var BY_KEY = {}
  var BY_PLACEHOLDER = {}
  FIELDS.forEach(function (f) {
    BY_KEY[f.key] = f
    // 11-editable-placeholders.js names its span by the text inside the angle
    // brackets (data-type="bootstrap-server-url").
    BY_PLACEHOLDER[f.placeholder.slice(1, -1)] = f
  })
  var PLACEHOLDER_RE = /<(bootstrap-server-url|schema-registry-url|user)>/g
  var FIELD_ATTR = 'data-sol-cluster-field'
  var ENV_FILE = 'env.cloud.example'
  var HINT = 'These values fill in the commands on this page. Never enter a password here.'

  function isEnvListing (block) {
    if (!block) return false
    if (block.getAttribute('data-solution-file') === ENV_FILE) return true
    var title = block.querySelector('.title')
    return !!title && String(title.textContent || '').trim() === ENV_FILE
  }

  // Every code element that takes the values, with the element the form
  // goes in front of: the Redpanda Cloud tab body for blocks inside one,
  // otherwise the env.cloud.example listing itself.
  function targets () {
    var out = []
    $$('.listingblock pre > code').forEach(function (code) {
      var block = code.closest('.listingblock')
      var cloud = code.closest('.platform-cloud')
      if (cloud || isEnvListing(block)) out.push({ code: code, block: block, container: cloud || block })
    })
    return out
  }

  // Comment lines are prose, as in 11-editable-placeholders.js.
  var COMMENT_LINE_RE = /^\s*(?:\/\/|#|\/\*|\*(?=\s|$))/

  function inComment (node) {
    var el = node.parentNode
    return !!(el && el.closest && el.closest('.token.comment, .hljs-comment'))
  }

  // The text of the line `node` sits on, up to `offset` within it.
  function linePrefix (nodes, index, offset) {
    var text = nodes[index].nodeValue.slice(0, offset)
    for (var i = index - 1; i >= 0 && text.indexOf('\n') === -1; i--) text = nodes[i].nodeValue + text
    return text.slice(text.lastIndexOf('\n') + 1)
  }

  function fieldSpan (field) {
    var span = document.createElement('span')
    span.className = 'sol-cluster-value'
    span.setAttribute(FIELD_ATTR, field.key)
    span.textContent = field.placeholder
    return span
  }

  // Tag the placeholders in one code element: reuse the editable spans, wrap
  // the literal text ones. Safe to run again.
  function markCode (code) {
    $$('[contenteditable="true"][data-type]', code).forEach(function (span) {
      var field = BY_PLACEHOLDER[span.getAttribute('data-type')]
      if (!field || span.hasAttribute(FIELD_ATTR)) return
      span.setAttribute(FIELD_ATTR, field.key)
      span.classList.add('sol-cluster-value')
    })
    var walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT)
    var nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    nodes.forEach(function (node, index) {
      var parent = node.parentNode
      if (!parent || (parent.closest && parent.closest('[' + FIELD_ATTR + ']')) || inComment(node)) return
      var text = node.nodeValue
      var pieces = []
      var last = 0
      var match
      PLACEHOLDER_RE.lastIndex = 0
      while ((match = PLACEHOLDER_RE.exec(text))) {
        if (COMMENT_LINE_RE.test(linePrefix(nodes, index, match.index))) continue
        if (match.index > last) pieces.push(document.createTextNode(text.slice(last, match.index)))
        pieces.push(fieldSpan(BY_PLACEHOLDER[match[1]]))
        last = match.index + match[0].length
      }
      if (!pieces.length) return
      if (last < text.length) pieces.push(document.createTextNode(text.slice(last)))
      pieces.forEach(function (piece) { parent.insertBefore(piece, node) })
      parent.removeChild(node)
    })
    return !!code.querySelector('[' + FIELD_ATTR + ']')
  }

  function storedCloud () {
    var cloud = api.getPrefs().cloud
    return cloud || null
  }

  // Values in, placeholders out, or back. A span with no stored value is left
  // as it is unless this module filled it, so a value the reader typed into
  // an editable placeholder survives an unrelated store change.
  function fill () {
    var cloud = storedCloud()
    $$('[' + FIELD_ATTR + ']').forEach(function (el) {
      var field = BY_KEY[el.getAttribute(FIELD_ATTR)]
      if (!field) return
      var value = cloud && cloud[field.key]
      if (value) {
        if (el.textContent !== value) el.textContent = value
        el.classList.add('is-filled')
      } else if (el.classList.contains('is-filled')) {
        el.textContent = field.placeholder
        el.classList.remove('is-filled')
      }
    })
    syncForms(cloud)
  }

  var formCount = 0

  function buildForm () {
    var n = ++formCount
    var id = function (part) { return 'sol-cluster-' + n + '-' + part }
    var form = document.createElement('form')
    form.className = 'sol-cluster'
    form.setAttribute('data-sol-cluster', '')
    form.setAttribute('novalidate', '')
    form.setAttribute('autocomplete', 'off')
    var fieldset = document.createElement('fieldset')
    fieldset.className = 'sol-cluster-fields'
    var legend = document.createElement('legend')
    legend.className = 'sol-cluster-title'
    legend.textContent = 'Your cluster'
    fieldset.appendChild(legend)
    FIELDS.forEach(function (field) {
      var row = document.createElement('div')
      row.className = 'sol-cluster-row'
      var label = document.createElement('label')
      label.setAttribute('for', id(field.key))
      label.textContent = field.label
      var input = document.createElement('input')
      input.id = id(field.key)
      input.name = field.key
      input.type = 'text'
      input.setAttribute('autocomplete', 'off')
      input.setAttribute('autocapitalize', 'off')
      input.setAttribute('spellcheck', 'false')
      input.setAttribute('maxlength', '256')
      input.setAttribute('placeholder', field.placeholder)
      input.setAttribute('data-sol-cluster-input', field.key)
      input.setAttribute('aria-describedby', id('hint'))
      var error = document.createElement('p')
      error.className = 'sol-cluster-error'
      error.id = id(field.key + '-error')
      error.setAttribute('data-sol-cluster-error', field.key)
      error.hidden = true
      row.appendChild(label)
      row.appendChild(input)
      row.appendChild(error)
      fieldset.appendChild(row)
    })
    var actions = document.createElement('div')
    actions.className = 'sol-cluster-actions'
    var save = document.createElement('button')
    save.type = 'submit'
    save.className = 'sol-btn sol-btn--primary sol-btn--sm'
    save.textContent = 'Save'
    var clear = document.createElement('button')
    clear.type = 'button'
    clear.className = 'sol-btn sol-btn--sm'
    clear.setAttribute('data-sol-cluster-clear', '')
    clear.textContent = 'Clear'
    var status = document.createElement('span')
    status.className = 'sol-cluster-status'
    status.setAttribute('role', 'status')
    status.setAttribute('data-sol-cluster-status', '')
    actions.appendChild(save)
    actions.appendChild(clear)
    actions.appendChild(status)
    fieldset.appendChild(actions)
    var hint = document.createElement('p')
    hint.className = 'sol-cluster-hint'
    hint.id = id('hint')
    hint.textContent = HINT
    fieldset.appendChild(hint)
    form.appendChild(fieldset)
    form.addEventListener('submit', function (e) { e.preventDefault(); onSave(form) })
    clear.addEventListener('click', function () { onClear(form) })
    return form
  }

  function inputOf (form, key) { return form.querySelector('[data-sol-cluster-input="' + key + '"]') }

  function setStatus (form, text) {
    var status = form.querySelector('[data-sol-cluster-status]')
    if (status) status.textContent = text
  }

  function setError (form, field, message) {
    var input = inputOf(form, field.key)
    var error = form.querySelector('[data-sol-cluster-error="' + field.key + '"]')
    if (error) {
      error.textContent = message || ''
      error.hidden = !message
    }
    if (!input) return
    if (message) {
      input.setAttribute('aria-invalid', 'true')
      input.setAttribute('aria-describedby', error.id + ' ' + form.querySelector('.sol-cluster-hint').id)
    } else {
      input.removeAttribute('aria-invalid')
      input.setAttribute('aria-describedby', form.querySelector('.sol-cluster-hint').id)
    }
  }

  function onSave (form) {
    var values = {}
    var firstBad = null
    FIELDS.forEach(function (field) {
      var input = inputOf(form, field.key)
      var value = input ? String(input.value || '').trim() : ''
      var ok = !value || api.validCloudValue(field.key, value)
      setError(form, field, ok ? null : field.error)
      if (!ok && !firstBad) firstBad = input
      values[field.key] = value || null
    })
    if (firstBad) {
      setStatus(form, '')
      firstBad.focus()
      return
    }
    var empty = !values.bootstrap && !values.schemaRegistry && !values.user
    if (!api.setPref('cloud', values)) return
    fill()
    setStatus(form, empty ? 'Cleared.' : 'Saved.')
  }

  function onClear (form) {
    FIELDS.forEach(function (field) {
      var input = inputOf(form, field.key)
      if (input) input.value = ''
      setError(form, field, null)
    })
    if (storedCloud()) api.setPref('cloud', {})
    fill()
    setStatus(form, 'Cleared.')
  }

  // Every form shows the stored values, except an input the reader is in.
  function syncForms (cloud) {
    $$('[data-sol-cluster]').forEach(function (form) {
      FIELDS.forEach(function (field) {
        var input = inputOf(form, field.key)
        if (!input || input === document.activeElement) return
        input.value = (cloud && cloud[field.key]) || ''
      })
    })
  }

  function setUpCluster () {
    var placed = []
    targets().forEach(function (t) {
      if (!markCode(t.code) || placed.indexOf(t.container) !== -1) return
      placed.push(t.container)
      // Inside a tab body the form goes before the first block that takes a
      // value, where the reader needs it; for a bare env.cloud.example
      // listing, before the listing.
      t.block.parentNode.insertBefore(buildForm(), t.block)
    })
    if (placed.length) fill()
  }

  // ---------------------------------------------------------------------------
  // Wire up
  // ---------------------------------------------------------------------------

  document.addEventListener('click', onTabClick)
  applyPlatform()
  window.addEventListener('docs-solutions:change', function () {
    applyPlatform()
    fill()
  })
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setUpCluster)
  else setUpCluster()
})()
