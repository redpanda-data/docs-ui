'use strict'

// Cache: Map<url, isNew>
let urlCache = null

/**
 * Checks if a resource URL points to a page with page-new attribute
 * Usage: {{#if (is-new-resource url)}}...{{/if}}
 *
 * @param {string} resourceUrl - The resolved URL to check
 * @param {object} options - Handlebars context
 * @returns {boolean} True if the page has page-new attribute
 */
module.exports = (resourceUrl, { data: { root } }) => {
  const { contentCatalog, page } = root
  if (page.layout === '404') return false
  if (!contentCatalog) return false
  if (!resourceUrl || typeof resourceUrl !== 'string') return false

  // Build URL map once for all pages (O(n) once, O(1) lookups)
  if (!urlCache) {
    urlCache = new Map()

    const pages = contentCatalog.findBy({ family: 'page' })
    for (const p of pages) {
      if (p.pub?.url) {
        urlCache.set(p.pub.url, !!p.asciidoc?.attributes?.['page-new'])
      }
    }
  }

  // Normalize URL (handle both /path and path formats)
  // Additional safety check before calling string methods
  if (typeof resourceUrl !== 'string' || !resourceUrl) return false

  const normalizedUrl = resourceUrl.startsWith('/') ? resourceUrl.slice(1) : resourceUrl
  const checkUrl = `/${normalizedUrl}`

  return urlCache.get(checkUrl) || urlCache.get(resourceUrl) || false
}
