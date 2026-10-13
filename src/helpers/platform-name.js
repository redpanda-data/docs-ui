'use strict'

// Reader-facing name of a page-solution-platforms value. Used everywhere a
// platform is shown (chips, the Runs on filter, cards) so the names agree.
const NAMES = { 'self-managed': 'Self-Managed', cloud: 'Cloud', kubernetes: 'Kubernetes' }

module.exports = (value) => NAMES[value] || String(value == null ? '' : value)
module.exports.NAMES = NAMES
