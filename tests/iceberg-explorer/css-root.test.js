'use strict'

// The explorer styles must target the element the JS hydrates. The macro emits
// `class="iceberg-explorer-mount" data-iceberg-explorer`, never the retired
// `.iceberg-explorer` class, so rules rooted there style nothing.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { MOUNT_SELECTOR } = require('../../src/js/27-iceberg-explorer.js')

const css = fs.readFileSync(path.join(__dirname, '../../src/css/iceberg-explorer.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  // Drop at-rule preludes (`@media (...) {`) so only selectors remain.
  .replace(/@[^{;]+\{/g, '')

test('every rule is rooted at the mount selector', () => {
  const selectors = []
  css.replace(/([^{}@]+)\{/g, (m, sel) => { selectors.push(...sel.split(',').map((s) => s.trim())) })
  const rules = selectors.filter((s) => s && !/^(\d|from|to)\b/.test(s))
  assert.ok(rules.length > 10, 'expected explorer rules in the stylesheet')
  for (const sel of rules) {
    assert.ok(sel.includes(MOUNT_SELECTOR), `selector not rooted at ${MOUNT_SELECTOR}: ${sel}`)
  }
  assert.ok(!/\.iceberg-explorer(?![-\w])/.test(css), 'stylesheet still targets the retired .iceberg-explorer class')
})
