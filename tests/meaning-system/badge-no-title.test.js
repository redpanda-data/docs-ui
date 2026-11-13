'use strict'

// Meaning badges never use the native title attribute: it renders an
// unstyled browser tooltip, does not show on keyboard focus or tap, and is
// not what 12-activate-tooltips.js wires up. Badges carry data-tooltip.
// Scans every tag in src/partials and src/layouts, Handlebars included.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const DIRS = ['src/partials', 'src/layouts']

// Opening tags in a template, skipping over {{...}} and quoted values so a
// Handlebars expression or an attribute value cannot end a tag early.
function openingTags (src) {
  const tags = []
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '<' || !/[a-zA-Z]/.test(src[i + 1] || '')) continue
    let j = i + 1
    let quote = null
    while (j < src.length) {
      if (src.startsWith('{{', j)) { const end = src.indexOf('}}', j); j = end < 0 ? src.length : end + 2; continue }
      const c = src[j]
      if (quote) { if (c === quote) quote = null } else if (c === '"' || c === "'") quote = c
      else if (c === '>') break
      j++
    }
    tags.push(src.slice(i, j + 1))
    i = j
  }
  return tags
}

function offenders (src) {
  return openingTags(src).filter((tag) => /\bclass\s*=\s*["'][^"']*\brp-badge\b/.test(tag) && /[\s}]title\s*=/.test(tag))
}

function templates () {
  const out = []
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (ent.name.endsWith('.hbs')) out.push(p)
    }
  }
  DIRS.forEach((d) => walk(path.join(ROOT, d)))
  return out
}

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
