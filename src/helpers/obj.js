'use strict'

module.exports = (a) => {
  if (typeof a === 'undefined' || a === null) {
    return {}
  }
  
  return JSON.parse(a)
}
