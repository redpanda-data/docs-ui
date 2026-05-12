'use strict'

// Format a YYYY-MM-DD date string as "Mon YYYY" (e.g., "Mar 2026")
// Usage: {{format-release-date page-release-date}}
module.exports = (dateStr) => {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return ''
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[date.getMonth()]} ${date.getFullYear()}`
}
