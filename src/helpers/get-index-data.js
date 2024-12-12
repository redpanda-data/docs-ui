module.exports = ({ data: { root } }) => {
  const { page } = root
  const indexKey = page.attributes['index-data']
  if (!indexKey) return null

  const indexData = page.component.asciidoc.attributes[indexKey]
  if (!indexData) return null
  const matchComponentVersion = page.attributes['match-component-version']

  try {
    const parsedData = JSON.parse(indexData)
    const currentPageUrl = page.url
    const currentComponent = page.component.name
    const currentVersion = page.version

    const filteredData = parsedData.reduce((acc, item) => {
      if (item.pages && Array.isArray(item.pages)) {
        const filteredPages = item.pages.filter((page) => {
          const isNotCurrentPage = page.url !== currentPageUrl

          // Optional filtering by component and version
          const matchesComponentVersion = !matchComponentVersion || (
            item.component === currentComponent && item.version === currentVersion
          )

          return isNotCurrentPage && matchesComponentVersion
        })
        acc.push(...filteredPages)
      }
      return acc
    }, [])

    return filteredData
  } catch (error) {
    console.log(
      `Error parsing JSON attribute "${indexKey}" in ${page.url} component. Index page will be empty. Make sure the generate-index-data extension is correctly configured.\n\n ${error}`
    )
    return null
  }
}
