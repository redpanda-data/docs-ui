'use strict'

// Meaning badges never use the native title attribute: it renders an
// unstyled browser tooltip, does not show on keyboard focus or tap, and is
// not what 12-activate-tooltips.js wires up. Badges carry data-tooltip.
// Scans every tag in src/partials and src/layouts, Handlebars included.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { ROOT, openingTags, isBadge, files } = require('./templates')

function offenders (src) {
  return openingTags(src).filter((tag) => isBadge(tag) && /[\s}]title\s*=/.test(tag))
}

const templates = () => files(['src/partials', 'src/layouts'], ['.hbs'])

test('no .rp-badge in a template uses a title attribute', () => {
  const found = []
  for (const file of templates()) {
    for (const tag of offenders(fs.readFileSync(file, 'utf8'))) found.push(`${path.relative(ROOT, file)}: ${tag}`)
  }
  assert.deepEqual(found, [])
})

// Negative controls: prove the scan can fail, and is not fooled by markup
test('the scan finds a title on a badge, including one behind Handlebars', () => {
  assert.equal(offenders('<span class="rp-badge rp-badge--beta" title="x">Beta</span>').length, 1)
  assert.equal(offenders('<a href="{{url}}" class="{{#if a}}x {{/if}}rp-badge rp-badge--cloud" title="{{t}}">Cloud</a>').length, 1)
  assert.equal(offenders('<span class="rp-badge" {{#if t}}title="{{t}}"{{/if}}>B</span>').length, 1)
})

test('the scan leaves data-tooltip badges and titles on other elements alone', () => {
  assert.equal(offenders('<span class="rp-badge rp-badge--beta" data-tooltip="x">Beta</span>').length, 0)
  assert.equal(offenders('<button class="copy" title="Copy">x</button>').length, 0)
  assert.equal(offenders('{{> some-partial}}<span class="rp-badge" data-title="x">B</span>').length, 0)
})
