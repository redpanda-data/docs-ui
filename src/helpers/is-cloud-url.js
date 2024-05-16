'use strict'
module.exports = (url, { data: { root } }) => {
  const { contentCatalog } = root
  console.log(url)
  if (contentCatalog === undefined) return
  if (!url.includes('cloud')) return false
  return true
}
