'use strict'

/**
 * The evidence behind a "Last verified" line, for that element's `title`:
 *
 *   "11 specs, 50 steps, 34 commands, 23 output checks, 2 media captures,
 *    verify script PASS (9/9)"
 *
 * Reads the `verified` record that the solutions-catalog extension writes from
 * the actual Doc Detective run, never by hand:
 *
 *   { suite, specs, steps, commands, checks, media, verifyScript,
 *     redpandaVersion, runAt }
 *
 * `verifyScript` is either a ready-made string ("PASS (9/9)") or an object
 * { status, passed, total }. A count CI did not report is left out; a count CI
 * reported as 0 is shown, because "0 commands" is evidence about the run and
 * dropping it would overstate what was covered. Returns '' when there is
 * nothing to show, so the caller can omit the attribute entirely.
 *
 * Usage: {{format-verified-evidence solution.verified}}
 */
const COUNTS = [
  ['specs', 'spec', 'specs'],
  ['steps', 'step', 'steps'],
  ['commands', 'command', 'commands'],
  ['checks', 'output check', 'output checks'],
  ['media', 'media capture', 'media captures'],
]

function formatScript (script) {
  if (!script) return ''
  if (typeof script === 'string') return script.trim()
  if (typeof script !== 'object') return ''
  const status = String(script.status || script.result || '').trim()
  if (!status) return ''
  const passed = Number(script.passed)
  const total = Number(script.total)
  return isFinite(passed) && isFinite(total) ? `${status} (${passed}/${total})` : status
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
  if (script) parts.push('verify script ' + script)
  return parts.join(', ')
}
