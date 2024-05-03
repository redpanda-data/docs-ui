'use strict'

// Keep track of processed pages
const processedPages = new Set()

module.exports = (url, { data }) => {
  const { contentCatalog } = data.root
  if (!contentCatalog) return null

  const pages = contentCatalog.findBy({ component: 'api', family: 'page' })

  // Use filter to collect all matching pages
  const filteredPages = pages.filter((page) => {
    if (processedPages.has(page.src.relative)) {
      // Skip this page if it has already been processed
      return false
    }

    const pathParts = page.src.relative.split('/')
    if (pathParts.length !== 3) return false

     // Use the first directory as the API name
    const api = pathParts[0]

    if (url.includes(api)) {
      processedPages.add(page.src.relative)
      return true
    }
    return false
  }).map((page) => {
    // Process each page to convert its content and wrap it with the Rapidoc slot
    // https://rapidocweb.com/api.html#slots
    const contentBuffer = Buffer.from(page._contents)
    const decodedContent = contentBuffer.toString('utf8')
    // Use the second directory as the slot name
    return wrapHtmlWithSlot(decodedContent, page.src.relative.split('/')[1])
  })
  // Return the array of wrapped HTML content
  return filteredPages
}

function wrapHtmlWithSlot (htmlContent, slotName) {
  // Check if the slotName is 'auth' or 'overview'
  if (slotName === 'auth' || slotName === 'overview') {
    return `<div slot="${slotName}">${htmlContent}</div>`
  }
  // Return the content without wrapping if the slot does not match
  return htmlContent
}
