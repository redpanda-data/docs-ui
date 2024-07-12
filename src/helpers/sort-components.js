'use strict'
/* Put this in nav-explore
{{#each (sort-components site.components)}}
{{/each}}
*/

module.exports = (collection) => {
  const sourceCollection = Object.values(collection).reduce((accum, it) => {
    const headerAttributes = it.latest?.asciidoc?.attributes['page-header-data']
    if (headerAttributes && headerAttributes.order !== undefined) {
      accum.push({
        title: it.latest.title,
        url: it.latest.url,
        order: headerAttributes.order,
        color: headerAttributes.color,
      })
    }
    return accum
  }, [])

  // Sort by order
  sourceCollection.sort((a, b) => a.order - b.order)

  return sourceCollection
}
