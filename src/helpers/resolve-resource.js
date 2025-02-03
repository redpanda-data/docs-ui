'use strict'

module.exports = (resource, { data, hash: context }) => {
  if (resource.startsWith('http')) {
    return resource
  }
  const { contentCatalog, page } = data.root
  if (page.component) {
    context = Object.assign({ component: page.component.name, version: page.version, module: page.module }, context)
  }
  const file = contentCatalog.resolveResource(resource, context)
  if (!file) return
  return file.pub.url
}
