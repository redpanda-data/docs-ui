/**
 * Swap `img.theme-adaptive` sources between light/dark variants to match
 * the site's manual data-theme toggle (see setTheme() in head-scripts.hbs).
 * Convention: dark variant lives alongside the original with a `-dark`
 * suffix before the extension, e.g. console-overview.png -> console-overview-dark.png.
 */
;(function () {
  'use strict'

  function toDarkSrc (src) {
    const hashIndex = src.indexOf('#')
    const hash = hashIndex === -1 ? '' : src.slice(hashIndex)
    const rest = hashIndex === -1 ? src : src.slice(0, hashIndex)
    const queryIndex = rest.indexOf('?')
    const query = queryIndex === -1 ? '' : rest.slice(queryIndex)
    const path = queryIndex === -1 ? rest : rest.slice(0, queryIndex)
    const dotIndex = path.lastIndexOf('.')
    const slashIndex = path.lastIndexOf('/')
    if (dotIndex <= slashIndex) return src
    return path.slice(0, dotIndex) + '-dark' + path.slice(dotIndex) + query + hash
  }

  function applyThemeAdaptiveImages (theme) {
    document.querySelectorAll('.doc img.theme-adaptive').forEach((img) => {
      if (!img.dataset.lightSrc) img.dataset.lightSrc = img.getAttribute('src')
      if (!img.dataset.darkSrc) img.dataset.darkSrc = toDarkSrc(img.dataset.lightSrc)
      const desiredSrc = theme === 'dark' ? img.dataset.darkSrc : img.dataset.lightSrc
      if (img.getAttribute('src') !== desiredSrc) img.setAttribute('src', desiredSrc)
    })
  }

  function init () {
    applyThemeAdaptiveImages(document.documentElement.getAttribute('data-theme') || 'light')
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }

  window.applyThemeAdaptiveImages = applyThemeAdaptiveImages
})()
