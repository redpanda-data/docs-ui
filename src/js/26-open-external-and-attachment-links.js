;(function () {
  'use strict'

  // Open external (off-site) links and on-site attachment/download links in a
  // new tab, so readers don't lose their place in the current page.
  //
  // The external-link selector below MIRRORS the CSS rule that renders the
  // external-link icon in src/css/doc.css (and src/css/doc-bump.css). Keep the
  // two in sync: if you change the excluded hosts here, change them there too.
  // Attachment links are matched by the `.attachment` class Antora adds to
  // `xref:...attachment$...` links; they get the download glyph via CSS.

  function markNewTab (a) {
    if (a.hasAttribute('target')) return
    a.setAttribute('target', '_blank')
    const rel = (a.getAttribute('rel') || '').split(/\s+/).filter(Boolean)
    if (rel.indexOf('noopener') === -1) rel.push('noopener')
    a.setAttribute('rel', rel.join(' '))
  }

  function run () {
    // External, off-site links. The attribute-based :not() chain matches the
    // doc.css selector; the feedback-section / autocomplete exclusions are
    // applied in JS via closest() for broader browser support.
    const external = document.querySelectorAll(
      '.doc a[href*="//"]:not([href*="docs.redpanda.com"]):not([href*="netlify.app"]):not([href*="localhost"])'
    )
    external.forEach(function (a) {
      if (a.closest('section.feedback-section') || a.closest('.aa-ItemIcon')) return
      markNewTab(a)
    })

    // On-site attachment/download links (the _attachments files).
    document.querySelectorAll('.doc a.attachment[href]').forEach(markNewTab)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run)
  } else {
    run()
  }
})()
