'use strict'

/**
 * Marks article images below the fold as lazy-loading at build time.
 * Usage: {{{lazy-images page.contents}}}
 *
 * Asciidoctor emits <img> without a loading attribute, and 15-optimize-images.js
 * adds loading="lazy" only after DOMContentLoaded, by which point the browser
 * has already queued every image on the page: the Streaming quick-start
 * requests 154 images at load. Doing it in the HTML lets the browser skip
 * the ones the reader never scrolls to.
 *
 * The first two images keep the default eager behaviour so an above-the-fold
 * image (a possible LCP candidate) is never delayed. Images that already carry
 * a loading attribute, or a fetchpriority, are left alone.
 */
const EAGER_COUNT = 2

module.exports = (contents) => {
  if (contents == null) return ''
  const html = typeof contents === 'string' ? contents : contents.toString()
  let seen = 0
  return html.replace(/<img\b([^>]*)>/g, (tag, attrs) => {
    seen++
    if (seen <= EAGER_COUNT) return tag
    if (/\sloading=|\sfetchpriority=/.test(attrs)) return tag
    const decoding = /\sdecoding=/.test(attrs) ? '' : ' decoding="async"'
    return `<img loading="lazy"${decoding}${attrs}>`
  })
}
