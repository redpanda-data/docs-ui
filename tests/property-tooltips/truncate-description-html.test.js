'use strict'

// Verifies src/js/19-property-tooltips.js's truncateDescriptionHtml against
// the REAL implementation (extracted from the shipped source, not a
// reimplementation), run inside a real browser page so document.createElement
// behaves exactly as it does on the live site.
//
// The bug this guards: render-property-descriptions.js emits a single
// paragraph's description as bare inline HTML with no <p> wrapper -- by
// design, "what a tooltip wants". container.children only ever counts
// elements, never text nodes, so a single paragraph containing several
// inline elements (a <code> span, a link, another <code> span) has more than
// one "child" despite being one block of prose. The old implementation read
// that as multiple paragraphs and truncated to blocks[0], silently dropping
// every text node around it. Live examples this actually did in production:
// tombstone_retention_ms's tooltip showed only "cloud_storage_enabled" (the
// first of three <code> spans inside its one real paragraph), and
// kafka_max_message_size_upper_limit_bytes's tooltip showed only a bare link
// reading "max.message.bytes" (the first inline element, a link wrapping a
// <code>, inside its one real paragraph).

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const puppeteer = require('puppeteer')

const ROOT = path.join(__dirname, '..', '..')
const SRC = fs.readFileSync(path.join(ROOT, 'src/js/19-property-tooltips.js'), 'utf8')

// Extract just the BLOCK_TAGS constant and the function under test out of
// the IIFE -- the file as a whole assumes fetch/localStorage globals this
// test never exercises.
const BLOCK = SRC.slice(
  SRC.indexOf('var BLOCK_TAGS ='),
  SRC.indexOf('function createPropertyTooltip')
)

// Real production description_html, captured from docs.redpanda.com's
// topic-properties page (verified live, then fixed here).
const TOMBSTONE_RETENTION_MS =
  'The retention time for tombstone records in a compacted topic. For Tiered ' +
  'Storage v1, cannot be enabled at the same time as any of ' +
  '<code>cloud_storage_enabled</code>, <code>cloud_storage_enable_remote_read</code>, ' +
  'or <code>cloud_storage_enable_remote_write</code>. This restriction does not ' +
  'apply to topics that use <a href="/streaming/current/manage/tiered-storage/' +
  '#tiered-storage-versions" class="xref page">Tiered Storage v2</a>, available ' +
  'starting in Redpanda v26.2. A typical default setting is <code>86400000</code>, ' +
  'or 24 hours.'

const KAFKA_MAX_MESSAGE_SIZE_UPPER_LIMIT_BYTES =
  'The maximum value you can set for the <a href="/streaming/current/reference/' +
  'properties/topic-properties/#max-message-bytes" class="xref page">' +
  '<code>max.message.bytes</code></a> topic property. When set to <code>null</code>, ' +
  'no limit is enforced.'

let browser
let page

test.before(async () => {
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
  page = await browser.newPage()
  await page.evaluate(BLOCK + '\nwindow.__truncateDescriptionHtml = truncateDescriptionHtml;')
})

test.after(async () => {
  await browser.close()
})

async function truncate (html, summaryOnly) {
  return page.evaluate(
    (h, s) => window.__truncateDescriptionHtml(h, s),
    html,
    summaryOnly
  )
}

test('a single paragraph with several inline elements is not mangled', async () => {
  const result = await truncate(TOMBSTONE_RETENTION_MS, true)
  assert.equal(result, TOMBSTONE_RETENTION_MS)
  assert.match(result, /tombstone records/)
})

test('a single paragraph starting with a link is not mangled', async () => {
  const result = await truncate(KAFKA_MAX_MESSAGE_SIZE_UPPER_LIMIT_BYTES, true)
  assert.equal(result, KAFKA_MAX_MESSAGE_SIZE_UPPER_LIMIT_BYTES)
  assert.match(result, /maximum value/)
})

test('real multi-paragraph content still truncates to the first paragraph', async () => {
  const html = '<p>First real paragraph of prose.</p><p>Second paragraph that should not appear.</p>'
  const result = await truncate(html, true)
  assert.equal(result, '<p>First real paragraph of prose.</p><p>&#8230;</p>')
})

test('a list still truncates, since a list is real block structure', async () => {
  const html = '<p>Intro paragraph.</p><ul><li>one</li><li>two</li></ul>'
  const result = await truncate(html, true)
  assert.equal(result, '<p>Intro paragraph.</p><p>&#8230;</p>')
})

test('summaryOnly=false returns the html untouched regardless of structure', async () => {
  const result = await truncate(TOMBSTONE_RETENTION_MS, false)
  assert.equal(result, TOMBSTONE_RETENTION_MS)
})

test('empty html returns an empty string', async () => {
  assert.equal(await truncate('', true), '')
})
