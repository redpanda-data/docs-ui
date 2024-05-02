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

  function removeRelativeLinkTags (htmlContent) {
    const regex = /<a\s+(?:[^>]*?\s+)?href="(?!(http:\/\/|https:\/\/))([^"]*)"(?:[^>]*)>(.*?)<\/a>/gis
    // Replace the matched <a> tags with just their text content
    return htmlContent.replace(regex, '$3')
  }
  function extractDocContent (htmlContent) {
    // Regular expression to find the <article class="doc">...</article> block
    const articleRegex = /<article\s+class="doc"[^>]*>([\s\S]*?)<\/article>/
    const match = htmlContent.match(articleRegex)

    if (!match) return ''

    // Extract content inside the article
    let articleContent = match[1]
    // Remove unnecessary elements
    articleContent = articleContent.replace(/<nav[^>]*>[\s\S]*?<\/nav>/g, '')
    articleContent = articleContent.replace(/<[^>]+class="[^"]*feedback-section[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/g, '')
    articleContent = articleContent.replace(/<div[^>]*class="[^"]*col[^"]*"[^>]*>[\s\S]*?<\/div>/g, '')
    articleContent = articleContent.replace(/<h1[^>]*>[\s\S]*?<\/h1>/g, '')
    articleContent = articleContent.replace(/<button[^>]*class="[^"]*thumb[^"]*"[^>]*>[\s\S]*?<\/button>/g, '')

    const cleanedContent = removeRelativeLinkTags(articleContent)

    return cleanedContent
  }
  // Decode the Buffer to string for the HTML content
  const contentBuffer = Buffer.from(filteredPage._contents)
  const decodedContent = contentBuffer.toString('utf8')
  const cleanedContent = extractDocContent(decodedContent)

  // Return the HTML content.
  return cleanedContent
}
