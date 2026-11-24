'use strict'

/**
 * Encodes a value for use as one URL query parameter value.
 *
 * Usage: href="{{{relativize home}}}?use-case={{encode-uri this}}"
 */
module.exports = (value) => (value === undefined || value === null ? '' : encodeURIComponent(String(value)))
