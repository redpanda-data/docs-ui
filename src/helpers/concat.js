'use strict'

/**
 * Concatenates multiple strings together.
 * Usage: {{concat 'string1' 'string2' 'string3'}}
 * @param {...string} strings - The strings to concatenate
 * @returns {string} The concatenated string
 */
module.exports = function (...args) {
  // Remove the Handlebars context object (last argument)
  const strings = args.slice(0, -1)
  return strings.join('')
}
