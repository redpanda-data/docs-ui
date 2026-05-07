'use strict'

// Usage: {{#if (is-eol releaseDate)}} ... {{/if}}
// Usage: {{#if (is-eol attributes)}} ... {{/if}} - checks page-is-past-eol, page-eol, or page-release-date
// Usage: {{#if (is-eol attributes 12)}} ... {{/if}} - with custom support months
// releaseDate should be a string in YYYY-MM-DD format
// Accepts either an attributes object or a date string
module.exports = (input, supportedMonths) => {
  // If input is an object, check for explicit EOL attributes from compute-end-of-life extension
  if (input && typeof input === 'object') {
    // First check page-is-past-eol set by the extension
    if (input['page-is-past-eol'] === true || input['page-is-past-eol'] === 'true') return true
    // Legacy support for page-eol attribute
    if (input['page-eol'] === true || input['page-eol'] === 'true') return true
    // Use support months from extension if available
    const extensionMonths = input['page-support-months']
    if (typeof extensionMonths === 'number' || (typeof extensionMonths === 'string' && !isNaN(parseInt(extensionMonths, 10)))) {
      supportedMonths = parseInt(extensionMonths, 10)
    }
    // Fallback to release date if available
    input = input['page-release-date']
  }
  if (!input) return false
  const release = new Date(input)
  if (isNaN(release.getTime())) return false
  const now = new Date()
  // Support duration - default to 12 months if not specified
  const months = typeof supportedMonths === 'number' ? supportedMonths : 12
  // Calculate EOL date (release + supported months)
  const eolDate = new Date(release)
  eolDate.setMonth(eolDate.getMonth() + months)
  return now >= eolDate
}
