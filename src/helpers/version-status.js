'use strict'

// Returns the status of a version: 'current', 'supported', or 'eol'
// Usage: {{version-status ver.asciidoc.attributes currentVersion}}
module.exports = (attributes, currentVersion, thisVersion) => {
  // Check if explicitly marked as EOL or if release date indicates EOL
  if (attributes && attributes['page-eol'] === true) return 'eol'
  if (attributes && attributes['page-release-date']) {
    const release = new Date(attributes['page-release-date'])
    if (!isNaN(release.getTime())) {
      const now = new Date()
      const msInYear = 365 * 24 * 60 * 60 * 1000
      if ((now - release) >= msInYear) return 'eol'
    }
  }
  // If this is the current/latest version
  if (currentVersion === thisVersion) return 'current'
  // Otherwise it's supported
  return 'supported'
}
