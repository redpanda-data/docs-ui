'use strict'

module.exports = (latest, missing, previousVersion, { data: { root } }) => {
  const { contentCatalog } = root
  if (!contentCatalog || !missing) return
  console.warn(`${previousVersion} does not exist in ${latest.version}`)
}
