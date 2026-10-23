'use strict'

/**
 * The evidence behind a "Last verified" line, for that element's `title`, in
 * reader terms:
 *
 *   "34 commands run, 23 outputs checked, 2 screen captures, verify script
 *    passed 9 of 9"
 *
 * Reads the `verified` record that the solutions-catalog extension writes from
 * the actual Doc Detective run, never by hand:
 *
 *   { suite, specs, steps, commands, checks, media, verifyScript,
 *     redpandaVersion, runAt, platforms, contentRev, stackSha256, runs }
 *
 * `runs` holds the other platforms the same walkthrough also passed on, keyed
 * by platform: { kubernetes: { verifyScript, runAt, environment } }, where
 * environment is what the recorder read from the live cluster ({ kind,
 * kubernetes, redpanda_operator, cert_manager, redpanda }). Each run adds one
 * "; "-separated clause:
 *
 *   "Kubernetes: verify script passed 10 of 10 on October 13, 2026, kind
 *    v0.32.0, Kubernetes v1.35.0, Redpanda Operator v26.2.3"
 *
 * `specs` and `steps` are Doc Detective's own units, and "50 steps" beside a
 * solution's "Steps: 9" read as a contradiction, so they are not shown.
 * `verifyScript` is either a ready-made string ("PASS (9/9)") or an object
 * { status, passed, total }. A count CI did not report is left out; a count CI
 * reported as 0 is shown, because "0 commands run" is evidence about the run
 * and dropping it would overstate what was covered. Returns '' when there is
 * nothing to show, so the caller can omit the attribute entirely.
 *
 * Usage: {{format-verified-evidence solution.verified}}
 */
const COUNTS = [
  ['commands', 'command run', 'commands run'],
  ['checks', 'output checked', 'outputs checked'],
  ['media', 'screen capture', 'screen captures'],
]

const SCRIPT_RX = /^([A-Za-z]+)\s*\(\s*(\d+)\s*\/\s*(\d+)\s*\)$/
const VERBS = { pass: 'passed', passed: 'passed', fail: 'failed', failed: 'failed' }

function describeScript (status, passed, total) {
  const verb = VERBS[String(status).toLowerCase()]
  const counts = isFinite(passed) && isFinite(total) ? passed + ' of ' + total : ''
  if (verb) return 'verify script ' + verb + (counts ? ' ' + counts : '')
  return 'verify script ' + status + (counts ? ' (' + counts + ')' : '')
}

function formatScript (script) {
  if (!script) return ''
  if (typeof script === 'string') {
    const text = script.trim()
    if (!text) return ''
    const m = SCRIPT_RX.exec(text)
    return m ? describeScript(m[1], Number(m[2]), Number(m[3])) : describeScript(text)
  }
  if (typeof script !== 'object') return ''
  const status = String(script.status || script.result || '').trim()
  if (!status) return ''
  const passed = script.passed === undefined || script.passed === null ? NaN : Number(script.passed)
  const total = script.total === undefined || script.total === null ? NaN : Number(script.total)
  return describeScript(status, passed, total)
}

// Platform names come from the `names` hash argument, the catalog's
// `platformNames` built from the docs taxonomy (see platform-name.js). This map
// is the fallback for a catalog without one. Inlined rather than required: the
// UI loader registers each helper file on its own and cannot resolve siblings.
const PLATFORM_NAMES = { 'self-managed': 'Docker Compose', cloud: 'Redpanda Cloud', kubernetes: 'Kubernetes' }
const ENVIRONMENT = [
  ['kind', 'kind'],
  ['kubernetes', 'Kubernetes'],
  ['redpanda_operator', 'Redpanda Operator'],
]
const VERSION_RX = /^v?\d+(\.\d+)*([-+][\w.]+)?$/

function formatDate (value) {
  if (typeof value !== 'string') return ''
  const date = new Date(value)
  if (isNaN(date)) return ''
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' })
}

function formatRun (platform, run, nameOf) {
  if (!run || typeof run !== 'object') return ''
  const parts = []
  const script = formatScript(run.verifyScript)
  const date = formatDate(run.runAt)
  if (script) parts.push(script + (date ? ' on ' + date : ''))
  else if (date) parts.push('run on ' + date)
  const env = run.environment && typeof run.environment === 'object' ? run.environment : {}
  for (const [key, label] of ENVIRONMENT) {
    const version = env[key]
    if (typeof version === 'string' && VERSION_RX.test(version)) parts.push(label + ' ' + version)
  }
  if (!parts.length) return ''
  return nameOf(platform) + ': ' + parts.join(', ')
}

module.exports = function (verified, options) {
  if (!verified || typeof verified !== 'object') return ''
  const given = options && options.hash && options.hash.names
  const names = given && typeof given === 'object' ? given : {}
  const nameOf = (p) => (Object.prototype.hasOwnProperty.call(names, String(p)) ? names[String(p)] : PLATFORM_NAMES[p] || String(p))
  const parts = []
  for (const [key, one, many] of COUNTS) {
    const value = verified[key]
    if (value === null || value === undefined || value === '') continue
    const count = Number(value)
    if (!isFinite(count)) continue
    parts.push(count + ' ' + (count === 1 ? one : many))
  }
  const script = formatScript(verified.verifyScript)
  if (script) parts.push(script)
  // The content hash (contentRev) is maintainer evidence, read from
  // verification.json, and means nothing to a reader, so it is not shown.
  const runs = verified.runs && typeof verified.runs === 'object' ? verified.runs : {}
  const others = Object.keys(runs).sort().map((platform) => formatRun(platform, runs[platform], nameOf)).filter(Boolean)
  const clauses = []
  // Once another platform's clause follows, the base run needs its own name.
  if (parts.length) clauses.push((others.length ? nameOf('self-managed') + ': ' : '') + parts.join(', '))
  clauses.push(...others)
  return clauses.join('; ')
}
