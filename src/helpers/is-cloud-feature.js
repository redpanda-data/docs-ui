'use strict'

// Cache: Map<componentName, Map<url, isCloud>>
let urlCache = null
let cachedComponent = null

module.exports = (navUrl, { data: { root } }) => {
  const { contentCatalog, page } = root
  if (page.layout === '404') return false
  if (!contentCatalog) return false

  // Build URL map once per component (O(n) once, then O(1) lookups)
  if (cachedComponent !== page.component.name) {
    urlCache = new Map()
    cachedComponent = page.component.name

    const pages = contentCatalog.findBy({ component: page.component.name, family: 'page' })
    for (const p of pages) {
      if (p.pub?.url) {
        urlCache.set(p.pub.url, !!p.asciidoc?.attributes?.['page-cloud-only'])
      }
    }
  }

  return urlCache.get(navUrl) || false
}
