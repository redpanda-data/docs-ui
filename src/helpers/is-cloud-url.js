'use strict'
module.exports = function (context) {
  const { contentCatalog, page } = root
  if (page.layout === '404') return
  if (contentCatalog === undefined) return
  var pages = contentCatalog.navGroup
  var cp = contentCatalog.cp
  if (!pages || cp !== page.component.name) {
    pages = contentCatalog.findBy({ component: page.component.name, family: 'page' })
    contentCatalog.navGroup = pages
    contentCatalog.cp = page.component.name
  }
  for (let i = 0; i < pages.length; i++) {
    if (pages[i].pub.url === navUrl &&
      pages[i].asciidoc.attributes['page-cloudapi']) {
      return true
    }
  }
}
