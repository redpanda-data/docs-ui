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
 *     redpandaVersion, runAt }
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

module.exports = function (verified) {
  if (!verified || typeof verified !== 'object') return ''
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
  return parts.join(', ')
}
