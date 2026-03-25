'use strict'

/**
 * Get a page attribute from contentCatalog
 *
 * This helper queries contentCatalog to access page.asciidoc.attributes,
 * which contains AsciiDoc document attributes set in the page or by extensions.
 *
 * Special handling for intrinsic attributes:
 * - "description": Falls back to page.description (Antora intrinsic property)
 * - "keywords": Falls back to page.keywords (Antora intrinsic property)
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

  // First try asciidoc.attributes
  const attrValue = pageInfo?.asciidoc?.attributes?.[attributeName]
  if (attrValue) return attrValue

  // Fall back to intrinsic page properties for special attributes
  // Antora stores :description: and :keywords: as intrinsic properties
  if (attributeName === 'description' && page.description) {
    return page.description
  }
  if (attributeName === 'keywords' && page.keywords) {
    return page.keywords
  }

  return null
}
