'use strict'

// Antora drops the page- prefix when it builds page.attributes: a page that
// sets :page-commercial-names: is read as page.attributes.commercial-names
// (@antora/page-composer build-ui-model.js). head-info.hbs and labs-home.hbs
// once read page.attributes.page-*, so the keywords and hero text that pages
// set never rendered. These tests build page.attributes the way Antora does
// and render the real template blocks.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Handlebars = require('handlebars')

const ROOT = path.join(__dirname, '..', '..')
Handlebars.registerHelper('or', require(path.join(ROOT, 'src/helpers/or.js')))

// Same mapping as Antora's build-ui-model.js.
const pageAttributes = (asciidocAttributes) => {
  const attributes = {}
  for (const [name, val] of Object.entries(asciidocAttributes)) {
    if (name.startsWith('page-')) attributes[name.substr(5)] = val
  }
  return attributes
}

const block = (file, from, to) => {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
  const start = src.indexOf(from)
  const end = src.indexOf(to, start)
  assert.ok(start >= 0 && end > start, `${file} changed under this test: could not find ${from} .. ${to}`)
  return Handlebars.compile(src.slice(start, end))
}

const KEYWORDS = block('src/partials/head-info.hbs', '{{#if (or page.keywords', '{{#with (or antoraVersion')
const LABS_HERO = block('src/layouts/labs-home.hbs', '<div class="labs-hero-eyebrow">', '<div class="labs-hero-stats">')

test('head-info renders :page-commercial-names: as meta keywords', () => {
  const html = KEYWORDS({ page: { attributes: pageAttributes({ 'page-commercial-names': 'Apache Kafka, Kafka' }) } })
  assert.match(html, /<meta name="keywords" content="Apache Kafka, Kafka">/)
})

test('head-info joins page keywords and commercial names', () => {
  const page = { keywords: 'franz', attributes: pageAttributes({ 'page-commercial-names': 'Apache Kafka' }) }
  assert.match(KEYWORDS({ page }), /<meta name="keywords" content="franz, Apache Kafka">/)
})

test('labs-home renders the :page-hero-*: attributes', () => {
  const html = LABS_HERO({
    page: {
      attributes: pageAttributes({
        'page-hero-eyebrow': 'Eyebrow X',
        'page-hero-title': 'Title X',
        'page-hero-subtitle': 'Subtitle X',
      }),
    },
  })
  assert.match(html, /Eyebrow X/)
  assert.match(html, /<h1 class="labs-hero-title">Title X<\/h1>/)
  assert.match(html, /Subtitle X/)
})
