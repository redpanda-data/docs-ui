'use strict'

/**
 * Renders the landing page's real templates and builds the test DOM out of
 * what they actually emit, so a typo in a card attribute or a checkbox name
 * fails the engine tests rather than passing a hand-written stand-in.
 */
const fs = require('node:fs')
const path = require('node:path')
const Handlebars = require('handlebars')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const helper = (name) => require(path.join(ROOT, 'src/helpers', name + '.js'))

const hbs = Handlebars.create()
;['eq', 'ne', 'lt', 'gt', 'and', 'or', 'format-duration', 'format-release-date', 'format-verified-evidence', 'relativize'].forEach((name) => {
  hbs.registerHelper(name, helper(name))
})
hbs.registerPartial('solution-card', read('src/partials/solution-card.hbs'))

const renderCard = hbs.compile('{{> solution-card solution=solution}}')
const renderFilters = hbs.compile(read('src/partials/solutions-filters.hbs'))
const renderMeta = hbs.compile(read('src/partials/solution-meta.hbs'))

/** Every attribute of the first element in `html`, valueless ones as ''. */
function attributesOf (html) {
  const tag = String(html).trim().match(/<[a-zA-Z]+[\s\S]*?>/)
  if (!tag) throw new Error('no element found in rendered output')
  const out = {}
  const re = /([a-zA-Z][\w-]*)(?:="([^"]*)")?/g
  let first = true
  let m
  while ((m = re.exec(tag[0]))) {
    if (first) { first = false; continue } // the tag name
    out[m[1]] = m[2] === undefined ? '' : m[2]
  }
  return out
}

/** The checkboxes the filters partial rendered, in document order. */
function checkboxesOf (html) {
  const out = []
  const re = /<input type="checkbox" name="([^"]+)" value="([^"]*)">/g
  let m
  while ((m = re.exec(html))) out.push({ name: m[1], value: m[2] })
  return out
}

/** The <legend> titles, so a test can assert the order a reader sees. */
function legendsOf (html) {
  return (html.match(/<legend class="sol-filter-title">([^<]+)<\/legend>/g) || [])
    .map((l) => l.replace(/<[^>]+>/g, ''))
}

module.exports = { hbs, renderCard, renderFilters, renderMeta, attributesOf, checkboxesOf, legendsOf }
