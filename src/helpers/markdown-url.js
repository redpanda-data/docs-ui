/**
 * Get the URL to the markdown version of the current page
 *
 * Converts the page's public URL from .html to .md
 * Handles indexify format (directory-style URLs)
 */

module.exports = ({ data: { root } }) => {
  const { contentCatalog, page } = root

  // Safety checks for 404 pages and pages without components
  // Note: page.version can be null for unversioned components (cloud, connect, labs)
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

  // Safety check for pub URL
  if (!pageInfo || !pageInfo.pub || !pageInfo.pub.url) {
    return null
  }

  const url = pageInfo.pub.url

  // If URL ends with / (indexify format), append index.md
  if (url.endsWith('/')) {
    const result = `${url}index.md`
    return result
  }

  // Otherwise, replace .html with .md
  const result = url.replace(/\.html$/, '.md')
  return result
}
