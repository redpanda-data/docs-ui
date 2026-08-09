'use strict'

/**
 * Checks if a component exists in the site with actual content (versions)
 * Usage: {{#if (has-component site 'agentic-data-plane')}}...{{/if}}
 *
 * @param {object} site - The site object containing components
 * @param {string} componentName - The name of the component to check
 * @returns {boolean} True if component exists and has versions/content
 */
module.exports = function (site, componentName) {
  if (!site || !site.components || !componentName) return false

  let component

  // Handle different collection types (Map, Array, Object)
  if (site.components.get) {
    component = site.components.get(componentName)
  } else if (site.components.find) {
    component = site.components.find((c) => c.name === componentName)
  } else if (typeof site.components === 'object') {
    component = site.components[componentName]
    if (!component) {
      const components = Array.isArray(site.components) ? site.components : Object.values(site.components)
      component = components.find((c) => c && c.name === componentName)
    }
  }

  if (!component) return false

  // Check if component has versions (actual content)
  const version = component.latestVersion || (component.versions && component.versions[0])
  return !!version
}
