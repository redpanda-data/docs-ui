'use strict'

const { posix: path } = require('path')

module.exports = (to, from, ctx) => {
  if (!to) return '#'

  // If ctx is missing or malformed (e.g., during CLI rendering)
  let sitePath = ''
  let fromPath = from

  if (!ctx && from?.data?.root) {
    // Classic Handlebars 2-arg call with context
    ctx = from
    fromPath = ctx?.data?.root?.page?.url
    sitePath = ctx?.data?.root?.site?.path || ''
  } else if (ctx?.data?.root) {
    fromPath = ctx?.data?.root?.page?.url
    sitePath = ctx?.data?.root?.site?.path || ''
  }

  if (to.charAt(0) !== '/') return to
  if (!fromPath) return sitePath + to

  let hash = ''
  const hashIdx = to.indexOf('#')
  if (~hashIdx) {
    hash = to.slice(hashIdx)
    to = to.slice(0, hashIdx)
  }

  return to === fromPath
    ? hash || (isDir(to) ? './' : path.basename(to))
    : (path.relative(path.dirname(fromPath + '.'), to) || '.') + (isDir(to) ? '/' + hash : hash)
}

function isDir (str) {
  return str.endsWith('/')
}
