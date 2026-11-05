'use strict'

// The docs theme styles every `.doc code` and `.doc pre` (border, padding,
// radius, background, a thin font weight). The explorer renders its config
// string in a <code> and its trees in a <pre>, so one reset in the explorer
// stylesheet has to win over those rules on specificity, not on load order.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

function rules (file) {
  const css = fs.readFileSync(path.join(__dirname, '../../src/css', file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  css.replace(/([^{}]+)\{([^{}]*)\}/g, (m, sel, body) => {
    const decls = {}
    body.split(';').forEach((d) => {
      const i = d.indexOf(':')
      if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim()
    })
    sel.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => out.push({ sel: s, decls }))
  })
  return out
}

// Specificity as [ids, classes+attributes+pseudo-classes, elements].
function specificity (sel) {
  const s = sel.replace(/::?[a-z-]+(\([^)]*\))?/g, (p) => (p.startsWith('::') ? ' e ' : ' c '))
  const ids = (s.match(/#[\w-]+/g) || []).length
  const classes = (s.match(/\.[\w-]+|\[[^\]]+\]/g) || []).length + (s.match(/ c /g) || []).length
  const elements = (s.replace(/\[[^\]]+\]|\.[\w-]+|#[\w-]+/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length
  return [ids, classes, elements]
}
function cmp (a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

const RESET = { border: '0', 'border-radius': '0', padding: '0', background: 'none', 'font-weight': '400' }
const explorer = rules('iceberg-explorer.css')

for (const el of ['code', 'pre']) {
  test(`one reset clears the docs theme styles on ${el}`, () => {
    const reset = explorer.find((r) => new RegExp(`\\b${el}$`).test(r.sel) &&
      Object.keys(RESET).every((k) => r.decls[k] === RESET[k]))
    assert.ok(reset, `no rule in iceberg-explorer.css resets ${Object.keys(RESET).join(', ')} on ${el}`)

    // Every doc.css rule that can match inside the widget and styles this
    // element with a reset property must lose to the explorer reset on
    // specificity. Rules scoped to other blocks (.listingblock, .colist) need
    // the widget to sit inside that block, so only `.doc [tag ...] el` counts.
    const theme = rules('doc.css').filter((r) => new RegExp(`^\\.doc(\\s+[a-z]+)*\\s+${el}$`).test(r.sel) &&
      Object.keys(RESET).some((k) => k in r.decls || (k === 'border' && 'border-radius' in r.decls)))
    assert.ok(theme.length > 0, `expected .doc ${el} rules in doc.css`)
    for (const t of theme) {
      assert.ok(cmp(specificity(reset.sel), specificity(t.sel)) > 0,
        `${reset.sel} ${specificity(reset.sel)} does not outrank ${t.sel} ${specificity(t.sel)}`)
    }
  })
}

test('specificity helper', () => {
  assert.deepStrictEqual(specificity('.doc p code'), [0, 1, 2])
  assert.deepStrictEqual(specificity('[data-iceberg-explorer] .ice-tree'), [0, 2, 0])
  assert.deepStrictEqual(specificity('[data-iceberg-explorer][data-iceberg-explorer] code'), [0, 2, 1])
})
