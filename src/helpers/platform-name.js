'use strict'

// Reader-facing name of a page-solution-platforms value. Used everywhere a
// platform is shown (chips, the Runs on filter, cards) so the names agree.
// What a reader runs, not how Redpanda is licensed: the self-managed value is the
// Docker Compose stack (Kubernetes is self-managed too), so it is named for that.
const NAMES = { 'self-managed': 'Docker Compose', cloud: 'Redpanda Cloud', kubernetes: 'Kubernetes' }

module.exports = (value) => NAMES[value] || String(value == null ? '' : value)
module.exports.NAMES = NAMES
