'use strict'

module.exports = (url, slot, { data: { root } }) => {
  const { contentCatalog } = root
  if (!contentCatalog) return null

  const pages = contentCatalog.findBy({ component: 'ROOT', family: 'page' })

  // Find the first page that matches the 'page-api' in the URL and the 'page-api-slot' matching the slot.
  const filteredPage = pages.find((page) => {
    const attributes = page.asciidoc.attributes
    return attributes['page-api'] &&
           url.includes(attributes['page-api']) &&
           attributes['page-api-slot'] === slot
  })

  if (!filteredPage) return null

  // Decode the Buffer to string for the HTML content
  const contentBuffer = Buffer.from(filteredPage._contents)
  const decodedContent = contentBuffer.toString('utf8')

  // Return the HTML content.
  return decodedContent
}
