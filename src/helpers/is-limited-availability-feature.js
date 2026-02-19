'use strict'

let navGroupCache = null
let componentCache = null

module.exports = (navUrl, { data: { root } }) => {
  const { contentCatalog, page } = root
  if (page.layout === '404') return false

  // Preview mode: contentCatalog doesn't contain preview pages
  // Fall back to checking if this nav item is the current page
  if (!contentCatalog) {
    const currentPageUrl = page.url
    // Check if this navigation URL matches the current page
    const isCurrentPage = navUrl === currentPageUrl ||
                          (navUrl && page.src && navUrl.endsWith(page.src.basename.replace('.adoc', '.html')))
    // Return the current page's limited availability status
    return isCurrentPage && page.attributes && page.attributes['limited-availability']
  }

  // Only perform lookup if caches are invalid or stale
  if (!navGroupCache || componentCache !== page.component.name) {
    navGroupCache = contentCatalog.findBy({ component: page.component.name, family: 'page' })
    componentCache = page.component.name
  }

  // Iterate through cached pages and check for limited availability status
  for (const navGroup of navGroupCache) {
    // Guard against missing properties
    if (navGroup.pub && navGroup.pub.url === navUrl &&
        navGroup.asciidoc && navGroup.asciidoc.attributes &&
        navGroup.asciidoc.attributes['page-limited-availability']) {
      return true
    }
  }

  return false
}
