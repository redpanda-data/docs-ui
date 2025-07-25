'use strict'

module.exports = (resource, { data, hash: context }) => {
  if (resource.startsWith('http')) {
    return resource
  }
  const { contentCatalog, page } = data.root

  // For preview builds where contentCatalog.resolveResource might not exist
  if (!contentCatalog || !contentCatalog.resolveResource) {
    // Return the resource as-is for preview builds
    return resource
  }

  if (page.component) {
    context = Object.assign({ component: page.component.name, version: page.version, module: page.module }, context)
  }
  const file = contentCatalog.resolveResource(resource, context)
  if (!file) return resource // Fallback to original resource if not found
  return file.pub.url
}
