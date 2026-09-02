/**
 * Swap theme-adaptive images (AsciiDoc role=theme-adaptive) between their
 * light and dark variants to match the site's manual data-theme toggle.
 * Convention: the dark variant lives alongside the original with a `-dark`
 * suffix before the extension (console-overview.png -> console-overview-dark.png).
 *
 * The dark-src computation, the shared selector, and the pre-paint rewrite
 * for pages that load in dark mode all live in head-scripts.hbs
 * (window.themeAdaptiveToDarkSrc / window.themeAdaptiveSelector); this
 * script owns toggle-time swaps, missing-asset fallback, and dimension
 * re-stamping. Known limitation: theme-adaptive images injected into the
 * DOM after load are only picked up on the next theme change.
 */
;(function () {
  'use strict'

  const toDarkSrc = window.themeAdaptiveToDarkSrc
  if (typeof toDarkSrc !== 'function') return

  // img[data-light-src] extends the shared selector to copies of managed
  // images living outside .doc, such as the lightbox clone in 07-expand-images.js.
  const SELECTOR = window.themeAdaptiveSelector + ', img[data-light-src]'

  // Element identity, not a data attribute: cloned images must not inherit
  // the "listeners attached" state from their originals.
  const managed = new WeakSet()

  function markFailed (img) {
    img.dataset.darkSrcFailed = 'true'
    img.setAttribute('src', img.dataset.lightSrc)
  }

  function prepare (img) {
    if (!img.dataset.lightSrc) {
      const src = img.getAttribute('src')
      if (!src) return false
      const darkSrc = toDarkSrc(src)
      // No usable dark variant (extensionless src, unparseable URL): leave
      // the image unmanaged rather than "swapping" to the identical URL -
      // the error fallback re-setting the same src would refetch forever.
      if (darkSrc === src) return false
      img.dataset.lightSrc = src
      img.dataset.darkSrc = darkSrc
    }
    if (!img.dataset.darkSrc || img.dataset.darkSrc === img.dataset.lightSrc) return false
    if (managed.has(img)) return true
    managed.add(img)
    // A missing -dark asset must degrade to the light variant instead of a
    // broken image; nothing validates the sibling file at build time.
    img.addEventListener('error', function () {
      if (!img.dataset.darkSrcFailed && img.getAttribute('src') === img.dataset.darkSrc) markFailed(img)
    })
    // 15-optimize-images.js stamps width/height from whichever variant loaded
    // first; re-stamp on swap so the reserved space tracks the current variant.
    img.addEventListener('load', function () {
      if (img.dataset.autoDims && img.naturalWidth > 0 && img.naturalHeight > 0) {
        img.setAttribute('width', img.naturalWidth)
        img.setAttribute('height', img.naturalHeight)
      }
    })
    // The pre-paint rewrite in head-scripts.hbs (or a clone of a managed
    // image) can arrive here already broken. Don't trust complete/naturalWidth
    // as a verdict - engines report 0 for dimensionless SVGs and the state
    // can be stale - and don't re-set the same src (a no-op in Chrome):
    // probe the URL with a fresh Image and only fall back on a real error.
    if (
      !img.dataset.darkSrcFailed &&
      img.getAttribute('src') === img.dataset.darkSrc &&
      img.complete &&
      img.naturalWidth === 0
    ) {
      const probe = new window.Image()
      const stillBroken = function () {
        return !img.dataset.darkSrcFailed && img.getAttribute('src') === img.dataset.darkSrc
      }
      probe.onerror = function () {
        if (stillBroken()) markFailed(img)
      }
      // The probe succeeding means the asset is fine and the element's broken
      // state was transient (or stale from the pre-paint rewrite). Re-setting
      // the identical src is a no-op, so drop it first to force the reload;
      // the probe has already warmed the cache, so this costs no extra fetch.
      probe.onload = function () {
        if (!stillBroken()) return
        img.removeAttribute('src')
        img.setAttribute('src', img.dataset.darkSrc)
      }
      probe.src = img.dataset.darkSrc
    }
    return true
  }

  function applyTheme (theme) {
    document.querySelectorAll(SELECTOR).forEach((img) => {
      if (!prepare(img)) return
      if (theme !== 'dark') {
        // A failure may have been transient (network blip on a real asset);
        // clearing it here makes the next dark toggle retry once.
        delete img.dataset.darkSrcFailed
        if (img.getAttribute('src') !== img.dataset.lightSrc) img.setAttribute('src', img.dataset.lightSrc)
        return
      }
      const desiredSrc = img.dataset.darkSrcFailed ? img.dataset.lightSrc : img.dataset.darkSrc
      if (img.getAttribute('src') !== desiredSrc) img.setAttribute('src', desiredSrc)
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
