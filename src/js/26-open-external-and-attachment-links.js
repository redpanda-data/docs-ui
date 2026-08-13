;(function () {
  'use strict'

  // Open external (off-site) links and on-site attachment/download links in a
  // new tab, and announce that to assistive tech, so readers don't silently
  // lose their place in the current page.
  //
  // A link counts as external when its resolved URL is http(s) and points at a
  // host other than the page's own origin or the INTERNAL_HOSTS below. URLs
  // are parsed rather than substring-matched, so a URL that merely *contains*
  // an internal host name in its path or inside a longer hostname (for
  // example https://evil.example/docs.redpanda.com) is still external.
  //
  // The external-link icon in src/css/doc.css (and src/css/doc-bump.css)
  // approximates the same policy with substring selectors — the best CSS can
  // do. Keep the host list below in sync with the hosts named there.
  // (localhost is intentionally NOT excluded: a link to a local app opens a
  // different origin, so a new tab keeps the docs page in place.)
  // Attachment links are matched by the `.attachment` class Antora adds to
  // `xref:...attachment$...` links; they get the download glyph via CSS.

  // Hosts that count as on-site (same tab, no icon) wherever the page is
  // served from. Subdomains match; substrings do not. The page's own
  // host:port is always on-site, which also covers deploy previews.
  var INTERNAL_HOSTS = ['docs.redpanda.com', 'netlify.app']

  // Styled in src/css/doc.css (visually hidden); see also doc-bump.css.
  var HINT_CLASS = 'doc-new-tab-hint'

  function isInternal (url) {
    if (url.host === window.location.host) return true
    return INTERNAL_HOSTS.some(function (h) {
      return url.hostname === h || url.hostname.endsWith('.' + h)
    })
  }

  function isExternal (a) {
    var url
    try {
      url = new URL(a.getAttribute('href'), window.location.href)
    } catch (e) {
      return false // unparseable href — leave the link alone
    }
    // Non-web schemes (mailto:, tel:, ...) are never external.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return !isInternal(url)
  }

  function ensureRel (a) {
    var rel = (a.getAttribute('rel') || '').split(/\s+/).filter(Boolean)
    if (rel.indexOf('noopener') === -1) rel.push('noopener')
    a.setAttribute('rel', rel.join(' '))
  }

  // Append a visually-hidden phrase so screen readers announce the new tab.
  // The external-link / download icons are decorative CSS and are not exposed
  // to assistive tech, so this is the only signal AT users get.
  function addHint (a) {
    if (a.querySelector('.' + HINT_CLASS)) return
    var hint = document.createElement('span')
    hint.className = HINT_CLASS
    hint.textContent = ' (opens in a new tab)'
    a.appendChild(hint)
  }

  function process (a) {
    // Respect an explicit target the author or a widget already set: only add a
    // new tab where none was requested. But any link that opens in a new tab
    // must carry rel="noopener" (reverse-tabnabbing protection) and announce
    // itself to assistive tech — including ^-suffixed or widget-set links that
    // already have target="_blank" but may be missing rel.
    if (!a.hasAttribute('target')) a.setAttribute('target', '_blank')
    if (a.getAttribute('target') === '_blank') {
      ensureRel(a)
      addHint(a)
    }
  }

  // Links inside the feedback widget and the search autocomplete are excluded
  // (matching the icon CSS) so we don't annotate or restyle UI chrome.
  function isExcluded (a) {
    return !!(a.closest('section.feedback-section') || a.closest('.aa-ItemIcon'))
  }

  function qualifies (a) {
    return isExternal(a) ||
      a.classList.contains('attachment') ||
      // An internal or relative ^-suffixed link still needs rel="noopener"
      // and the screen-reader hint.
      a.getAttribute('target') === '_blank'
  }

  function run () {
    document.querySelectorAll('.doc a[href]').forEach(function (a) {
      if (!isExcluded(a) && qualifies(a)) process(a)
    })
  }

  // Doc content rendered after page load (for example previews inside the
  // detached search overlay, which doc-bump.css gives the same icons) is
  // missed by run(). This capturing listener applies the new-tab behavior
  // just in time; process() is idempotent, so links run() already handled
  // are unaffected.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('.doc a[href]')
    if (a && !isExcluded(a) && qualifies(a)) process(a)
  }, true)

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run)
  } else {
    run()
  }
})()
