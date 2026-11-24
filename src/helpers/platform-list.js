'use strict'

// A list of platforms as a phrase: "Docker Compose", "Docker Compose and Kubernetes",
// "Docker Compose, Kubernetes, and Redpanda Cloud". For "Last verified ... on <list>".
// Names come from the `names` hash argument, the catalog's `platformNames`
// (see platform-name.js):
//
//   {{platform-list platforms names=(lookup (get-solutions-catalog) 'platformNames')}}
//
// NAMES is the fallback for a catalog without a taxonomy. It repeats
// platform-name.js because the UI loader evaluates each helper standalone.
const NAMES = { 'self-managed': 'Docker Compose', cloud: 'Redpanda Cloud', kubernetes: 'Kubernetes' }

module.exports = (platforms, options) => {
  const given = options && options.hash && options.hash.names
  const names = given && typeof given === 'object' ? given : {}
  const nameOf = (p) => (Object.prototype.hasOwnProperty.call(names, String(p)) ? names[String(p)] : NAMES[p] || String(p))
  const list = (Array.isArray(platforms) ? platforms : []).map(nameOf).filter(Boolean)
  if (list.length < 3) return list.join(' and ')
  return list.slice(0, -1).join(', ') + ', and ' + list[list.length - 1]
}
