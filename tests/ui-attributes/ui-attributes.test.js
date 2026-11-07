'use strict'

// Checks src/ui-attributes.json against the attributes the templates,
// helpers, and scripts actually read. The manifest ships in the UI bundle and
// as a release asset so the docs language server can offer completion, hover,
// and diagnostics for UI attributes without copying template logic.
//
// Fails when:
//   - a template or helper reads an attribute the manifest does not declare
//   - the manifest declares an attribute nothing reads
//   - an entry's readBy list is out of date
//   - the scanner meets a read it cannot classify

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { scan, compare } = require('./scan-attribute-reads')

const MANIFEST_PATH = path.join(__dirname, '..', '..', 'src', 'ui-attributes.json')
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))

const SCOPES = ['page', 'component', 'site']
const SETTERS = ['writer', 'extension', 'antora']

test('every entry is well formed', () => {
  const problems = []
  for (const [key, entry] of Object.entries(manifest.attributes)) {
    if (!manifest.types[entry.type]) problems.push(`${key}: unknown type ${entry.type}`)
    if (!entry.description) problems.push(`${key}: no description`)
    const setIn = Array.isArray(entry.setIn) ? entry.setIn : []
    if (!setIn.length || setIn.some((s) => !SCOPES.includes(s))) problems.push(`${key}: setIn must list ${SCOPES}`)
    if (!SETTERS.includes(entry.setBy)) problems.push(`${key}: setBy must be one of ${SETTERS}`)
    if (entry.type === 'enum' && !(Array.isArray(entry.values) && entry.values.length)) {
      problems.push(`${key}: enum needs values`)
    }
    if (key.includes('{n}') !== Array.isArray(entry.range)) {
      problems.push(`${key}: range goes with {n} keys and only those`)
    }
  }
  assert.deepEqual(problems, [])
})

test('the scanner classifies every attribute read', () => {
  assert.deepEqual(scan().unclassified, [])
})

test('every attribute the UI reads is declared, and every declared attribute is read', () => {
  const result = compare(manifest, scan())
  assert.deepEqual(result.undeclared, [], 'Read by the UI but missing from src/ui-attributes.json')
  assert.deepEqual(result.unread, [], 'Declared in src/ui-attributes.json but nothing reads it')
  assert.deepEqual(result.readByMismatch, [], 'readBy is out of date')
})

// Negative controls: prove the checks above can fail.
function fakeSrc (files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-attributes-'))
  for (const sub of ['layouts', 'partials', 'helpers', 'js']) fs.mkdirSync(path.join(dir, sub))
  for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), text)
  return dir
}
const tiny = {
  types: manifest.types,
  attributes: {
    'page-beta': { setIn: ['page'], setBy: 'writer', type: 'flag', description: 'x', readBy: ['src/partials/a.hbs'] },
    'page-popular-{n}-title': {
      setIn: ['page'], setBy: 'writer', type: 'string', range: [1, 2], description: 'x', readBy: ['src/partials/a.hbs'],
    },
  },
}

test('negative control: an undeclared read fails', () => {
  const dir = fakeSrc({
    'partials/a.hbs':
      '{{page.attributes.beta}} {{page.attributes.popular-1-title}} {{page.attributes.popular-2-title}}' +
      ' {{page.attributes.brand-new}}',
  })
  const result = compare(tiny, scan(dir))
  assert.deepEqual(result.undeclared, ['page-brand-new'])
  assert.deepEqual(result.unread, [])
})

test('negative control: a declared attribute nothing reads fails', () => {
  const dir = fakeSrc({ 'partials/a.hbs': '{{page.attributes.popular-1-title}}' })
  const result = compare(tiny, scan(dir))
  assert.deepEqual(result.unread, ['page-beta', 'page-popular-{n}-title (nothing reads page-popular-2-title)'])
})

test('negative control: a stale readBy fails', () => {
  const dir = fakeSrc({
    'partials/a.hbs': '{{page.attributes.popular-1-title}} {{page.attributes.popular-2-title}}',
    'helpers/b.js': "module.exports = (page) => page.attributes['beta']\n",
  })
  const result = compare(tiny, scan(dir))
  assert.deepEqual(result.readByMismatch, ['page-beta: readBy should be ["src/helpers/b.js"]'])
})

test('negative control: an attributes object passed to an unknown helper is flagged', () => {
  const dir = fakeSrc({ 'partials/a.hbs': '{{#with (mystery page.attributes)}}{{/with}}' })
  assert.equal(scan(dir).unclassified.length, 1)
})

test('negative control: a computed key in an indirect helper is flagged', () => {
  // add-suggested-labs.js is listed in INDIRECT, so a computed key there is caught.
  const dir = fakeSrc({ 'helpers/add-suggested-labs.js': 'module.exports = (attributes, k) => attributes[k]\n' })
  assert.match(scan(dir).unclassified.join('\n'), /computed attribute key/)
})
