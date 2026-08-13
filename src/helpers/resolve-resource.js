'use strict'

// Cache for resource resolutions
const cache = new Map()

// Track logged errors to avoid duplicates
const loggedErrors = new Set()

/**
 * Log an unresolved resource warning
 * @param {string} resource - The resource that couldn't be resolved
 * @param {string} reason - Why it couldn't be resolved
 * @param {object} page - The page object
 * @param {object} context - Resolution context
 * @param {object} logger - Antora logger (optional)
 */
function logUnresolved (resource, reason, page, context, logger) {
  const pagePath = page?.src?.path || page?.src?.relative || page?.relativePath || 'unknown'
  const pageComponent = page?.component?.name || context?.component || 'unknown'
  const pageVersion = page?.version || context?.version || 'unknown'

  // Create unique key to avoid duplicate logs
  const logKey = `${resource}:${pagePath}:${pageComponent}:${pageVersion}`
  if (loggedErrors.has(logKey)) return
  loggedErrors.add(logKey)

  const errorMsg = `[${pageComponent}:${pageVersion}] ${pagePath}: unresolved resource "${resource}" - ${reason}`
  const errorDetails = {
    file: page?.src || { path: pagePath },
    source: page?.src?.origin || { component: pageComponent, version: pageVersion },
  }

  if (logger) {
    // Use Antora's logger for structured output
    logger.warn(errorDetails, errorMsg)
  } else {
    // Fallback to console
    console.warn(`[resolve-resource] ${errorMsg}`)
  }
}

module.exports = (resource, { data, hash: context }) => {
  const { page, logger } = data.root || {}
  const fallbackUrl = context?.fallback
  // An explicitly provided fallback (even an empty one) marks the resolution
  // as optional: the caller handles the miss, so an unresolved target is
  // expected on components that don't publish the resource and must not warn.
  const optional = context ? 'fallback' in context : false

  // Log and return undefined if resource is not provided
  if (!resource || typeof resource !== 'string') {
    // Only log if we have page context (not during initial template compilation)
    if (page && resource === undefined) {
      if (!optional) logUnresolved('undefined', 'attribute not defined (check page attributes)', page, context, logger)
    }
    return fallbackUrl || undefined
  }

  // External URLs pass through
  if (resource.startsWith('http')) {
    return resource
  }

  // Root-relative URLs pass through (e.g. pub.url values set by extensions such as
  // the component_type_dropdown macro's page-context-switcher attribute)
  if (resource.startsWith('/')) {
    return resource
  }

  // Handle special keyword "current" - not a valid resource ID
  // This is sometimes incorrectly used to mean "current page" or "current version"
  if (resource === 'current') {
    // Return current page URL if available, otherwise placeholder
    if (page && page.url) {
      return page.url
    }
    return '#'
  }

  const { contentCatalog } = data.root || {}

  // For preview builds where contentCatalog.resolveResource might not exist
  if (!contentCatalog || !contentCatalog.resolveResource) {
    // Generate realistic URLs for preview builds
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

    // Handle xref-like patterns that would need resolution
    if (resource.includes(':') && resource.endsWith('.adoc')) {
      // Preview mode - return placeholder
      return '#'
    }
    // Return the resource as-is for other cases
    return resource
  }

  if (page && page.component) {
    // Hash params whose expression evaluated to undefined must not clobber
    // the page defaults (version=(or ...) can legitimately come up empty).
    const explicit = {}
    for (const [key, value] of Object.entries(context || {})) {
      if (value !== undefined) explicit[key] = value
    }
    context = Object.assign({ component: page.component.name, version: page.version, module: page.module }, explicit)
  }

  // Cross-component resolution from a versionless component (version '')
  // asks for a version the target component doesn't have. Default to the
  // target component's latest version instead.
  if (!context.version && context.component && contentCatalog.getComponent) {
    const targetComponent = contentCatalog.getComponent(context.component)
    if (targetComponent && targetComponent.latest) context.version = targetComponent.latest.version
  }

  // Convert module-relative resource (module:page.adoc) to fully qualified (version@component:module:page.adoc)
  // This ensures Antora resolves to the current page's component and version
  let resolvedResource = resource
  if (page && page.component && page.version && !resource.includes('@')) {
    // Check if resource is module-relative (has exactly one colon, pattern: module:path)
    const colonCount = (resource.match(/:/g) || []).length
    if (colonCount === 1 && resource.endsWith('.adoc')) {
      // Convert module:page.adoc to version@component:module:page.adoc
      resolvedResource = `${page.version}@${page.component.name}:${resource}`
    }
  }

  // Create cache key from resource and context
  const cacheKey = `${resolvedResource}:${context?.component}:${context?.version}:${context?.module}`

  // Check cache first
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)
  }

  const file = contentCatalog.resolveResource(resolvedResource, context)
  let result

  if (file) {
    result = file.pub.url
  } else if (fallbackUrl) {
    // Use fallback URL when resource not in content catalog
    result = fallbackUrl
  } else {
    // Log warning for unresolved resource (only if no fallback provided)
    if (!optional) logUnresolved(resolvedResource, 'target not found in content catalog', page, context, logger)
    result = resource
  }

  cache.set(cacheKey, result)

  // Clear cache after short delay for next render cycle
  if (cache.size === 1) {
    setTimeout(() => cache.clear(), 100)
  }

  return result
}
