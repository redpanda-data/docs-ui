'use strict'

// Reader-facing name of a page-solution-platforms value. Used everywhere a
// platform is shown (chips, the Runs on filter, cards) so the names agree.
//
// The names come from the docs taxonomy: get-solutions-catalog builds
// `platformNames` from the catalog's `taxonomy` (every deployment concept by
// ID and altLabel) and each record's `concepts.platforms`, and templates pass
// it in:
//
//   {{platform-name this names=(lookup (get-solutions-catalog) 'platformNames')}}
//
// NAMES is the fallback for a catalog built before the taxonomy, which carries
// neither. What a reader runs, not how Redpanda is licensed: the self-managed
// value is the Docker Compose stack (Kubernetes is self-managed too).
const NAMES = { 'self-managed': 'Docker Compose', cloud: 'Redpanda Cloud', kubernetes: 'Kubernetes' }

module.exports = (value, options) => {
  const names = options && options.hash && options.hash.names
  const key = String(value == null ? '' : value)
  if (names && typeof names === 'object' && Object.prototype.hasOwnProperty.call(names, key)) return names[key]
  return NAMES[key] || key
}
module.exports.NAMES = NAMES
