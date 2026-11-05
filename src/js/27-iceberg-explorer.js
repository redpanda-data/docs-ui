;(function () {
  'use strict'

  // Loads the Iceberg Mode Explorer only on pages that have one.
  //
  // The explorer (js/vendor/iceberg-explorer.js, built from
  // src/js/iceberg-explorer.js, and css/iceberg-explorer.css) used to ship in
  // site.js and site.css on every docs page. Like the Ask AI drawer
  // (19-chat-panel.js), it is now fetched on demand: this loader looks for a
  // `[data-iceberg-explorer]` mount and, only if there is one, adds the
  // stylesheet and then the script. The stylesheet goes first so the tool
  // never renders unstyled; the script starts once it has loaded or failed.
  // Until then the mount shows the macro's fallback text.

  // Keep in step with MOUNT_SELECTOR in src/js/iceberg-explorer.js.
  var MOUNT_SELECTOR = '[data-iceberg-explorer]'
  var MARK = 'data-iceberg-explorer-asset'

  // The UI root as the layout wrote it on the site.js tag (footer-scripts.hbs).
  function uiRootPath (doc) {
    var site = doc.getElementById('site-script')
    var root = site && site.getAttribute('data-ui-root-path')
    if (root) return root.replace(/\/$/, '')
    var s = doc.querySelector('script[src*="/js/site.js"]')
    return s ? s.getAttribute('src').replace(/\/js\/site\.js.*$/, '') : '/_'
  }

  // Returns true when it started loading the explorer.
  function load (doc) {
    doc = doc || document
    if (!doc.querySelector(MOUNT_SELECTOR) || doc.querySelector('[' + MARK + ']')) return false
    var root = uiRootPath(doc)
    var started = false
    function addScript () {
      if (started) return
      started = true
      var script = doc.createElement('script')
      script.src = root + '/js/vendor/iceberg-explorer.js'
      script.setAttribute(MARK, 'js')
      script.onerror = function () {
        // The mounts keep their fallback text, which already says the tool
        // could not load.
        if (typeof console !== 'undefined' && console.warn) console.warn('iceberg-explorer: could not load ' + script.src)
      }
      doc.head.appendChild(script)
    }
    var link = doc.createElement('link')
    link.rel = 'stylesheet'
    link.href = root + '/css/iceberg-explorer.css'
    link.setAttribute(MARK, 'css')
    link.onload = addScript
    link.onerror = addScript
    doc.head.appendChild(link)
    return true
  }

  if (typeof document !== 'undefined' && typeof module === 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { load() })
    else load()
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { load: load, uiRootPath: uiRootPath, MOUNT_SELECTOR: MOUNT_SELECTOR }
})()
