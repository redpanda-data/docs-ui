'use strict'

// A list of platforms as a phrase: "Self-Managed", "Self-Managed and Cloud",
// "Self-Managed, Cloud, and Kubernetes". For "Last verified ... on <list>".
// The names are the ones platform-name.js uses (the UI loader evaluates each
// helper standalone, so they are repeated here rather than required).
const NAMES = { 'self-managed': 'Self-Managed', cloud: 'Cloud', kubernetes: 'Kubernetes' }

module.exports = (platforms) => {
  const names = (Array.isArray(platforms) ? platforms : []).map((p) => NAMES[p] || String(p)).filter(Boolean)
  if (names.length < 3) return names.join(' and ')
  return names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1]
}
