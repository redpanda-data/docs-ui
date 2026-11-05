'use strict'

// The explorer sits in a content column whose width depends on the nav and
// TOC, not on the viewport. Its grid must size from the mount and must be able
// to shrink below the min-content width of the white-space: pre trees, or the
// right column (with Copy) is pushed past the edge where nobody can reach it.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const raw = fs.readFileSync(path.join(__dirname, '../../src/css/iceberg-explorer.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')

function decls (selector, css = raw) {
  const out = {}
  css.replace(/([^{}]+)\{([^{}]*)\}/g, (m, sel, body) => {
    if (!sel.split(',').map((s) => s.trim()).includes(selector)) return
    body.split(';').forEach((d) => {
      const i = d.indexOf(':')
      if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim()
    })
  })
  return out
}
const R = (s) => '[data-iceberg-explorer] ' + s

test('the mount is the size container and no rule depends on the viewport', () => {
  assert.strictEqual(decls('[data-iceberg-explorer]')['container-type'], 'inline-size')
  assert.ok(!/@media[^{]*width/.test(raw), 'viewport width media query in iceberg-explorer.css')
  assert.ok(/@container[^{]*max-width/.test(raw), 'expected a container query for the stacked layout')
})

test('every grid track can shrink to zero', () => {
  const tracks = []
  raw.replace(/grid-template-columns:\s*([^;}]+)/g, (m, v) => tracks.push(v.trim()))
  assert.ok(tracks.length >= 2)
  for (const t of tracks) {
    const cols = t.split(/\s+(?![^(]*\))/)
    for (const c of cols) {
      assert.ok(/^minmax\(0,/.test(c) || c === 'max-content', `track "${c}" in "${t}" cannot shrink below its content`)
    }
  }
})

test('columns and cards allow their content to shrink', () => {
  for (const s of ['.ice-left', '.ice-right', '.ice-card', '.ice-configbar']) {
    assert.strictEqual(decls(R(s))['min-width'], '0', s)
    assert.ok(!('margin-bottom' in decls(R(s))), `${s} still spaces itself with margin-bottom; use the column gap`)
  }
  assert.strictEqual(decls(R('.ice-left')).gap, decls(R('.ice-right')).gap)
  assert.strictEqual(decls(R('.ice-confighead'))['flex-wrap'], 'wrap')
})

test('option labels are monospace, like the keys in the config string', () => {
  assert.match(decls(R('.ice-textrow label'))['font-family'], /--monospace-font-family/)
})
