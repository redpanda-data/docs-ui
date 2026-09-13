'use strict'

/**
 * Finds one step record in a solution's ordered `steps` array.
 *
 * Usage:
 *   {{#with (get-solution-step solution) as |step|}}          current step (page-solution-step)
 *   {{#with (get-solution-step solution 'create-topics')}}    a named step
 *
 * `solution` is the parsed `page-solution` record. Without an explicit id the
 * helper uses the `solution-step` page attribute that the solutions-catalog
 * extension sets on every step page. Returns null when there is no match so a
 * `{{#with}}` block renders nothing.
 */
module.exports = function (solution, stepId) {
  const options = arguments[arguments.length - 1]
  if (stepId === options) stepId = undefined
  const root = options && options.data && options.data.root
  const id = stepId || (root && root.page && root.page.attributes && root.page.attributes['solution-step'])
  if (!id || !solution || !Array.isArray(solution.steps)) return null
  return solution.steps.find((step) => step && step.id === id) || null
}
