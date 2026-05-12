'use strict'

/**
 * Splits a string by a delimiter and returns an array
 * Usage: {{#each (split str ';;')}}...{{/each}}
 *
 * @param {string} str - The string to split
 * @param {string} delimiter - The delimiter to split by
 * @returns {Array} Array of strings
 */
module.exports = function (str, delimiter) {
  if (!str || typeof str !== 'string') return []
  if (!delimiter || typeof delimiter !== 'string') return [str]
  return str.split(delimiter).map((s) => s.trim()).filter((s) => s.length > 0)
}
