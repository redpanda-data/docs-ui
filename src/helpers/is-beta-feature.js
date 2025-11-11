'use strict'

// Cache for beta status lookups (cleared between components)
const cache = new Map()
let currentComponent = null

module.exports = (navUrl, { data: { root } }) => {
  const { contentCatalog, page } = root
  if (page.layout === '404') return false
  if (!contentCatalog) return false

  // Reset cache if component changed
  if (currentComponent !== page.component.name) {
    cache.clear()
    currentComponent = page.component.name
  }

  // Check cache first
  if (cache.has(navUrl)) {
    return cache.get(navUrl)
  }

  // Query and cache result
  const pages = contentCatalog.findBy({ component: page.component.name, family: 'page' })

  for (const navGroup of pages) {
    if (navGroup.pub.url === navUrl) {
      const isBeta = !!navGroup.asciidoc.attributes['page-beta']
      cache.set(navUrl, isBeta)
      return isBeta
    }
  }

  cache.set(navUrl, false)
  return false
}
