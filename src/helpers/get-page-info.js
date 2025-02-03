'use strict'

/**
 * Retrieves page information based on the provided URL and component.
 * If no component is provided, it searches all components for the page.
 * @param {string} url - The URL of the page.
 * @param {object} context - The context object containing the content catalog.
 * @param {object} context.data - The data object from the context.
 * @param {object} context.data.root - The root object containing the content catalog.
 * @returns {object} - An object containing page information.
 */

// Memoization cache to store page info for repeated lookups
const memoizedPageInfo = new Map()

module.exports = (url, { data: { root } }) => {
  const { contentCatalog, page } = root

  // Return immediately if contentCatalog is undefined
  if (!contentCatalog) return

  // Get component name
  const component = page.component.name

  // Generate a cache key using URL and component for memoization
  const cacheKey = `${component}-${url || page.url}`

  // Check if the result is already memoized
  if (memoizedPageInfo.has(cacheKey)) {
    return memoizedPageInfo.get(cacheKey)
  }

  let pageInfo

  let isCurrentComponent = false
  let urlParts = []

  if (url) {
    urlParts = url.split('/')
  }

  // Detect if a string contains any numeric version-like patterns.
  function containsVersionNumber (str) {
    return /v?\d+(\.\d+)?/.test(str)
  }

  // If the page component name is ROOT, the first part of the URL will be a version: https://docs.antora.org/antora/latest/component-name-key/#root-component
  if (urlParts[0] && page.component.name === 'ROOT' && containsVersionNumber(urlParts[0])) {
    isCurrentComponent = true
  } else if (urlParts[0] && urlParts[0] === page.component.name) {
    isCurrentComponent = true
  } else {
    isCurrentComponent = false
  }

  // If a URL is provided, search for the specific page by URL
  if (url) {
    let pages
    if (isCurrentComponent) {
      pages = contentCatalog.findBy({ component, family: 'page' })
    } else {
      pages = contentCatalog.findBy({ family: 'page' })
    }
    pageInfo = pages.find((p) => p.pub.url === url) // Find the page by URL

    if (!pageInfo) return // If no matching page is found, return early
  } else {
    // If no URL is provided, use the current page's information
    const { version, module, relativeSrcPath } = page

    pageInfo = contentCatalog.getById({
      component,
      version,
      module,
      family: 'page',
      relative: relativeSrcPath,
    })

    if (!pageInfo) return // Return early if no page info is found
  }

  // Construct the result object
  const result = {
    title: pageInfo.asciidoc.doctitle,
    description: pageInfo.asciidoc.attributes.description,
    url: pageInfo.pub.url,
    webUrl: pageInfo.src.origin.webUrl,
    editUrl: pageInfo.src.editUrl,
    path: pageInfo.src.origin.startPath.substring(0, pageInfo.src.origin.startPath.lastIndexOf('/')) || '/',
    branch: pageInfo.src.origin.branch,
  }

  // Store the result in the cache for future lookups
  memoizedPageInfo.set(cacheKey, result)

  return result
}
