'use strict'

// Calculate support end date (release date + supported months) and format as "Mon YYYY"
// Usage: {{support-end-date page-release-date}} - defaults to 12 months
// Usage: {{support-end-date page-release-date 12}} - explicit months
// Usage: {{support-end-date page-release-date page-support-months}} - from attribute
module.exports = (dateStr, supportedMonths) => {
  if (!dateStr) return ''
  const release = new Date(dateStr)
  if (isNaN(release.getTime())) return ''
  // Support duration - default to 12 months if not specified
  const months = typeof supportedMonths === 'number' ? supportedMonths : 12
  const endDate = new Date(release)
  endDate.setMonth(endDate.getMonth() + months)
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${monthNames[endDate.getMonth()]} ${endDate.getFullYear()}`
}
