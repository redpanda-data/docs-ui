'use strict'

/**
 * Retrieves page information based on the provided URL and component.
 * If no component is provided, it searches all components for the page.
 * @param {string} url - The URL of the page.
 * @param {string} component - The component name.
 * @param {object} context - The context object containing the content catalog.
 * @param {object} context.data - The data object from the context.
 * @param {object} context.data.root - The root object containing the content catalog.
 * @returns {object} - An object containing page information.
 */

module.exports = (url, component, { data: { root } }) => {
  const { contentCatalog } = root
  if (!contentCatalog) return
  const pages = component ? contentCatalog.findBy({ component, family: 'page' }) : contentCatalog.findBy({ family: 'page' })
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
