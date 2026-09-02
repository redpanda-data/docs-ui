'use strict'

// Guards the "Docs for vX" pill in src/partials/version-selector.hbs, rendered from the
// real partial with the real helpers.
//
// Unlike the sidebar picker, this one always deep-linked correctly: it iterates Antora's
// page.versions, whose url is already the equivalent page in each version. What the 2024
// redesign dropped when it deleted page-versions.hbs was the missing:true handling. Antora
// falls back to the target version's start page for a page that does not exist there, so
// without a marker a fallback is indistinguishable from a hit and the reader is moved
// somewhere else with no explanation. The pre-redesign markup styled .is-missing and
// carried a "Page not available in this version" tooltip.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Handlebars = require('handlebars')

const ROOT = path.join(__dirname, '..', '..')

for (const name of [
  'and', 'gt', 'ne', 'eq', 'not', 'is-eol', 'format-release-date', 'support-end-date',
  'get-header-data', 'relativize',
]) {
  Handlebars.registerHelper(name, require(path.join(ROOT, 'src/helpers/' + name + '.js')))
}
// The footer links resolve component-local resources; irrelevant here.
Handlebars.registerHelper('resolve-resource', (resource) => resource)

const TEMPLATE = Handlebars.compile(
  fs.readFileSync(path.join(ROOT, 'src/partials/version-selector.hbs'), 'utf8')
)

function version (v, extra) {
  return Object.assign({ version: v, displayVersion: v, asciidoc: { attributes: {} } }, extra || {})
}

// 26.2 is latest GA, 25.1 does not contain this page, 24.3 is what the reader is on.
function render (versions) {
  const page = {
    version: '24.3',
    componentVersion: { displayVersion: '24.3' },
    component: { title: 'Streaming', latest: { version: '26.2' } },
    attributes: {},
    versions,
  }
  return TEMPLATE({ page }, { data: { root: { page } } })
}

function rows (html) {
  const rowRx = /<a class="(sm-ver-row[^"]*)"([^>]*)>/g
  return [...html.matchAll(rowRx)].map((m) => ({
    classes: m[1].split(/\s+/),
    title: (m[2].match(/title="([^"]*)"/) || [])[1],
    status: (m[2].match(/data-status="([^"]*)"/) || [])[1],
  }))
}

test('a page missing from a version is marked and explained', () => {
  const parsed = rows(render([version('26.2'), version('25.1', { missing: true }), version('24.3')]))
  const missing = parsed.filter((r) => r.classes.includes('is-missing'))
  assert.equal(missing.length, 1)
  assert.match(missing[0].title, /^Not available in v25\.1\./)
})

test('versions that do contain the page are left unmarked', () => {
  const parsed = rows(render([version('26.2'), version('25.1', { missing: true }), version('24.3')]))
  for (const row of parsed.filter((r) => !r.classes.includes('is-missing'))) {
    assert.equal(row.title, undefined, row.status + ' should carry no tooltip')
  }
  assert.deepEqual(parsed.filter((r) => r.classes.includes('is-selected')).length, 1)
})

test('the marker is wired up in every group, not just one', () => {
  // A prerelease, the latest GA and an EOL version, each absent from this page.
  const parsed = rows(render([
    version('27.0', { prerelease: true, missing: true }),
    version('26.2', { missing: true }),
    version('24.3'),
    version('22.1', { missing: true, asciidoc: { attributes: { 'page-is-past-eol': 'true' } } }),
  ]))
  const marked = parsed.filter((r) => r.classes.includes('is-missing')).map((r) => r.status).sort()
  assert.deepEqual(marked, ['beta', 'current', 'eol'])
})

test('no missing entries means no markers at all', () => {
  const html = render([version('26.2'), version('24.3')])
  assert.ok(!html.includes('is-missing'))
  assert.ok(!html.includes('Not available in'))
})
