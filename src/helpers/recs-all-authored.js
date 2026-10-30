'use strict'

/**
 * True when every recommendation that will render (the first `limit`, 3 by
 * default) was placed by a person: provenance 'authored' (or the older
 * 'explicit' and 'editor-approved'), not 'category', which the solutions
 * catalog infers from shared categories alone. Recommendations with no
 * provenance count as inferred, so the page never claims more than it knows.
 *
 * solution-recommendations.hbs uses it to choose between "solutions that use
 * what this page covers" (true of an authored link) and a softer "related
 * to" (all a category match supports).
 *
 * Usage: {{#if (recs-all-authored recs)}}...{{/if}}
 */
const AUTHORED = ['authored', 'explicit', 'editor-approved']

module.exports = function (recs) {
  const options = arguments[arguments.length - 1]
  const hash = (options && options.hash) || {}
  const limit = Number(hash.limit) > 0 ? Number(hash.limit) : 3
  if (!Array.isArray(recs) || !recs.length) return false
  return recs.slice(0, limit).every((rec) => rec && AUTHORED.indexOf(rec.provenance) !== -1)
}
