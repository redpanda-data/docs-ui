'use strict'

/**
 * Decodes HTML entities to their actual characters.
 * Handles both named entities (e.g., &amp;) and numeric entities (e.g., &#8217;)
 *
 * @param {string} str - String with HTML entities
 * @returns {string} - Decoded string
 */
function decodeHtmlEntities (str) {
  // Named entities mapped to their Unicode code points
  const namedEntities = {
    '&amp;': '\u0026', // &
    '&lt;': '\u003C', // <
    '&gt;': '\u003E', // >
    '&quot;': '\u0022', // "
    '&apos;': '\u0027', // '
    '&#39;': '\u0027', // '
    '&nbsp;': '\u00A0', // non-breaking space
    '&ndash;': '\u2013', // en dash
    '&mdash;': '\u2014', // em dash
    '&lsquo;': '\u2018', // left single quote
    '&rsquo;': '\u2019', // right single quote
    '&ldquo;': '\u201C', // left double quote
    '&rdquo;': '\u201D', // right double quote
    '&hellip;': '\u2026', // ellipsis
    '&copy;': '\u00A9', // copyright
    '&reg;': '\u00AE', // registered
    '&trade;': '\u2122', // trademark
  }

  // Replace named entities
  let result = str.replace(/&[a-zA-Z]+;/g, (match) => namedEntities[match] || match)

  // Replace numeric entities (decimal: &#8217; and hex: &#x2019;)
  result = result.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))

  return result
}

/**
 * Escapes a string for safe inclusion in JSON-LD script blocks.
 *
 * This helper addresses several issues when embedding dynamic content in JSON:
 * 1. HTML entities are decoded to actual characters (e.g., &#8217; becomes right single quote)
 * 2. Backslashes must be escaped to avoid invalid JSON
 * 3. Double quotes must be escaped to avoid breaking JSON strings
 * 4. </script> substrings must be escaped to avoid breaking out of script tags
 *
 * @param {string} value - The string to make JSON-safe
 * @returns {string} - The JSON-safe string
 */
module.exports = (value) => {
  if (!value || typeof value !== 'string') return ''

  // First decode HTML entities to their actual characters
  const decoded = decodeHtmlEntities(value)

  return decoded
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
