'use strict'

// JSON-valued page attributes (page-context-switcher, page-faqs,
// toc-tools-links, page-bloblang-samples, page-related-labs) used to go through
// an unguarded JSON.parse, so one malformed value threw and failed the whole
// site build. The helpers now log a warning naming the page and treat the
// value as empty.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const helpers = path.join(__dirname, '..', '..', 'src', 'helpers')
const obj = require(path.join(helpers, 'obj.js'))
const addSuggestedLabs = require(path.join(helpers, 'add-suggested-labs.js'))
const listRelatedLabs = require(path.join(helpers, 'list-related-labs.js'))

function context () {
  const warnings = []
  const root = {
    page: { src: { path: 'modules/ROOT/pages/broken.adoc' } },
    logger: { warn: (msg) => warnings.push(msg) },
    contentCatalog: {},
  }
  return { warnings, options: { data: { root } } }
}

test('obj parses valid JSON', () => {
  const { warnings, options } = context()
  assert.deepEqual(obj('[{"name":"Cloud","to":"current"}]', options), [{ name: 'Cloud', to: 'current' }])
  assert.deepEqual(warnings, [])
})

test('obj returns an empty object for an unset value', () => {
  assert.deepEqual(obj(undefined, context().options), {})
})

test('obj warns and returns an empty object for malformed JSON', () => {
  const { warnings, options } = context()
  assert.deepEqual(obj('[{"name": "Cloud", to: current}]', options), {})
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /modules\/ROOT\/pages\/broken\.adoc: ignoring malformed JSON attribute value/)
})

test('obj still warns when no logger is available', (t) => {
  const warn = t.mock.method(console, 'warn', () => {})
  assert.deepEqual(obj('- text: YAML', { data: { root: {} } }), {})
  assert.equal(warn.mock.callCount(), 1)
})

for (const [name, call] of [
  ['add-suggested-labs', (attrs, content, options) => addSuggestedLabs(attrs, content, options)],
  ['list-related-labs', (attrs, content, options) => listRelatedLabs('Title', attrs, content, options)],
]) {
  test(`${name} appends valid related labs`, () => {
    const { warnings, options } = context()
    const labs = JSON.stringify([{ title: 'A lab', url: '/labs/a/', description: 'Does A' }])
    const out = call({ 'related-labs': labs }, Buffer.from('<p>body</p>'), options).toString()
    assert.match(out, /<a href="\/labs\/a\/">A lab<\/a>/)
    assert.deepEqual(warnings, [])
  })

  test(`${name} warns and leaves the content alone for malformed JSON`, () => {
    const { warnings, options } = context()
    const content = Buffer.from('<p>body</p>')
    const out = call({ 'related-labs': '[{"title": "A lab",' }, content, options)
    assert.equal(out.toString(), '<p>body</p>')
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /broken\.adoc: ignoring malformed JSON in page-related-labs/)
  })
}
