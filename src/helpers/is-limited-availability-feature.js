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

  // Iterate through cached pages and check for limited availability status
  for (const navGroup of navGroupCache) {
    if (navGroup.pub.url === navUrl && navGroup.asciidoc.attributes['page-limited-availability']) {
      return true
    }
  }

  return false
}
