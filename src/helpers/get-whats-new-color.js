'use strict'

/**
 * Determines the color for the What's New section based on featured components
 * - If all items are from the same component: use that component's color
 * - If items are from different components: use green (#10b981) as neutral
 * - If no component found: use green as fallback
 *
 * Returns RGB values (e.g., "31, 91, 214") for use in rgba() CSS functions
 *
 * Usage: {{get-whats-new-color site page.attributes}}
 *
 * @param {object} site - The site object with components
 * @param {object} attributes - Page attributes containing whats-new-*-link
 * @returns {string} RGB values (e.g., "31, 91, 214")
 */
module.exports = function (site, attributes) {
  // Helper to convert hex to RGB string
  const hexToRgb = (hex) => {
    if (!hex) return '16, 185, 129' // Green fallback
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    return result
      ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
      : '16, 185, 129'
  }

  // Helper to extract component name from resource specifier
  const getComponentFromResource = (resourceSpec) => {
    if (!resourceSpec || typeof resourceSpec !== 'string') return undefined
    const parts = resourceSpec.split(':')
    return parts.length > 0 ? parts[0] : undefined
  }

  // Helper to get component color
  const getComponentColor = (site, componentName) => {
    if (!site || !site.components || !componentName) return undefined

    let component
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

    if (!component) return undefined

    const version = component.latestVersion || (component.versions && component.versions[0])
    if (!version) return undefined

    const headerData =
      version.asciidoc && version.asciidoc.attributes && version.asciidoc.attributes['component-metadata']
    return headerData && headerData.color ? headerData.color : undefined
  }

  if (!attributes) return hexToRgb('#10b981') // Green fallback

  // Extract component names from up to 3 what's-new items
  const components = []

  if (attributes['whats-new-1-link']) {
    const comp = getComponentFromResource(attributes['whats-new-1-link'])
    if (comp) components.push(comp)
  }

  if (attributes['whats-new-2-link']) {
    const comp = getComponentFromResource(attributes['whats-new-2-link'])
    if (comp) components.push(comp)
  }

  if (attributes['whats-new-3-link']) {
    const comp = getComponentFromResource(attributes['whats-new-3-link'])
    if (comp) components.push(comp)
  }

  // If no components found, use green
  if (components.length === 0) return hexToRgb('#10b981')

  // Check if all components are the same
  const uniqueComponents = [...new Set(components)]

  // If multiple different components, use green as neutral
  if (uniqueComponents.length > 1) return hexToRgb('#10b981')

  // Single component (or all same) - use its color
  const componentName = uniqueComponents[0]
  const componentColor = getComponentColor(site, componentName)

  // Return component color or green as fallback
  return hexToRgb(componentColor || '#10b981')
}
