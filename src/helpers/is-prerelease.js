'use strict'

// Cache for prerelease status lookups
const cache = new Map()

module.exports = (currentPage) => {
  if (!currentPage || !currentPage.attributes) return false
  const currentVersion = currentPage.attributes.version
  if (!currentVersion) return false
  if (!currentPage.component || !currentPage.component.versions) return false

  // Create cache key
  const cacheKey = `${currentPage.component.name}:${currentVersion}`

  // Check cache first
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)
  }

  // Find matching version
  const versionInfo = currentPage.component.versions.find((v) => v.version === currentVersion)
  const result = versionInfo ? versionInfo.prerelease === true : false

  cache.set(cacheKey, result)

  // Clear cache after short delay for next render cycle
  if (cache.size === 1) {
    setTimeout(() => cache.clear(), 100)
  }

  return result
}
