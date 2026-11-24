'use strict'

// The version selector shows each version's status once, as the chip: the
// beta row used to read "v7.0 Beta Beta Beta" (display version, a text note,
// and the chip) and the latest row repeated Latest. Renders the real
// version-selector.hbs with the repo's helpers and counts the status label in
// the pill and in every row type: Latest, Supported, End of life soon, End of
// life, and Beta. Helpers that need a live Antora site are stubbed.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Handlebars = require('handlebars')

const ROOT = path.join(__dirname, '..', '..')
const hbs = Handlebars.create()
for (const name of ['and', 'eq', 'ne', 'not', 'gt', 'is-eol', 'format-release-date', 'support-end-date', 'version-label']) {
  hbs.registerHelper(name, require(path.join(ROOT, 'src/helpers', `${name}.js`)))
}
hbs.registerHelper('relativize', (url) => url)
hbs.registerHelper('resolve-resource', (ref) => ref)
hbs.registerHelper('get-header-data', () => ({ title: 'Streaming' }))
const render = hbs.compile(fs.readFileSync(path.join(ROOT, 'src/partials/version-selector.hbs'), 'utf8'))

const STATUSES = ['End of life soon', 'End of life', 'Supported', 'Latest', 'Beta']
const VERSIONS = [
  { version: '7.0', displayVersion: '7.0 Beta', prerelease: true, url: '#beta' },
  { version: '6.0', displayVersion: '6.0', url: '#latest' },
  { version: '5.2', displayVersion: '5.2', url: '#supported' },
  { version: '5.1', displayVersion: '5.1', url: '#soon', asciidoc: { attributes: { 'page-is-nearing-eol': 'true' } } },
  { version: '5.0', displayVersion: '5.0', url: '#eol', asciidoc: { attributes: { 'page-is-past-eol': 'true' } } },
]

const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

// How often each status label appears in a stretch of text. Longer labels are
// counted first and removed, so "End of life soon" is not also counted as
// "End of life".
function counts (str) {
  let rest = ` ${str} `
  const out = {}
  for (const label of STATUSES) {
    const re = new RegExp(`\\b${label}\\b`, 'g')
    out[label] = (rest.match(re) || []).length
    rest = rest.replace(re, ' ')
  }
  return out
}

function repeated (str) {
  return Object.entries(counts(str)).filter(([, n]) => n > 1).map(([label, n]) => `${label} x${n}`)
}

const page = (version) => {
  const current = VERSIONS.find((v) => v.version === version)
  return {
    version,
    versions: VERSIONS,
    componentVersion: current,
    component: { title: 'Streaming', latest: VERSIONS[1] },
    attributes: {},
  }
}

test('every panel row shows its status exactly once', () => {
  const html = render({ page: page('6.0') })
  const rows = html.match(/<a class="sm-ver-row[\s\S]*?<\/a>/g) || []
  assert.equal(rows.length, VERSIONS.length)
  const expected = { '#beta': 'Beta', '#latest': 'Latest', '#supported': 'Supported', '#soon': 'End of life soon', '#eol': 'End of life' }
  for (const row of rows) {
    const href = row.match(/href="([^"]*)"/)[1]
    const c = counts(text(row))
    assert.equal(c[expected[href]], 1, `${href} shows ${expected[href]} once: ${text(row)}`)
    assert.deepEqual(repeated(text(row)), [], `${href}: ${text(row)}`)
  }
})

test('the pill shows the current version and its status once, for every status', () => {
  const expected = { '7.0': 'Beta', '6.0': 'Latest', '5.2': 'Supported', 5.1: 'End of life soon', '5.0': 'End of life' }
  for (const [version, status] of Object.entries(expected)) {
    const html = render({ page: page(version) })
    const pill = text(html.match(/<button type="button" class="sm-ver-pill"[\s\S]*?<\/button>/)[0])
    assert.equal(counts(pill)[status], 1, `${version}: ${pill}`)
    assert.deepEqual(repeated(pill), [], `${version}: ${pill}`)
    assert.match(pill, new RegExp(`v${version.replace('.', '\\.')}\\b`))
  }
})

test('version-label drops a trailing status word and nothing else', () => {
  const label = require(path.join(ROOT, 'src/helpers/version-label.js'))
  assert.equal(label('7.0 Beta'), '7.0')
  assert.equal(label('26.1 (beta)'), '26.1')
  assert.equal(label('25.3'), '25.3')
  assert.equal(label('Beta'), 'Beta', 'a status word alone is left alone')
  assert.equal(label(undefined), '')
})

// Negative control: the check catches a repeated status
test('a row that repeats its status is caught', () => {
  assert.deepEqual(repeated('v7.0 Beta Beta Released Jan 1 Beta'), ['Beta x3'])
  assert.deepEqual(repeated('v6.0 Latest Latest'), ['Latest x2'])
  assert.deepEqual(repeated('v5.1 End of life soon'), [])
})
