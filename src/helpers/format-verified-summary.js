'use strict'
/**
 * The first sentence of a solution's Verified panel:
 *
 *   "Last verified November 9, 2026 with Redpanda v26.2.2 on Docker Compose
 *    and Kubernetes, and on Redpanda Cloud."
 *
 * The Redpanda version is the solution's pin, which is what ran on the
 * platforms the solution starts itself (Docker Compose, Kubernetes). Redpanda
 * Cloud runs the version Redpanda deploys there, so the version never applies
 * to it. With no platforms recorded, the sentence names the version only.
 *
 * Usage: {{format-verified-summary verifiedAt version platforms names=(lookup (get-solutions-catalog) 'platformNames')}}
 */
// Fallback names, repeated from platform-list.js because the UI loader
// evaluates each helper standalone.
const NAMES = { 'self-managed': 'Docker Compose', cloud: 'Redpanda Cloud', kubernetes: 'Kubernetes' }
const MANAGED = ['cloud']

function list (items) {
  if (items.length < 3) return items.join(' and ')
  return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1]
}

module.exports = function (verifiedAt, version, platforms, options) {
  if (typeof verifiedAt !== 'string' || !verifiedAt) return ''
  const given = options && options.hash && options.hash.names
  const names = given && typeof given === 'object' ? given : {}
  const nameOf = (p) => (Object.prototype.hasOwnProperty.call(names, String(p)) ? names[String(p)] : NAMES[p] || String(p))
  const all = Array.isArray(platforms) ? platforms : []
  const pinned = all.filter((p) => MANAGED.indexOf(p) === -1).map(nameOf).filter(Boolean)
  const managed = all.filter((p) => MANAGED.indexOf(p) !== -1).map(nameOf).filter(Boolean)
  const v = typeof version === 'string' && version.trim() ? version.trim() : ''
  let text = 'Last verified ' + verifiedAt
  if (pinned.length) text += (v ? ' with Redpanda ' + v : '') + ' on ' + list(pinned)
  else if (!managed.length && v) text += ' with Redpanda ' + v
  if (managed.length) text += (pinned.length ? ', and' : '') + ' on ' + list(managed)
  return text + '.'
}
