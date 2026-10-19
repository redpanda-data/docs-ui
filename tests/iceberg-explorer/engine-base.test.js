'use strict'

// The engine is loaded as a script from data-engine-base, which page source
// sets, so only same-origin root-relative paths are allowed. Mirrors the rule
// in the docs-extensions-and-macros iceberg-explorer macro.
const test = require('node:test')
const assert = require('node:assert')
const { isSafeEngineBase } = require('../../src/js/27-iceberg-explorer.js')

test('accepts root-relative paths', () => {
  for (const base of ['/_/engine/26.2', '/assets/iceberg/v1']) {
    assert.strictEqual(isSafeEngineBase(base), true, base)
  }
})

test('rejects anything that could load another origin', () => {
  for (const base of [
    'https://attacker.example',
    '//attacker.example/engine',
    '/\\attacker.example',
    'javascript:alert(1)',
    'engine/26.2',
    '/_/engine%0a/26.2',
    '/%5cattacker.example',
    '/_/en\tgine',
    '',
  ]) {
    assert.strictEqual(isSafeEngineBase(base), false, JSON.stringify(base))
  }
})
