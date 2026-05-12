'use strict'

/**
 * Gets navigation for the home page.
 * Tries ADP component first, then falls back to self-managed (redpanda).
 *
 * @param {Object} site - The site object containing components
 * @param {Object} page - The current page object
 * @returns {Array|null} Navigation array or null if not found
 */
module.exports = (site, page) => {
  if (!site || !site.components) {
    return page ? page.navigation : null
  }

  // Convert components to array if it's a Map
  const components = Array.isArray(site.components)
    ? site.components
    : Array.from(site.components.values ? site.components.values() : [])

  // Try ADP component first (redpanda-adp)
  const adpComponent = components.find((c) => c.name === 'redpanda-adp')
  if (adpComponent) {
    // Get the latest version's navigation (Antora uses latestVersion)
    const latestVersion = adpComponent.latestVersion || (adpComponent.versions && adpComponent.versions[0])
    if (latestVersion && latestVersion.navigation) {
      return latestVersion.navigation
    }
  }

  // Fallback to self-managed (redpanda)
  const rootComponent = components.find((c) => c.name === 'redpanda')
  if (rootComponent) {
    const latestVersion = rootComponent.latestVersion || (rootComponent.versions && rootComponent.versions[0])
    if (latestVersion && latestVersion.navigation) {
      return latestVersion.navigation
    }
  }

  // Last resort: use page navigation
  return page ? page.navigation : null
}
