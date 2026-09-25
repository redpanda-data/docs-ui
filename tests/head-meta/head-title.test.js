'use strict'

// src/partials/head-title.hbs with the real helpers. Five solutions share
// step titles ("Start the environment"), so step pages name their solution,
// and the Solutions landing page (titled "Redpanda Solutions") must not get
// " | Redpanda Solutions" appended to itself.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Handlebars = require('handlebars')

const ROOT = path.join(__dirname, '..', '..')
const hbs = Handlebars.create()
for (const name of ['or', 'eq', 'concat', 'detag']) {
  hbs.registerHelper(name, require(path.join(ROOT, 'src/helpers', name + '.js')))
}
hbs.registerPartial('head-title', fs.readFileSync(path.join(ROOT, 'src/partials/head-title.hbs'), 'utf8'))
// The layouts pass defaultPageTitle to head, which includes head-title with
// the same context.
const render = (page, defaultPageTitle) =>
  hbs.compile('{{> head-title}}')({ page, defaultPageTitle }).trim()

const SOLUTIONS = { name: 'solutions', title: 'Solutions' }

test('a solution step page is titled step | solution | Redpanda Solutions', () => {
  const html = render({
    title: 'Start the environment',
    layout: 'solution-step',
    component: SOLUTIONS,
    attributes: { 'solution-title': 'Multiplayer game events with a live leaderboard' },
  })
  assert.equal(html, '<title>Start the environment | Multiplayer game events with a live leaderboard | Redpanda Solutions</title>')
})

test('a step page without a solution title keeps the plain form', () => {
  const html = render({ title: 'Start the environment', layout: 'solution-step', component: SOLUTIONS, attributes: {} })
  assert.equal(html, '<title>Start the environment | Redpanda Solutions</title>')
})

test('markup in either title is stripped', () => {
  const html = render({
    title: 'Run <code>rpk</code>',
    layout: 'solution-step',
    component: SOLUTIONS,
    attributes: { 'solution-title': 'Move off <em>Kafka</em>' },
  })
  assert.equal(html, '<title>Run rpk | Move off Kafka | Redpanda Solutions</title>')
})

test('the overview is not a step: title | Redpanda Solutions', () => {
  const html = render({
    title: 'Multiplayer game events with a live leaderboard',
    layout: 'solution',
    component: SOLUTIONS,
    attributes: { 'solution-title': 'Multiplayer game events with a live leaderboard' },
  })
  assert.equal(html, '<title>Multiplayer game events with a live leaderboard | Redpanda Solutions</title>')
})

test('the landing page titled "Redpanda Solutions" gets no doubled suffix', () => {
  assert.equal(render({ title: 'Redpanda Solutions', layout: 'solutions-home', component: SOLUTIONS, attributes: {} }), '<title>Redpanda Solutions</title>')
  // Also when the title comes from the layout's default.
  assert.equal(render({ layout: 'solutions-home', component: SOLUTIONS, attributes: {} }, 'Redpanda Solutions'), '<title>Redpanda Solutions</title>')
})

test('every other page keeps page | Redpanda <component>', () => {
  assert.equal(render({ title: 'Consumer Offsets', layout: 'default', component: { name: 'streaming', title: 'Streaming' }, attributes: {} }), '<title>Consumer Offsets | Redpanda Streaming</title>')
  assert.equal(render({ title: 'Untitled page', layout: 'default', attributes: {} }), '<title>Untitled page</title>', 'no component, no suffix')
  // A non-solution page that happens to carry a solution title is unaffected.
  assert.equal(render({ title: 'Page', layout: 'default', component: { name: 'streaming', title: 'Streaming' }, attributes: { 'solution-title': 'X' } }), '<title>Page | Redpanda Streaming</title>')
})
