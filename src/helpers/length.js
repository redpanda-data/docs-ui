'use-strict'

module.exports = (obj) => {
  return Object.values(obj).filter((component) => {
    return !(
      component.latest &&
      component.latest.asciidoc &&
      component.latest.asciidoc.attributes &&
      component.latest.asciidoc.attributes['page-exclude-from-dropdown-selector']
    )
  }).length
}
