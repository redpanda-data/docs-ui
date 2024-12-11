
module.exports = ({ data: { root } }) => {
  const { page } = root
  const indexKey = page.attributes['index-data']
  if (!indexKey) return null
  const indexData = page.component.asciidoc.attributes[indexKey]
  if (!indexData) return null
  try {
    const parsedData = JSON.parse(indexData)
    const currentPageUrl = page.url
    const filteredData = parsedData.filter((item) => item.url !== currentPageUrl)
    return filteredData
  } catch (error) {
    console.log(`Error parsing JSON attribute "${indexKey}" in ${page.url} component. Index page will be empty. Make sure the generate-index-data extension is correctly configured.\n\n ${error}`)
    return null
  }
}
