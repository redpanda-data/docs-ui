/**
 * Check if page has markdown equivalent
 *
 * Queries contentCatalog to access page.asciidoc.attributes which contains
 * custom attributes added by extensions.
 */

module.exports = ({ data: { root } }) => {
  const { contentCatalog, page } = root

  // Safety checks for 404 pages and pages without components
  // Note: page.version can be null for unversioned components (cloud, connect, labs)
  if (!contentCatalog || !page || !page.component || page.version === undefined) return false

  // Only show dropdown on specific page layouts
  const allowedLayouts = ['default', 'index', 'lab']
  if (!allowedLayouts.includes(page.layout)) return false

  // Exclude specific page roles
  const excludedRoles = ['bloblang-playground', 'component-home-v2']
  if (page.attributes?.role && excludedRoles.includes(page.attributes.role)) return false

  // Query contentCatalog for full page object
  const pageInfo = contentCatalog.getById({
    component: page.component.name,
    version: page.version,
    module: page.module,
    family: 'page',
    relative: page.relativeSrcPath,
  })

  // Check if markdown marker exists (set by convert-to-markdown extension)
  return pageInfo?.asciidoc?.attributes?.['page-has-markdown'] !== undefined
}
