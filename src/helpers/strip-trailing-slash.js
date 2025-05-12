'use strict'

module.exports = (url) => {
  if (typeof url !== 'string') return url
  // leave “/” alone, but drop any single trailing slash
  return url.length > 1 && url.endsWith('/')
    ? url.slice(0, -1)
    : url
}
