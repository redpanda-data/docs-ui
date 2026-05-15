'use strict'

// Cache for resource resolutions
const cache = new Map()

module.exports = (resource, { data, hash: context }) => {
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
    // Log error for unresolved resource
    console.error(`[resolve-resource] Unresolved resource: "${resource}" in context:`, {
      component: context.component,
      version: context.version,
      module: context.module,
      page: page.src?.relative || page.relativePath || 'unknown',
    })
    result = resource
  }

  cache.set(cacheKey, result)

  // Clear cache after short delay for next render cycle
  if (cache.size === 1) {
    setTimeout(() => cache.clear(), 100)
  }

  return result
}
