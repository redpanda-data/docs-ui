'use strict'

const VERSIONED_ROOT_RELATIVE_URL_RX = /^(\/[^/]+)\/[^/]+(?=\/)/

// Cache for alias lookups
const aliasCache = new Map()

module.exports = ({ data: { root } }) => {
  const { contentCatalog, env, page } = root
  let { url, version, missing } = page.latest || { url: page.url }

  if (missing) {
    // Create cache key
    const cacheKey = `${page.component.name}:${version}:${page.module}:${page.relativeSrcPath}`

    // Check cache first
    if (!aliasCache.has(cacheKey)) {
      const latestAlias = contentCatalog.getById({
        component: page.component.name,
        version,
        module: page.module,
        family: 'alias',
        relative: page.relativeSrcPath,
      })
      aliasCache.set(cacheKey, latestAlias)

      // Clear cache after short delay for next render cycle
      if (aliasCache.size === 1) {
        setTimeout(() => aliasCache.clear(), 100)
      }
    }

    const latestAlias = aliasCache.get(cacheKey)
    if (!latestAlias) return
    url = latestAlias.rel.pub.url
  }

  if (url.charAt() === '/') {
    return env.SUPPORTS_CURRENT_URL === 'true' ? url.replace(VERSIONED_ROOT_RELATIVE_URL_RX, '$1/current') : url
  } else if (env.PRIMARY_SITE_SUPPORTS_CURRENT_URL === 'true') {
    const primarySiteUrl = page.componentVersion.asciidoc.attributes['primary-site-url']
    return primarySiteUrl + url.substr(primarySiteUrl.length).replace(VERSIONED_ROOT_RELATIVE_URL_RX, '$1/current')
  }
  return url
}
