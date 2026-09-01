/**
 * Swap theme-adaptive images (AsciiDoc role=theme-adaptive) between their
 * light and dark variants to match the site's manual data-theme toggle.
 * Convention: the dark variant lives alongside the original with a `-dark`
 * suffix before the extension (console-overview.png -> console-overview-dark.png).
 *
 * The dark-src computation and the pre-paint rewrite for pages that load in
 * dark mode both live in head-scripts.hbs (window.themeAdaptiveToDarkSrc);
 * this script owns toggle-time swaps, missing-asset fallback, and dimension
 * re-stamping.
 */
;(function () {
  'use strict'

  const toDarkSrc = window.themeAdaptiveToDarkSrc
  if (typeof toDarkSrc !== 'function') return

  // Asciidoctor puts the role class on the block/inline wrapper, never on the
  // <img> itself. img[data-light-src] additionally covers copies of managed
  // images living outside .doc, such as the lightbox clone in 07-expand-images.js.
  const SELECTOR = '.doc img.theme-adaptive, .doc .theme-adaptive img, img[data-light-src]'

  // Element identity, not a data attribute: cloned images must not inherit
  // the "listeners attached" state from their originals.
  const managed = new WeakSet()

  function markFailed (img) {
    img.dataset.darkSrcFailed = 'true'
    img.setAttribute('src', img.dataset.lightSrc)
  }

  function prepare (img) {
    if (!img.dataset.lightSrc) img.dataset.lightSrc = img.getAttribute('src')
    if (!img.dataset.darkSrc) img.dataset.darkSrc = toDarkSrc(img.dataset.lightSrc)
    if (managed.has(img)) return
    managed.add(img)
    // A missing -dark asset must degrade to the light variant instead of a
    // broken image; nothing validates the sibling file at build time.
    img.addEventListener('error', function () {
      if (img.getAttribute('src') === img.dataset.darkSrc) markFailed(img)
    })
    // 15-optimize-images.js stamps width/height from whichever variant loaded
    // first; re-stamp on swap so the reserved space tracks the current variant.
    img.addEventListener('load', function () {
      if (img.dataset.autoDims && img.naturalWidth > 0 && img.naturalHeight > 0) {
        img.setAttribute('width', img.naturalWidth)
        img.setAttribute('height', img.naturalHeight)
      }
    })
  }

  function applyTheme (theme) {
    document.querySelectorAll(SELECTOR).forEach((img) => {
      prepare(img)
      const wantDark = theme === 'dark' && !img.dataset.darkSrcFailed
      const desiredSrc = wantDark ? img.dataset.darkSrc : img.dataset.lightSrc
      if (img.getAttribute('src') !== desiredSrc) img.setAttribute('src', desiredSrc)
      // The pre-paint rewrite in head-scripts.hbs can hit a missing -dark
      // asset before this script's error listener exists - catch it here.
      if (wantDark && img.complete && img.naturalWidth === 0) markFailed(img)
    })
  }

  function currentTheme () {
    return document.documentElement.getAttribute('data-theme') || 'light'
  }

  function init () {
    applyTheme(currentTheme())
    // React to any data-theme change (header toggle, sidebar toggle, OS
    // preference listener) without coupling setTheme() to this feature.
    const themeObserver = new window.MutationObserver(() => applyTheme(currentTheme()))
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
