'use strict'

module.exports = (title, attributes, content, { data: { root } }) => {
  const { contentCatalog } = root
  if (attributes['component-name'] === 'labs') return content
  if (!contentCatalog) return content

  // Extract related labs from attributes
  const relatedLabs = parseRelatedLabs(attributes['related-labs'], root)
  if (!relatedLabs.length) return content

  let contentString = content.toString('utf8')
  contentString += '<div class="ulist">\n<ul>'

  relatedLabs.forEach((lab, index) => {
    contentString += `<li><a href="${lab.url}">${lab.title}</a>: ${lab.description}</li>`
  })
  contentString += '</ul></div>'.trim()

  const modifiedContent = Buffer.from(contentString, 'utf8')
  return modifiedContent
}

// Malformed page-related-labs JSON is logged and skipped instead of failing the build.
function parseRelatedLabs (value, root) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    const { page, logger } = root || {}
    const where = (page && page.src && page.src.path) || (page && page.relativeSrcPath) || 'unknown page'
    const message = `${where}: ignoring malformed JSON in page-related-labs (${err.message})`
    if (logger && typeof logger.warn === 'function') logger.warn(message)
    else console.warn(`[list-related-labs] ${message}`)
    return []
  }
}
