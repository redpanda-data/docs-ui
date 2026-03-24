'use strict'

/**
 * Get a page attribute from contentCatalog
 *
 * This helper queries contentCatalog to access page.asciidoc.attributes,
 * which contains AsciiDoc document attributes set in the page or by extensions.
 *
 * Usage: {{page-attribute "description"}} or {{page-attribute "page-topic-type"}}
 */

module.exports = (attributeName, { data: { root } }) => {
  const { contentCatalog, page } = root

  // Safety checks
  if (!contentCatalog || !page || !page.component || page.version === undefined) {
    return null
  }

  // Query contentCatalog for full page object
  const pageInfo = contentCatalog.getById({
    component: page.component.name,
    version: page.version,
    module: page.module,
    family: 'page',
    relative: page.relativeSrcPath,
  })

  return pageInfo?.asciidoc?.attributes?.[attributeName] || null
}
