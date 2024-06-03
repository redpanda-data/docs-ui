'use strict'

/**
 * Warns if a specified previous version of content is missing from the latest version.
 *
 * @param {Object} latest - The latest content object.
 * @param {Boolean} missing - Indicates if content is missing.
 * @param {String} previousVersion - The version string of the previous content.
 * @param {Object} options - Options object containing the data root.
 */
module.exports = (latest, missing, previousVersion, { data: { root } }) => {
  const { contentCatalog } = root

  // Exit early if essential parameters are missing or invalid
  if (!contentCatalog || !missing || !latest || typeof latest.version === 'undefined' || !latest.asciidoc) return

  // Remove the version prefix from the previous version string
  const previousVersionWithoutPrefix = previousVersion.replace(/^\/\d+\.\d+\//, '')

  // Retrieve the list of intentionally removed content pages
  const intentionalRemovals = latest.asciidoc.attributes['removals-without-aliases']

  // Check if the content was intentionally removed
  const isIntentionallyRemoved = intentionalRemovals && intentionalRemovals.some((removal) => {
    return previousVersionWithoutPrefix.includes(removal.page)
  })

  // Log a warning if the content was not intentionally removed
  if (!isIntentionallyRemoved) {
    console.warn(`${previousVersion} does not exist in ${latest.version}`)
  }
}
