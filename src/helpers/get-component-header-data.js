'use strict'

/**
 * Gets the page-header-data object from a component's latestVersion attributes
 * Usage: {{get-component-header-data component}}
 *
 * This is used in product-switcher to iterate over site.components and get
 * their header data for display in the dropdown.
 *
 * @param {object} component - A component object from site.components
 * @returns {object|undefined} The page-header-data object or undefined
 */
module.exports = function (component) {
  if (!component) return undefined

  // Get the latestVersion (or first version if no latest)
  const version = component.latestVersion || (component.versions && component.versions[0])
  if (!version) return undefined

  // Try to get from version.asciidoc.attributes['page-header-data']
  const headerData =
    version.asciidoc &&
    version.asciidoc.attributes &&
    version.asciidoc.attributes['page-header-data']

  if (headerData) {
    return headerData
  }

  return undefined
}
