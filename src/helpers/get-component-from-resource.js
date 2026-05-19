'use strict'

/**
 * Extracts component name from a resource specifier
 * Usage: {{get-component-from-resource "cloud-data-platform:sql:index.adoc"}}
 * Returns: "cloud-data-platform"
 *
 * @param {string} resourceSpec - Resource specifier (e.g., "component:module:page.adoc")
 * @returns {string|undefined} Component name or undefined
 */
module.exports = function (resourceSpec) {
  if (!resourceSpec || typeof resourceSpec !== 'string') return undefined

  // Resource specifiers are in format: component:module:page.adoc
  // Extract the first part (component name)
  const parts = resourceSpec.split(':')
  return parts.length > 0 ? parts[0] : undefined
}
