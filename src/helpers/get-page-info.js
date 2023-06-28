'use strict'

module.exports = (url, { data: { root } }) => {
  const { contentCatalog, page } = root
  const pages = contentCatalog.findBy({ component: page.component.name, family: 'page' })
  for (let i = 0; i < pages.length; i++) {
    if (pages[i].pub.url === url) {
      return {
        title: pages[i].asciidoc.doctitle,
        description: pages[i].asciidoc.attributes.description,
        url: pages[i].pub.url,
        webUrl: pages[i].src.origin.webUrl,
        editUrl: pages[i].src.editUrl,
      }
    }
  }
}
