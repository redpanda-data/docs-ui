'use strict'

// A list of platforms as a phrase: "Docker Compose", "Docker Compose and Kubernetes",
// "Docker Compose, Kubernetes, and Redpanda Cloud". For "Last verified ... on <list>".
// The names are the ones platform-name.js uses (the UI loader evaluates each
// helper standalone, so they are repeated here rather than required).
// What a reader runs, not how Redpanda is licensed: the self-managed value is the
// Docker Compose stack (Kubernetes is self-managed too), so it is named for that.
const NAMES = { 'self-managed': 'Docker Compose', cloud: 'Redpanda Cloud', kubernetes: 'Kubernetes' }

module.exports = (platforms) => {
  const names = (Array.isArray(platforms) ? platforms : []).map((p) => NAMES[p] || String(p)).filter(Boolean)
  if (names.length < 3) return names.join(' and ')
  return names.slice(0, -1).join(', ') + ', and ' + names[names.length - 1]
}
