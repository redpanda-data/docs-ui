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
  if (!contentCatalog || !missing || !latest || typeof latest.version === 'undefined' || !latest.asciidoc) return
  const previousVersionWithoutPrefix = previousVersion.replace(/^\/\d+\.\d+\//, '')
  const intentionalRemovals = latest.asciidoc.attributes['removals-without-aliases']
  const isIntentionallyRemoved = intentionalRemovals && intentionalRemovals.some((removal) => {
    return previousVersionWithoutPrefix.includes(removal.page)
  })
  if (!isIntentionallyRemoved) console.warn(`${previousVersion} does not exist in ${latest.version}`)
}
