'use strict'

// Cache: Map<url, isLimitedAvailability>
let urlCache = null
let cachedComponent = null

module.exports = (navUrl, { data: { root } }) => {
  const { contentCatalog, page } = root
  if (page.layout === '404') return false

  // Preview mode: contentCatalog doesn't contain preview pages
  if (!contentCatalog) {
    const currentPageUrl = page.url
    const isCurrentPage = navUrl === currentPageUrl ||
                          (navUrl && page.src && navUrl.endsWith(page.src.basename.replace('.adoc', '.html')))
    return isCurrentPage && page.attributes && page.attributes['limited-availability']
  }

  // Build URL map once per component (O(n) once, then O(1) lookups)
  if (cachedComponent !== page.component.name) {
    urlCache = new Map()
    cachedComponent = page.component.name

    const pages = contentCatalog.findBy({ component: page.component.name, family: 'page' })
    for (const p of pages) {
      if (p.pub?.url) {
        urlCache.set(p.pub.url, !!p.asciidoc?.attributes?.['page-limited-availability'])
      }
    }
  }

  return urlCache.get(navUrl) || false
}
