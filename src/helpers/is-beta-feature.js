'use strict'

let navGroupCache = null
let componentCache = null

module.exports = (navUrl, { data: { root } }) => {
  const { contentCatalog, page } = root
  if (page.layout === '404') return false
  if (!contentCatalog) return false

  // Only perform lookup if caches are invalid or stale
  if (!navGroupCache || componentCache !== page.component.name) {
    navGroupCache = contentCatalog.findBy({ component: page.component.name, family: 'page' })
    componentCache = page.component.name
  }

  // Iterate through cached pages and check for beta status
  for (let i = 0; i < navGroupCache.length; i++) {
    if (navGroupCache[i].pub.url === navUrl && navGroupCache[i].asciidoc.attributes['page-beta']) {
      return true
    }
  }

  return false
}
