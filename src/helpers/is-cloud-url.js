'use strict'
module.exports = function (context) {
  const pageUrl = context.getFile().getPath()
  const searchString = 'cloud'

  return pageUrl.includes(searchString)
}
