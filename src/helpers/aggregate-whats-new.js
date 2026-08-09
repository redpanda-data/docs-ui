'use strict'

/**
 * Aggregates What's New items from multiple components
 *
 * Searches each component's home page for component-whats-new-N-* attributes
 * and combines them into a single list for display on umbrella pages.
 *
 * Searches for home pages in this order:
 * 1. modules/ROOT/pages/index.adoc
 * 2. modules/home/pages/index.adoc
 * 3. Any page with component-whats-new-1-title attribute
 *
 * Usage on Data Platform umbrella page:
 *   {{#with (aggregate-whats-new site "cloud-data-platform" "streaming" "connect")}}
 *     {{#if hasItems}}
 *       {{#each items}}...{{/each}}
 *     {{/if}}
 *   {{/with}}
 *
 * @param {object} site - Site object with content catalog
 * @param {...string} componentNames - Component names to aggregate from
 * @returns {object} { items: Array, hasItems: boolean }
 */
module.exports = function (site, ...args) {
  // Last argument is Handlebars options object
  const options = args[args.length - 1]
  const componentNames = args.slice(0, -1)

  // Get contentCatalog from root context
  const { contentCatalog } = options.data.root
  if (!contentCatalog) return { items: [] }
  if (!site || !site.components) return { items: [] }

  const items = []

  // Helper to get component color
  const getComponentColor = (componentName) => {
    if (!site.components) return undefined

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

  // Collect items from each component
  for (const componentName of componentNames) {
    // Find the component's home/landing page
    const pages = contentCatalog.findBy({
      component: componentName,
      family: 'page',
    })

    if (!pages || pages.length === 0) continue

    // Look for home page or first page with component-whats-new attributes
    // Check for ROOT/pages/index.adoc, home/pages/index.adoc, or any page with the attribute
    const homePage = pages.find((p) => {
      const path = p.src.relative
      const module = p.src.module || ''
      const isRootIndex = module === 'ROOT' && path === 'index.adoc'
      const isHomeIndex = module === 'home' && path === 'index.adoc'
      const hasAttr = !!p.asciidoc?.attributes?.['component-whats-new-1-title']
      return isRootIndex || isHomeIndex || hasAttr
    })

    if (!homePage) continue

    const attrs = homePage.asciidoc?.attributes
    if (!attrs) continue

    // Extract component-whats-new items (up to 10)
    for (let i = 1; i <= 10; i++) {
      const title = attrs[`component-whats-new-${i}-title`]
      if (!title) break

      const desc = attrs[`component-whats-new-${i}-desc`]
      const link = attrs[`component-whats-new-${i}-link`]
      const tag = attrs[`component-whats-new-${i}-tag`]

      items.push({
        title,
        desc,
        link,
        tag,
        componentName,
        componentColor: getComponentColor(componentName),
        index: i,
      })
    }
  }

  return {
    items,
    hasItems: items.length > 0,
  }
}
