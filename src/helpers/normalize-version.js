'use strict'

// Normalizes a hand-set version string for display: trims whitespace, drops a
// leading "v" (v4.43.0 -> 4.43.0) and any trailing periods, so a value of
// "4.43.0." doesn't print "4.43.0.." in a sentence. Returns '' for no value.
module.exports = (val) => {
  if (val == null || typeof val === 'object') return ''
  return String(val).trim().replace(/^v(?=\d)/i, '').replace(/\.+$/, '')
}
