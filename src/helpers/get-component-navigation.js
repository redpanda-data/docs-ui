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
    console.log(`[DEBUG get-component-navigation] Missing: site=${!!site}, components=${!!site?.components}, name=${componentName}`)
    return null
  }

  // Convert components to array if it's a Map
  const components = Array.isArray(site.components)
    ? site.components
    : Array.from(site.components.values ? site.components.values() : [])

  console.log(`[DEBUG get-component-navigation] Looking for ${componentName} in ${components.length} components`)
  console.log(`[DEBUG get-component-navigation] Available components: ${components.map((c) => c.name).join(', ')}`)

  // Find the component
  const component = components.find((c) => c.name === componentName)
  if (!component) {
    console.log(`[DEBUG get-component-navigation] Component ${componentName} not found`)
    return null
  }

  console.log(`[DEBUG get-component-navigation] Found component ${componentName}, versions: ${component.versions ? component.versions.length : 0}`)

  // Get the latest version's navigation
  const latestVersion = component.latestVersion || (component.versions && component.versions[0])
  if (latestVersion) {
    console.log(`[DEBUG get-component-navigation] Latest version: ${latestVersion.version}`)
    console.log(`[DEBUG get-component-navigation] Navigation exists: ${!!latestVersion.navigation}`)
    if (latestVersion.navigation) {
      console.log(`[DEBUG get-component-navigation] Navigation items: ${latestVersion.navigation.length}`)
      console.log(`[DEBUG get-component-navigation] First item: ${JSON.stringify(latestVersion.navigation[0])}`)
      return latestVersion.navigation
    }
  }

  console.log(`[DEBUG get-component-navigation] No navigation found for ${componentName}`)
  return null
}
