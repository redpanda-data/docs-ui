'use strict'

/**
 * Check if a URL is external (starts with http:// or https://)
 *
 * @param {String} url - The URL to check
 * @returns {Boolean} - True if URL is external, false otherwise
 */
module.exports = (url) => {
  if (!url || typeof url !== 'string') return false
  return url.startsWith('http://') || url.startsWith('https://')
}
