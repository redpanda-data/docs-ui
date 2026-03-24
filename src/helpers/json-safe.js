'use strict'

/**
 * Escapes a string for safe inclusion in JSON-LD script blocks.
 *
 * This helper addresses three critical issues when embedding dynamic content in JSON:
 * 1. Backslashes must be escaped to avoid invalid JSON
 * 2. Double quotes must be escaped to avoid breaking JSON strings
 * 3. </script> substrings must be escaped to avoid breaking out of script tags
 *
 * @param {string} value - The string to make JSON-safe
 * @returns {string} - The JSON-safe string
 */
module.exports = (value) => {
  if (!value || typeof value !== 'string') return ''

  return value
    // Escape backslashes first (must be done before escaping quotes)
    .replace(/\\/g, '\\\\')
    // Escape double quotes
    .replace(/"/g, '\\"')
    // Escape </script> to prevent breaking out of script block
    .replace(/<\/script>/gi, '<\\/script>')
    // Escape other control characters that could break JSON
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}
