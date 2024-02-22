'use strict'

module.exports = (attributes, content, { data: { root } }) => {
  const { contentCatalog } = root
  if (attributes['component-name'] === 'redpanda-labs') return content
  if (!contentCatalog) return content

  // Extract related labs from attributes
  const relatedLabs = attributes['related-labs'] ? JSON.parse(attributes['related-labs']) : []

  if (!relatedLabs.length) return content

  // Append "Suggested labs" heading if there are matching labs
  let contentString = content.toString('utf8')
  contentString += '<div class="sect1">\n<h2 id="suggested-labs">Suggested labs</h2>\n<div class="sectionbody">\n<div class="ulist">\n<ul>'

  relatedLabs.forEach((lab, index) => {
    if (index > 10) return
    const hiddenClass = index >= 5 ? ' class="to-hide hidden"' : ''
    contentString += `<li${hiddenClass}><a href="${lab.url}">${lab.title}</a></li>`
  })

  contentString += '</ul></div><div class="badge-container">'

  if (relatedLabs.length > 5) {
    contentString += '<div class="badge-button" id="see-more-btn">See more</div>'
  }
  contentString += '<div class="badge-button"><a href="/redpanda-labs" class="search-all-labs-btn">Search all labs</a></div>'
  contentString += '</div></div></div>'

  const modifiedContent = Buffer.from(contentString, 'utf8')
  return modifiedContent
}
