'use strict'
module.exports = (url, { data: { root } }) => {
  const { contentCatalog } = root
  if (contentCatalog === undefined) return
  return url.includes('cloud')
}
