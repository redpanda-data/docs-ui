'use strict'

module.exports = (navUrl, { data: { root } }) => {
  const { contentCatalog, page } = root
  if (page.layout === '404') return
  var pages = contentCatalog.navGroup
  var cp = contentCatalog.cp
  if (!pages || cp !== page.component.name) {
    pages = contentCatalog.findBy({ component: page.component.name, family: 'page' })
    contentCatalog.navGroup = pages
    contentCatalog.cp = page.component.name
  }
  for (let i = 0; i < pages.length; i++) {
    if (pages[i].pub.url === navUrl &&
      pages[i].asciidoc.attributes['page-beta']) {
      return true
    }
  }
}
