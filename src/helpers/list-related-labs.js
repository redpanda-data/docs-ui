'use strict'

module.exports = (title, attributes, content, { data: { root } }) => {
  const { contentCatalog } = root
  if (attributes['component-name'] === 'redpanda-labs') return content
  if (!contentCatalog) return content

  // Extract related labs from attributes
  const relatedLabs = attributes['related-labs'] ? JSON.parse(attributes['related-labs']) : []
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
