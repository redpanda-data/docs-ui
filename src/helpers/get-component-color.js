'use strict'

/**
 * Gets the color for a component from its component-metadata attributes
 * Usage: {{get-component-color site "redpanda-adp"}}
 *
 * Looks up a component by name in site.components and returns its
 * component-metadata color value.
 *
 * @param {object} site - The site object containing components
 * @param {string} componentName - The component name to look up
 * @returns {string|undefined} The color hex value or undefined
 */
module.exports = function (site, componentName) {
  if (!site || !site.components || !componentName) return undefined

  // site.components in Antora might be various collection types
  // Try to find the component by name using different approaches
  let component

  // If it's a Map
  if (site.components.get) {
    component = site.components.get(componentName)
  } else if (site.components.find) {
    // If it has a find method (array-like)
    component = site.components.find((c) => c.name === componentName)
  } else if (typeof site.components === 'object') {
    // If it's an object with entries - try direct access by name
    component = site.components[componentName]
    // Or iterate over values
    if (!component) {
      const components = Array.isArray(site.components) ? site.components : Object.values(site.components)
      component = components.find((c) => c && c.name === componentName)
    }
  }

  if (!component) return undefined

  // Get the latestVersion (or first version if no latest)
  const version = component.latestVersion || (component.versions && component.versions[0])
  if (!version) return undefined

  // Get component-metadata from version attributes
  const headerData = version.asciidoc && version.asciidoc.attributes && version.asciidoc.attributes['component-metadata']

  if (headerData && headerData.color) {
    return headerData.color
  }

  return undefined
}
