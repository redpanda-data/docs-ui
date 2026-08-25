'use strict'

// Verifies src/js/19-property-tooltips.js's parsePreservingBigInts against
// the REAL implementation (extracted from the shipped source, not a
// reimplementation) -- not just the happy path it was written for.
//
// The bug this guards: UNSAFE_INT_RX shields a 16+ digit run so it survives
// JSON.parse as a string instead of losing precision, but it can't tell a
// structural number token (after a real ':', '[' or ',') from the same shape
// appearing inside a string value's own text -- e.g. a property description
// that quotes the uint64 max as an accepted range. When that happens the
// regex "shields" text that is already inside a JSON string, injecting
// unescaped quotes and corrupting the JSON, so JSON.parse throws and the
// entire properties dataset -- every tooltip on the site -- fails to load.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')

const ROOT = path.join(__dirname, '..', '..')
const SRC = fs.readFileSync(path.join(ROOT, 'src/js/19-property-tooltips.js'), 'utf8')

// Extract just the two constants and the function under test out of the
// IIFE -- the file as a whole assumes `document`/`fetch`/`localStorage`
// globals it never gets in this test, and this function has none of those
// dependencies.
const BLOCK = SRC.slice(
  SRC.indexOf('var UNSAFE_INT_RX ='),
  SRC.indexOf('function escapeHtml')
)
const parsePreservingBigInts = new Function(BLOCK + '\nreturn parsePreservingBigInts;')() // eslint-disable-line no-new-func

test('preserves a 64-bit integer that is a real JSON number token', () => {
  const result = parsePreservingBigInts('{"max_size":18446744073709551615}')
  assert.equal(result.max_size, '18446744073709551615')
})

test('leaves small, safe integers as numbers', () => {
  const result = parsePreservingBigInts('{"count":42}')
  assert.equal(result.count, 42)
})

test('does not throw when a description quotes a 64-bit value as prose (range form)', () => {
  const text = '{"desc":"Accepted range: [0, 18446744073709551615]."}'
  const result = parsePreservingBigInts(text)
  assert.equal(result.desc, 'Accepted range: [0, 18446744073709551615].')
})

test('does not throw when a description quotes a 64-bit value as prose (default form)', () => {
  const text = '{"desc":"Default: 18446744073709551615, which disables the limit."}'
  const result = parsePreservingBigInts(text)
  assert.equal(result.desc, 'Default: 18446744073709551615, which disables the limit.')
})

test('a bad in-string digit run degrades to a rounded number rather than losing every value', () => {
  // Same payload as the live failure mode: one property's description trips
  // the shielding regex, but every OTHER property must still parse.
  const text = '{"a":{"desc":"Default: 18446744073709551615, which disables the limit."},"b":{"max_size":18446744073709551615}}'
  const result = parsePreservingBigInts(text)
  assert.equal(result.a.desc, 'Default: 18446744073709551615, which disables the limit.')
  // The fallback plain JSON.parse can't preserve precision on the real
  // number token either once it's degraded -- that's the accepted
  // trade-off (rounded number instead of no tooltips at all).
  assert.equal(typeof result.b.max_size, 'number')
})
