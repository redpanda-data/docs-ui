'use strict'

// Cache for resource resolutions
const cache = new Map()

module.exports = (resource, { data, hash: context }) => {
  // Return undefined if resource is not provided
  if (!resource || typeof resource !== 'string') {
    return undefined
  }

  if (resource.startsWith('http')) {
    return resource
  }
  const { contentCatalog, page } = data.root

  // For preview builds where contentCatalog.resolveResource might not exist
  if (!contentCatalog || !contentCatalog.resolveResource) {
    // Convert Antora xref patterns to placeholder URLs for preview
    // Pattern: ROOT:module:path/to/file.adoc or component:module:path/to/file.adoc
    if (resource.includes(':') && resource.endsWith('.adoc')) {
      // Use anchor for preview since these pages don't exist
      return '#'
    }
    // Return the resource as-is for other cases
    return resource
  }

  if (page.component) {
    context = Object.assign({ component: page.component.name, version: page.version, module: page.module }, context)
  }

  // Create cache key from resource and context
  const cacheKey = `${resource}:${context.component}:${context.version}:${context.module}`

  // Check cache first
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)
  }

  const file = contentCatalog.resolveResource(resource, context)
  let result

  if (file) {
    result = file.pub.url
  } else {
    // Log error for unresolved resource using Antora's logger if available
    const pagePath = page.src?.path || page.src?.relative || page.relativePath || 'unknown'
    const pageComponent = page.component?.name || context.component
    const pageVersion = page.version || context.version
    const errorMsg = `Unresolved resource: "${resource}" in page "${pagePath}" (component: ${pageComponent}, version: ${pageVersion}, module: ${context.module})`
    const errorDetails = {
      file: page.src || { path: pagePath },
      source: page.src?.origin || { component: pageComponent, version: pageVersion },
    }

    if (data.root.logger) {
      // Use Antora's logger for structured output
      data.root.logger.error(errorDetails, errorMsg)
    } else {
      // Fallback to console for preview builds
      console.error(`[resolve-resource] ${errorMsg}`, errorDetails)
    }
    result = resource
  }

  cache.set(cacheKey, result)

  // Clear cache after short delay for next render cycle
  if (cache.size === 1) {
    setTimeout(() => cache.clear(), 100)
  }

  return result
}
