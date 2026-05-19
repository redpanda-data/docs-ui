'use strict'

/**
 * Test helper to check if home component exists and has navigation
 */
module.exports = ({ data: { root } }) => {
  const { site } = root

  if (!site || !site.components) {
    return 'No site or components'
  }

  const components = Array.isArray(site.components)
    ? site.components
    : Array.from(site.components.values ? site.components.values() : [])

  const homeComponent = components.find((c) => c.name === 'home')

  if (!homeComponent) {
    return `Home component not found. Available: ${components.map((c) => c.name).join(', ')}`
  }

  const latestVersion = homeComponent.latestVersion || (homeComponent.versions && homeComponent.versions[0])

  if (!latestVersion) {
    return 'Home component has no versions'
  }

  if (!latestVersion.navigation) {
    return `Home component ${latestVersion.version} has NO navigation`
  }

  return `Home component ${latestVersion.version} HAS navigation with ${latestVersion.navigation.length} items`
}
