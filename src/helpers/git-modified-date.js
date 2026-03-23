/**
 * Get git modified date from contentCatalog
 *
 * Queries contentCatalog to access page.asciidoc.attributes which contains
 * git-modified-date added by the add-git-dates extension.
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

  return pageInfo?.asciidoc?.attributes?.['git-modified-date'] || null
}
