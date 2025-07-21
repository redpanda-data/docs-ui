'use strict'

/**
 * Gets module-specific announcement data for the current page
 * Returns an object with all announcement properties or null if no announcement
 * Usage: {{#with (get-module-announcement)}}{{this.text}}{{/with}}
 * @param {object} context - Handlebars context
 * @returns {object|null} Object with text, link, linkText properties or null
 */
module.exports = function ({ data: { root } }) {
  const { page } = root

  if (!page || !page.module || !page.componentVersion || !page.componentVersion.asciidoc) {
    return null
  }

  const attributes = page.componentVersion.asciidoc.attributes
  if (!attributes) return null

  const moduleKey = `announcement-${page.module}`

  // Check if module announcement exists
  if (!attributes[moduleKey]) return null

  return {
    text: attributes[`${moduleKey}-text`] || '',
    link: attributes[`${moduleKey}-link`] || '',
    linkText: attributes[`${moduleKey}-link-text`] || '',
  }
}
