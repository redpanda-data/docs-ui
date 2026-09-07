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
const EXTRACT_START = SRC.indexOf('var BLOCK_TAGS =')
const EXTRACT_END = SRC.indexOf('function createPropertyTooltip')
assert.ok(
  EXTRACT_START !== -1 && EXTRACT_END !== -1 && EXTRACT_START < EXTRACT_END,
  'source-extraction anchors went stale: expected "var BLOCK_TAGS =" followed by ' +
    '"function createPropertyTooltip" in src/js/19-property-tooltips.js'
)
const BLOCK = SRC.slice(EXTRACT_START, EXTRACT_END)

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
  // A launch failure in before() must surface itself, not a close() TypeError
  if (browser) await browser.close()
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
})

test('a single paragraph starting with a link is not mangled', async () => {
  const result = await truncate(KAFKA_MAX_MESSAGE_SIZE_UPPER_LIMIT_BYTES, true)
  assert.equal(result, KAFKA_MAX_MESSAGE_SIZE_UPPER_LIMIT_BYTES)
})

test('real multi-paragraph content still truncates to the first paragraph', async () => {
  const html = '<p>First real paragraph of prose.</p><p>Second paragraph that should not appear.</p>'
  const result = await truncate(html, true)
  // Ellipsis merges into the closing </p>, matching formatDescription's preview shape
  assert.equal(result, '<p>First real paragraph of prose.&#8230;</p>')
})

test('a list still truncates, since a list is real block structure', async () => {
  // The <ul> leads so this test actually depends on UL being in BLOCK_TAGS
  const html = '<ul><li>one</li><li>two</li></ul><p>Trailing paragraph.</p>'
  const result = await truncate(html, true)
  assert.equal(result, '<ul><li>one</li><li>two</li></ul><p>&#8230;</p>')
})

test('div.paragraph-wrapped multi-paragraph content truncates', async () => {
  // The shape real Asciidoctor conversion emits for multi-paragraph
  // descriptions - the case that depends on DIV being in BLOCK_TAGS
  const html = '<div class="paragraph"><p>First.</p></div><div class="paragraph"><p>Second.</p></div>'
  const result = await truncate(html, true)
  assert.equal(result, '<div class="paragraph"><p>First.</p></div><p>&#8230;</p>')
})

test('mixed inline prose and a block sibling is not truncated to the inline element', async () => {
  // hasBlockStructure via the <div>, but blocks[0] would be the <code> --
  // truncating here reproduces the original mangling with extra steps
  const html = 'See <code>x</code> for details. <div class="admonitionblock">Warning body.</div>'
  const result = await truncate(html, true)
  assert.equal(result, html)
})

test('top-level prose before real blocks is not dropped', async () => {
  const html = 'Bare intro sentence. <p>First paragraph.</p><p>Second paragraph.</p>'
  const result = await truncate(html, true)
  assert.equal(result, html)
})

test('a discrete heading counts as block structure and truncates', async () => {
  // [discrete]\n== X renders as a bare <h2> outside any <div> wrapper
  const html = '<h2>Heading</h2><p>Body paragraph.</p>'
  const result = await truncate(html, true)
  assert.equal(result, '<h2>Heading</h2><p>&#8230;</p>')
})

test('a thematic break counts as block structure and truncates', async () => {
  const html = "<p>Before the break.</p><hr><p>After the break.</p>"
  const result = await truncate(html, true)
  assert.equal(result, '<p>Before the break.&#8230;</p>')
})

test('passthrough markup with unknown tags renders in full instead of guessing', async () => {
  // ++++ passthrough can emit anything; unknown top-level tags must not be
  // truncated away, the CSS max-height cap bounds the tooltip instead
  const html = '<details><summary>More</summary>Hidden body.</details><p>Paragraph.</p>'
  const result = await truncate(html, true)
  assert.equal(result, html)
})

test('whitespace and comments between blocks do not block truncation', async () => {
  const html = '<p>First.</p>\n  <!-- generator note -->\n<p>Second.</p>'
  const result = await truncate(html, true)
  assert.equal(result, '<p>First.&#8230;</p>')
})

test('summaryOnly=false returns the html untouched regardless of structure', async () => {
  const result = await truncate(TOMBSTONE_RETENTION_MS, false)
  assert.equal(result, TOMBSTONE_RETENTION_MS)
})

test('empty html returns an empty string', async () => {
  assert.equal(await truncate('', true), '')
})
