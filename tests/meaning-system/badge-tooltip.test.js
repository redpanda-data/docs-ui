'use strict'

// Every meaning badge has a tooltip: the badge text carries the meaning, and
// the tooltip says what it means (12-activate-tooltips.js shows it on hover,
// focus, and tap). Fails when an .rp-badge in src/partials, src/layouts, or a
// preview page has no non-empty data-tooltip.
//
// One exception: a badge that is itself inside a tooltip (the property
// tooltip's Cluster or Enterprise badges) cannot have a tooltip of its own.
// Its container carries data-in-tooltip, and badges under it are skipped.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, withAncestors, isBadge, files } = require('./templates')

const hasTooltip = (tag) => /\sdata-tooltip\s*=\s*"(?=[^"]*[^\s"])[^"]*"/.test(tag)
const inTooltip = (ancestors) => ancestors.some((a) => /\sdata-in-tooltip\b/.test(a))

function missing (src) {
  return withAncestors(src)
    .filter(({ tag, ancestors }) => isBadge(tag) && !inTooltip(ancestors) && !hasTooltip(tag))
    .map(({ tag }) => tag)
}

test('every .rp-badge in the templates and preview pages has a tooltip', () => {
  const found = []
  const sources = files(['src/partials', 'src/layouts'], ['.hbs']).concat(files(['preview-src'], ['.adoc']))
  for (const file of sources) {
    for (const tag of missing(fs.readFileSync(file, 'utf8'))) found.push(`${path.relative(ROOT, file)}: ${tag}`)
  }
  assert.deepEqual(found, [])
})

// Negative controls: prove the check can fail, and that the exception is narrow
test('a badge with no tooltip, or an empty one, is flagged', () => {
  assert.equal(missing('<span class="rp-badge rp-badge--new">New</span>').length, 1)
  assert.equal(missing('<span class="rp-badge rp-badge--new" data-tooltip="">New</span>').length, 1)
  assert.equal(missing('<span class="rp-badge rp-badge--new" data-tooltip="  ">New</span>').length, 1)
  assert.equal(missing('<a href="{{url}}" class="rp-badge rp-badge--cloud">Cloud</a>').length, 1)
})

test('a badge with a tooltip passes, including one from Handlebars', () => {
  assert.equal(missing('<span class="rp-badge rp-badge--new" data-tooltip="New in this release.">New</span>').length, 0)
  assert.equal(missing('<span class="rp-badge rp-badge--beta" data-tooltip="{{#if t}}{{t}}{{else}}Beta.{{/if}}">Beta</span>').length, 0)
})

test('only badges inside a data-in-tooltip container are exempt', () => {
  const inside = '<div class="prop-tooltip-badges" data-in-tooltip><span class="rp-badge rp-badge--enterprise">Enterprise</span></div>'
  assert.equal(missing(inside).length, 0)
  const after = '<div data-in-tooltip><span>x</span></div><span class="rp-badge rp-badge--enterprise">Enterprise</span>'
  assert.equal(missing(after).length, 1, 'a badge after the container closes is not exempt')
})
