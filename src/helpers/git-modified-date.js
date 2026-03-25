/**
 * Get git modified date from contentCatalog
 *
 * Queries contentCatalog to access page.asciidoc.attributes which contains
 * page-git-modified-date added by the add-git-dates extension.
 *
 * The extension uses the page- prefix so the attribute is also accessible
 * via page.attributes['git-modified-date'] in the UI model.
 */

module.exports = ({ data: { root } }) => {
  const { contentCatalog, page } = root

  // Safety checks
  if (!contentCatalog || !page || !page.component || page.version === undefined) return null

  // Query contentCatalog for full page object with extension-added attributes
  const pageInfo = contentCatalog.getById({
    component: page.component.name,
    version: page.version,
    module: page.module,
    family: 'page',
    relative: page.relativeSrcPath,
  })

  // The extension sets page-git-modified-date (with page- prefix)
  return pageInfo?.asciidoc?.attributes?.['page-git-modified-date'] || null
}
