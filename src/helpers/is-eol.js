'use strict'

// Usage: {{#if (is-eol releaseDate)}} ... {{/if}}
// releaseDate should be a string in YYYY-MM-DD format
// Accepts either an attributes object or a date string
module.exports = (input) => {
  // If input is an object, check for explicit page-eol attribute
  if (input && typeof input === 'object') {
    if (input['page-eol'] === true || input['page-eol'] === 'true') return true
    // Fallback to release date if available
    input = input['page-release-date']
  }
  if (!input) return false
  const release = new Date(input)
  if (isNaN(release.getTime())) return false
  const now = new Date()
  // EOL if one year (365 days) or more has passed
  const msInYear = 365 * 24 * 60 * 60 * 1000
  return (now - release) >= msInYear
}
