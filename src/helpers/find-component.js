'use strict'

/**
 * Finds a component by name from site.components
 * Usage: {{#with (find-component site 'component-name')}}...{{/with}}
 *
 * @param {object} site - The site object containing components array
 * @param {string} componentName - The name of the component to find
 * @returns {object|undefined} The component object or undefined if not found
 */
module.exports = function (site, componentName) {
  if (!site || !site.components || !componentName) return undefined

  // site.components might be a Handlebars SafeString or similar, not a true array
  // Convert to array if needed and iterate manually
  const components = Array.isArray(site.components) ? site.components : Object.values(site.components || {})

  for (let i = 0; i < components.length; i++) {
    if (components[i] && components[i].name === componentName) {
      return components[i]
    }
  }

  return undefined
}
