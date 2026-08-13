;(function () {
  'use strict'

  // Open external (off-site) links and on-site attachment/download links in a
  // new tab, and announce that to assistive tech, so readers don't silently
  // lose their place in the current page.
  //
  // The external-link selector below MIRRORS the CSS rule that renders the
  // external-link icon in src/css/doc.css (and src/css/doc-bump.css). Keep the
  // two in sync: if you change the excluded hosts here, change them there too.
  // (localhost is intentionally NOT excluded: a link to a local app opens a
  // different origin, so a new tab keeps the docs page in place.)
  // Attachment links are matched by the `.attachment` class Antora adds to
  // `xref:...attachment$...` links; they get the download glyph via CSS.

  const HINT_CLASS = 'doc-new-tab-hint'

  function ensureRel (a) {
    const rel = (a.getAttribute('rel') || '').split(/\s+/).filter(Boolean)
    if (rel.indexOf('noopener') === -1) rel.push('noopener')
    a.setAttribute('rel', rel.join(' '))
  }

  // Append a visually-hidden phrase so screen readers announce the new tab.
  // The external-link / download icons are decorative CSS and are not exposed
  // to assistive tech, so this is the only signal AT users get.
  function addHint (a) {
    if (a.querySelector('.' + HINT_CLASS)) return
    const hint = document.createElement('span')
    hint.className = 'visually-hidden ' + HINT_CLASS
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

  function run () {
    const external = document.querySelectorAll(
      '.doc a[href*="//"]:not([href*="docs.redpanda.com"]):not([href*="netlify.app"])'
    )
    external.forEach(function (a) {
      if (a.closest('section.feedback-section') || a.closest('.aa-ItemIcon')) return
      process(a)
    })

    // On-site attachment/download links (the _attachments files).
    document.querySelectorAll('.doc a.attachment[href]').forEach(process)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run)
  } else {
    run()
  }
})()
