/**
 * Asciidoctor emits <img> with no loading attribute and 15-optimize-images.js
 * only adds one after DOMContentLoaded, when every image is already queued.
 * The lazy-images helper does it in the HTML at build time, leaving the first
 * two images eager so an above-the-fold LCP image is never delayed.
 */
const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const fs = require('node:fs')

const ROOT = path.join(__dirname, '../..')
const helper = require(path.join(ROOT, 'src/helpers/lazy-images.js'))

test('images after the second get loading=lazy and decoding=async', () => {
  const html = '<p><img src="a.png" alt=""></p><img src="b.png"><div><img src="c.png" alt="c"></div><img class="x" src="d.png">'
  const out = helper(Buffer.from(html))
  assert.equal(out, '<p><img src="a.png" alt=""></p><img src="b.png"><div><img loading="lazy" decoding="async" src="c.png" alt="c"></div><img loading="lazy" decoding="async" class="x" src="d.png">')
})

test('explicit loading or fetchpriority attributes are respected, decoding is not duplicated', () => {
  const html = '<img src="1"><img src="2"><img loading="eager" src="3"><img fetchpriority="high" src="4"><img decoding="sync" src="5">'
  const out = helper(html)
  assert.match(out, /<img loading="eager" src="3">/)
  assert.match(out, /<img fetchpriority="high" src="4">/)
  assert.match(out, /<img loading="lazy" decoding="sync" src="5">/)
})

test('non-image markup and empty input pass through untouched', () => {
  assert.equal(helper('<p>no images</p>'), '<p>no images</p>')
  assert.equal(helper(null), '')
  assert.equal(helper(undefined), '')
})

test('the article body partials go through the helper', () => {
  for (const f of ['src/partials/index.hbs', 'src/partials/index-list.hbs']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
    assert.match(src, /\{\{\{lazy-images page\.contents\}\}\}/, f)
    assert.doesNotMatch(src, /\{\{\{page\.contents\}\}\}/, `${f} must not also emit the raw body`)
  }
  // The default article body is emitted through add-suggested-labs (and the
  // related-labs role through list-related-labs); both go through the helper.
  const article = fs.readFileSync(path.join(ROOT, 'src/partials/article.hbs'), 'utf8')
  assert.match(article, /\{\{\{lazy-images suggestedLabs\}\}\}/)
  assert.match(article, /\{\{\{lazy-images listLabs\}\}\}/)
  assert.doesNotMatch(article, /\{\{\{suggestedLabs\}\}\}|\{\{\{listLabs\}\}\}/)
})
