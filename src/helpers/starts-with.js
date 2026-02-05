'use strict'

module.exports = (str, prefix) => {
  if (typeof str !== 'string' || typeof prefix !== 'string') return false
  return str.startsWith(prefix)
}
