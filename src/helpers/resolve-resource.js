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
    // Generate a realistic URL for preview builds
    const component = context.component || 'ROOT'
    const module = context.module || 'ROOT'

    // Parse resource ID: page$path/to/file.adoc or attachment$file.json
    if (resource.startsWith('page$')) {
      const pagePath = resource.slice(5).replace(/\.adoc$/, '/')
      // ROOT module pages go directly under component
      if (module === 'ROOT') {
        return `/${component}/${pagePath}`
      }
      return `/${component}/${module}/${pagePath}`
    }
    if (resource.startsWith('attachment$')) {
      const attachmentPath = resource.slice(11)
      if (module === 'ROOT') {
        return `/${component}/_attachments/${attachmentPath}`
      }
      return `/${component}/${module}/_attachments/${attachmentPath}`
    }
    // Fallback: return as-is
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
  const result = file ? file.pub.url : resource

  cache.set(cacheKey, result)

  // Clear cache after short delay for next render cycle
  if (cache.size === 1) {
    setTimeout(() => cache.clear(), 100)
  }

  return result
}
