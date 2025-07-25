'use strict'

/**
 * Gets a nested property from an object using a dynamic key
 * Usage: {{get-property object 'dynamic-key'}}
 * @param {object} obj - The object to get the property from
 * @param {string} key - The property key to access
 * @returns {*} The property value or undefined
 */
module.exports = function (obj, key) {
  if (!obj || typeof obj !== 'object') return undefined
  return obj[key]
}
