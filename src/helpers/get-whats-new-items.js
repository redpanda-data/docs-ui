'use strict'

/**
 * Gets What's New items from the current page attributes
 *
 * Reads component-whats-new-N-* attributes where N = 1, 2, 3... up to 10
 *
 * Required attributes per item:
 * - component-whats-new-N-title: Feature title
 * - component-whats-new-N-desc: Feature description
 * - component-whats-new-N-link: Link to feature docs (Antora xref format)
 *
 * Optional attributes:
 * - component-whats-new-N-tag: Badge text (e.g., "Cloud BYOC", "Enterprise")
 *
 * Usage in component landing pages:
 *   {{#with (get-whats-new-items)}}
 *     {{#if hasItems}}
 *       {{#each items}}...{{/each}}
 *     {{/if}}
 *   {{/with}}
 *
 * @param {object} options - Handlebars options with data.root
 * @returns {object} { items: Array, componentName: string, hasItems: boolean }
 */
module.exports = function (options) {
  const { page } = options.data.root
  if (!page || !page.attributes) return { items: [] }

  const items = []
  const maxItems = 10 // Support up to 10 items

  for (let i = 1; i <= maxItems; i++) {
    const title = page.attributes[`component-whats-new-${i}-title`]
    if (!title) continue // No more items

    const desc = page.attributes[`component-whats-new-${i}-desc`]
    const link = page.attributes[`component-whats-new-${i}-link`]
    const tag = page.attributes[`component-whats-new-${i}-tag`]

    items.push({
      title,
      desc,
      link,
      tag,
      index: i,
    })
  }

  return {
    items,
    componentName: page.component.name,
    hasItems: items.length > 0,
  }
}
