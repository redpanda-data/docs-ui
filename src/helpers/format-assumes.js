'use strict'

/**
 * Formats a solution's `assumes` list for display next to the difficulty.
 *
 * `assumes` is 1 to 4 short phrases saying what a reader should already know
 * ("topics", "consumer groups", "reading Go"), written by the solutions-catalog
 * extension onto the solution record and onto every page-related-solutions
 * entry. A bare difficulty word does not tell a reader what they need, so the
 * two are always rendered together.
 *
 * Usage:
 *   {{format-assumes solution.assumes}}              full list, comma separated
 *   {{format-assumes solution.assumes max=2}}        "topics, consumer groups… +2 more"
 *   {{format-assumes assumes max=2 maxChars=30}}     '' when it would not fit on one line
 *
 * `maxChars` is how the compact placements (the rail list and the footer
 * recommendation cards) skip the line rather than wrap it onto a second line;
 * the CSS also clips with an ellipsis, so an under-estimate cannot break the
 * layout. Returns '' when there is nothing to show, so callers can wrap the
 * call in {{#with}} and render nothing.
 */
module.exports = function (items) {
  const options = arguments[arguments.length - 1]
  const hash = (options && options.hash) || {}

  const source = Array.isArray(items) ? items : typeof items === 'string' ? items.split(',') : []
  const list = source.map((item) => String(item === null || item === undefined ? '' : item).trim()).filter(Boolean)
  if (!list.length) return ''

  const max = Number(hash.max)
  const text =
    isFinite(max) && max > 0 && list.length > max
      ? list.slice(0, max).join(', ') + '… +' + (list.length - max) + ' more'
      : list.join(', ')

  const maxChars = Number(hash.maxChars)
  if (isFinite(maxChars) && maxChars > 0 && text.length > maxChars) return ''
  return text
}
