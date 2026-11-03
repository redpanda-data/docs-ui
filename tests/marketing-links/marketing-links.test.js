'use strict'

// DOC-2607: marketing links on the docs landing pages and in Ask AI.
//
// Renders the REAL help-cta.hbs partial and the REAL chat-panel partials through
// the REAL helper, so a renamed component, a dropped include, or a broken JSON
// literal fails here instead of on the live site.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Handlebars = require('handlebars')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const helper = require(path.join(ROOT, 'src/helpers/get-marketing-links.js'))

const hbs = Handlebars.create()
hbs.registerHelper('get-marketing-links', helper)
hbs.registerHelper('or', require(path.join(ROOT, 'src/helpers/or.js')))
hbs.registerPartial('help-cta', read('src/partials/help-cta.hbs'))

function renderBox (component, call) {
  const html = hbs.compile(call)({ page: { component: { name: component } } })
  const links = [...html.matchAll(/<a class="([^"]+)" href="([^"]+)"[^>]*>([^<]+)<\/a>/g)]
    .map(([, cls, url, text]) => ({ cls, url, text }))
  return { html, links }
}

// The components behind the five URLs in the ticket. Names come from each
// repo's antora.yml; a rename there would silently drop the links.
const LANDING = {
  'data-platform': ['Book a demo', 'Talk to us', 'Get started'],
  'cloud-data-platform': ['Sign up for Redpanda Cloud', 'See pricing', 'Talk to us'],
  'agentic-data-plane': ['Watch the demo', 'Book a demo', 'Talk to us'],
  streaming: ['Try Redpanda', 'Ask about Enterprise Edition', 'See pricing'],
}

for (const [component, expected] of Object.entries(LANDING)) {
  test(`${component} landing page shows its marketing links, then the community`, () => {
    const { html, links } = renderBox(component, "{{> help-cta prefix='ch3' askAi=true}}")
    assert.match(html, /<h3>Talk to the Redpanda team<\/h3>/)
    assert.deepEqual(links.map((l) => l.text), [...expected, 'Join the community'])
    for (const l of links) assert.match(l.url, /^https:\/\//)
  })
}

test('components without marketing links keep the original help box', () => {
  const { html, links } = renderBox('redpanda-connect', "{{> help-cta prefix='ch3' askAi=true}}")
  assert.match(html, /<h3>Need a hand\?<\/h3>/)
  assert.match(html, /data-action="open-chat"/)
  assert.deepEqual(links.map((l) => l.text), ['Join the community'])
})

test('prefix selects each layout\'s existing styles', () => {
  const dp = renderBox('data-platform', "{{> help-cta prefix='dp'}}")
  assert.match(dp.html, /<section class="dp-help">/)
  assert.doesNotMatch(dp.html, /open-chat/)
  // No Ask AI button, so the first link is the primary button.
  assert.equal(dp.links[0].cls, 'dp-help-btn')
  assert.ok(dp.links.slice(1).every((l) => l.cls === 'dp-help-btn dp-help-btn-secondary'))

  const ch3 = renderBox('streaming', "{{> help-cta prefix='ch3' askAi=true}}")
  // Ask AI is the primary button, so every link is secondary.
  assert.ok(ch3.links.every((l) => l.cls === 'ch3-help-btn ch3-help-btn-secondary'))
})

test('both landing layouts include the shared partial', () => {
  assert.match(read('src/partials/component-home-v3.hbs'), /\{\{> help-cta prefix='ch3' askAi=true\}\}/)
  assert.match(read('src/partials/data-platform.hbs'), /\{\{> help-cta prefix='dp'\}\}/)
})

for (const partial of ['src/partials/chat-panel.hbs', 'src/partials/chat-panel-bump.hbs']) {
  test(`${partial} emits SALES_LINKS as a valid JS array`, () => {
    const source = read(partial)
    const start = source.indexOf('window.SALES_LINKS')
    assert.ok(start >= 0, 'partial should set window.SALES_LINKS')
    const snippet = source.slice(start, source.indexOf(';\n', start) + 1)
    const rendered = hbs.compile(snippet)({})
    const expr = rendered.replace(/window\.SALES_LINKS\s*=\s*window\.SALES_LINKS\s*\|\|\s*/, '').replace(/;$/, '')
    const links = JSON.parse(expr)
    assert.deepEqual(links.map((l) => l.text), ['Talk to us', 'Book a demo'])
    for (const l of links) assert.match(l.url, /^https:\/\/www\.redpanda\.com\//)
  })
}

test('kapa-json is script safe', () => {
  assert.doesNotMatch(helper('kapa-json', {}), /</)
})

// Each tier's welcome screen shows the line exactly once.
for (const file of ['src/js/react/components/ChatSdkInterface.jsx', 'src/js/react/components/ChatInterface.jsx']) {
  test(`${file} renders SalesLinks once`, () => {
    assert.equal(read(file).split('<SalesLinks />').length - 1, 1)
  })
}
