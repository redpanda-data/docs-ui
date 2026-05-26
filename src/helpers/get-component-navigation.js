'use strict'

/**
 * Gets navigation for a specific component by name
 *
 * @param {Object} site - The site object containing components
 * @param {string} componentName - Name of the component to get navigation for
 * @returns {Array|null} Navigation array or null if not found
 */
module.exports = (site, componentName) => {
  if (!site || !site.components || !componentName) {
    return null
  }

  // Convert components to array if it's a Map
  const components = Array.isArray(site.components)
    ? site.components
    : Array.from(site.components.values ? site.components.values() : [])

  // Find the component
  const component = components.find((c) => c.name === componentName)
  if (!component) {
    return null
  }

  // Get the latest version's navigation
  const latestVersion = component.latestVersion || (component.versions && component.versions[0])
  if (latestVersion && latestVersion.navigation) {
    return latestVersion.navigation
  }

  return null
}
