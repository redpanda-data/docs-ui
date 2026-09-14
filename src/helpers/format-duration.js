'use strict'

/**
 * Formats a duration in minutes for display: 45 -> "45 min", 60 -> "1 hr",
 * 75 -> "1 hr 15 min". Returns '' for missing or unusable input so templates
 * can wrap the call in {{#if}}.
 *
 * Usage: {{format-duration solution.duration}}
 */
module.exports = (minutes) => {
  const value = Number(minutes)
  if (!isFinite(value) || value <= 0) return ''
  const total = Math.round(value)
  if (total < 60) return total + ' min'
  const hours = Math.floor(total / 60)
  const rest = total % 60
  return rest ? hours + ' hr ' + rest + ' min' : hours + ' hr'
}
