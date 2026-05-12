'use strict'

/**
 * Gets the full page-header-data object from component attributes
 * Usage: {{get-header-data page}}
 *
 * Expected page-header-data structure in antora.yml:
 *   asciidoc:
 *     attributes:
 *       page-header-data:
 *         title: "Self-Managed"
 *         section: "Data Platform"  # or "Agentic Data Plane"
 *         description: "Run Redpanda on your own infrastructure."
 *         color: "#0F8B66"
 *         order: 1
 *         eyebrow: "REDPANDA SELF-MANAGED"  # Full product name for hero badge
 *         heroGradient: "linear-gradient(180deg, #0B2A23 0%, #134638 100%)"  # Hero background
 *
 * @param {object} page - The page object from Antora
 * @returns {object|undefined} The page-header-data object or undefined
 */
module.exports = function (page) {
  if (!page) return undefined

  // Try to get from componentVersion.asciidoc.attributes['page-header-data']
  const headerData =
    page.componentVersion &&
    page.componentVersion.asciidoc &&
    page.componentVersion.asciidoc.attributes &&
    page.componentVersion.asciidoc.attributes['page-header-data']

  if (headerData) {
    return headerData
  }

  return undefined
}
