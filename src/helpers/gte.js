'use strict'

/**
 * Handlebars helper: Greater than or equal (>=)
 * Usage: {{#if (gte items.length 5)}}...{{/if}}
 */
module.exports = function (a, b) {
  return a >= b
}
