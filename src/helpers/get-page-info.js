'use strict'

module.exports = (url, { data: { root } }) => {
  const { contentCatalog, page } = root
  if (!contentCatalog) return
  const pages = contentCatalog.findBy({ component: page.component.name, family: 'page' })
  for (let i = 0; i < pages.length; i++) {
    if (!url || pages[i].pub.url === url) {
      return {
        title: pages[i].asciidoc.doctitle,
        description: pages[i].asciidoc.attributes.description,
        url: pages[i].pub.url,
        webUrl: pages[i].src.origin.webUrl,
        editUrl: pages[i].src.editUrl,
        path: pages[i].src.origin.startPath.substring(0, pages[i].src.origin.startPath.lastIndexOf('/')) || '/',
        branch: pages[i].src.origin.branch,
      }
    }
  }
}
