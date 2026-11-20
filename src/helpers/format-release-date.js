'use strict'

// Format a date as "Mon YYYY" (e.g., "Mar 2026"), or as a long human date
// (e.g., "March 14, 2026") when called with long=true. A full ISO timestamp is
// accepted as well as YYYY-MM-DD, so a CI-written verification time formats
// the same way as a release date.
// Usage: {{format-release-date page-release-date}}
//        {{format-release-date solution.verified.runAt long=true}}
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LONG_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

module.exports = function (dateStr, options) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return ''
  // UTC getters keep the rendered date the same whatever the build machine's
  // timezone, and stop a timestamp near midnight landing on the wrong day.
  const year = date.getUTCFullYear()
  if (!(options && options.hash && options.hash.long)) return `${SHORT_MONTHS[date.getUTCMonth()]} ${year}`
  return `${LONG_MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${year}`
}
