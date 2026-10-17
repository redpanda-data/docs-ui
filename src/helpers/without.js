'use strict'

/**
 * `list` minus every value in `exclude`. A missing or non-array `exclude`
 * returns `list` as it is, and a non-array `list` is an empty list.
 *
 * Usage: {{#each (without solution.technologies catalog.universalTechnologies)}}
 */
module.exports = function (list, exclude) {
  const items = Array.isArray(list) ? list : []
  if (!Array.isArray(exclude) || !exclude.length) return items
  return items.filter((item) => exclude.indexOf(item) === -1)
}
