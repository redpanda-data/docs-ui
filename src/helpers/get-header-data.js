'use strict'

/**
 * Gets the full component-metadata object from component attributes
 * Usage: {{get-header-data page}}
 *
 * Expected component-metadata structure in antora.yml:
 *   asciidoc:
 *     attributes:
 *       component-metadata:
 *         title: "Self-Managed"
 *         description: "Run Redpanda on your own infrastructure."
 *         color: "#0F8B66"
 *         order: 1
 *         eyebrow: "REDPANDA SELF-MANAGED"  # Full product name for hero badge
 *         heroGradient: "linear-gradient(180deg, #0B2A23 0%, #134638 100%)"  # Hero background
 *
 * @param {object} page - The page object from Antora
 * @returns {object|undefined} The component-metadata object or undefined
 */
module.exports = function (page) {
  if (!page) return undefined

  // Try to get from componentVersion.asciidoc.attributes['component-metadata']
  const headerData =
    page.componentVersion &&
    page.componentVersion.asciidoc &&
    page.componentVersion.asciidoc.attributes &&
    page.componentVersion.asciidoc.attributes['component-metadata']

  if (headerData) {
    return headerData
  }

  return undefined
}
