'use strict'

// Verifies the "Since X" version badge in src/partials/article.hbs, rendered
// with the REAL helpers this repo ships (and.js, not.js, normalize-version.js).
// The badge block is sliced out of the partial, so a change to the template is
// what gets tested, not a copy of it.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Handlebars = require('handlebars')

const ROOT = path.join(__dirname, '..', '..')
const hbs = Handlebars.create()
hbs.registerHelper('and', require(path.join(ROOT, 'src/helpers/and.js')))
hbs.registerHelper('not', require(path.join(ROOT, 'src/helpers/not.js')))
hbs.registerHelper('normalize-version', require(path.join(ROOT, 'src/helpers/normalize-version.js')))

const ARTICLE_SRC = fs.readFileSync(path.join(ROOT, 'src/partials/article.hbs'), 'utf8')
const FROM = '{{!-- Status badges:'
const TO = '{{!-- ADP platform badges'
const start = ARTICLE_SRC.indexOf(FROM)
const end = ARTICLE_SRC.indexOf(TO)
assert.ok(start >= 0 && end > start, `article.hbs changed under this test: could not find ${FROM} .. ${TO}`)
const BADGES = hbs.compile(ARTICLE_SRC.slice(start, end))

const render = (attributes) => BADGES({ page: { attributes } })
const sinceBadges = (html) => html.match(/status-badge--since/g) || []
const tooltip = (html) => (html.match(/status-badge--since" data-tippy-content="([^"]*)"/) || [])[1]
const visible = (html) => (html.match(/<span aria-hidden="true">([^<]*)<\/span>/) || [])[1]
const srText = (html) => (html.match(/<span class="status-badge__sr-text">([^<]*)<\/span>/) || [])[1]

test('renders the badge when the page sets introduced-in', () => {
  const html = render({ 'introduced-in': '4.43.0' })
  assert.equal(sinceBadges(html).length, 1)
  assert.equal(visible(html), 'Since 4.43.0')
  assert.equal(tooltip(html), 'Introduced in version 4.43.0.')
  assert.equal(srText(html), tooltip(html), 'screen reader text matches the tooltip')
})

test('renders nothing when introduced-in is absent or empty', () => {
  assert.equal(sinceBadges(render({})).length, 0)
  assert.equal(sinceBadges(render({ 'introduced-in': '' })).length, 0)
  const blank = render({ 'introduced-in': '  ' })
  assert.equal(sinceBadges(blank).length, 0, 'a value that normalizes to nothing renders nothing')
})

test('never renders on Cloud pages', () => {
  const html = render({ 'introduced-in': '4.43.0', cloud: 'true' })
  assert.equal(sinceBadges(html).length, 0)
})

test('names the product in the tooltip and screen reader text when introduced-in-product is set', () => {
  const html = render({ 'introduced-in': '4.43.0', 'introduced-in-product': 'Redpanda Connect' })
  assert.equal(visible(html), 'Since 4.43.0')
  assert.equal(tooltip(html), 'Introduced in Redpanda Connect 4.43.0.')
  assert.equal(srText(html), tooltip(html), 'screen reader text matches the tooltip')
})

test('normalizes a leading v and trailing periods', () => {
  for (const raw of ['v4.43.0', 'V4.43.0', '4.43.0.', ' v4.43.0.. ']) {
    const html = render({ 'introduced-in': raw })
    assert.equal(visible(html), 'Since 4.43.0', raw)
    assert.equal(tooltip(html), 'Introduced in version 4.43.0.', raw)
    assert.equal(srText(html), tooltip(html), raw)
  }
})

test('escapes attribute values', () => {
  const html = render({ 'introduced-in': '1.0"><script>', 'introduced-in-product': 'A"B' })
  assert.ok(!html.includes('<script>'))
  assert.ok(!html.includes('A"B'))
})

test('sits after Beta and Limited Availability when several badges show', () => {
  const html = render({ beta: 'true', 'limited-availability': 'true', 'introduced-in': '4.43.0' })
  const beta = html.indexOf('status-badge--beta')
  const la = html.indexOf('status-badge--la')
  const since = html.indexOf('status-badge--since')
  assert.ok(beta >= 0 && la > beta && since > la, 'order is Beta, Limited Availability, Since')
})
