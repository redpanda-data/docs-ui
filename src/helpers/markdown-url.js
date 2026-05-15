/**
 * Get the URL to the markdown version of the current page
 *
 * Converts the page's public URL from .html to .md
 * Handles indexify format (directory-style URLs)
 */

module.exports = ({ data: { root } }) => {
  const { contentCatalog, page } = root

  // In preview mode (no contentCatalog), return placeholder URL for testing
  if (!contentCatalog) {
    // Return a test URL based on current page URL if available
    if (page?.url) {
      return page.url.replace(/\.html$/, '.md')
    }
    return '/preview-test.md'
  }

  // Safety checks for 404 pages and pages without components
  // Note: page.version can be null for unversioned components (cloud, connect, labs)
  if (!page || !page.component || page.version === undefined) {
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

  // Handle root path special case
  if (url === '/') {
    return '/index.md'
  }

  // If URL ends with / (indexify format), convert to .md (without index)
  if (url.endsWith('/')) {
    const result = `${url.slice(0, -1)}.md`
    return result
  }

  // Otherwise, replace .html with .md
  const result = url.replace(/\.html$/, '.md')
  return result
}
