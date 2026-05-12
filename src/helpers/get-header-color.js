'use strict'

/**
 * Gets the header color from page-header-data attributes
 * Usage: {{get-header-color page}}
 * @param {object} page - The page object from Antora
 * @returns {string|undefined} The hex color or undefined
 */
module.exports = function (page) {
  if (!page) return undefined

  // Try to get from componentVersion.asciidoc.attributes['page-header-data'].color
  const headerData =
    page.componentVersion &&
    page.componentVersion.asciidoc &&
    page.componentVersion.asciidoc.attributes &&
    page.componentVersion.asciidoc.attributes['page-header-data']

  if (headerData && headerData.color) {
    return headerData.color
  }

  return undefined
}
