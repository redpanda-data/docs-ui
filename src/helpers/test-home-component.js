'use strict'

/**
 * Test helper to check if home component exists and has navigation
 */
module.exports = ({ data: { root } }) => {
  const { site, contentCatalog } = root

  if (!site || !site.components) {
    return 'No site or components'
  }

  const components = Array.isArray(site.components)
    ? site.components
    : Array.from(site.components.values ? site.components.values() : [])

  const homeComponent = components.find((c) => c.name === 'home')

  if (!homeComponent) {
    return `Home not found in site.components. Available: ${components.map((c) => c.name).join(', ')}`
  }

  // Also check contentCatalog
  const catalogHome = contentCatalog ? contentCatalog.getComponent('home') : null

  const latestVersion = homeComponent.latestVersion || (homeComponent.versions && homeComponent.versions[0])

  if (!latestVersion) {
    return 'Home has no versions'
  }

  const metadata = latestVersion.asciidoc?.attributes?.['component-metadata']
  const hasNav = !!latestVersion.navigation
  const navCount = latestVersion.navigation ? latestVersion.navigation.length : 0

  return `Home: v${latestVersion.version}, metadata=${!!metadata}, nav=${hasNav} (${navCount} items), catalog=${!!catalogHome}`
}
