'use strict'
/**
 * The Take it to production page (layouts/solution-production.hbs) and its
 * place in the sidebar (partials/nav-tree-solution.hbs), rendered from the
 * real templates with the repository's helpers. The page comes after the last
 * step and is not a step: no step number, no Step N of M, no mark-complete,
 * no quiz, the last step as its only neighbour, and the Take this to
 * production card after the introduction. In the sidebar it follows the Steps group,
 * unnumbered and with no tick.
 *
 * The site chrome (head, header, nav, toolbar, footer, chat panel and the
 * like) is stubbed: those partials need the full UI model and are not what
 * this page changes.
 *
 * Needs linkedom (a devDependency); without it the suite is skipped.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Handlebars = require('handlebars')

const ROOT = path.join(__dirname, '..', '..')
let parseHTML = null
try { ({ parseHTML } = require('linkedom')) } catch { /* reported below */ }
const skip = parseHTML ? false : 'linkedom is not installed (npm ci)'

const STUBBED = ['head', 'head-component-color', 'header', 'nav', 'toolbar', 'footer', 'chat-panel', 'feedback-footer', 'tracking-pixel', 'breadcrumbs', 'toc']

const hbs = Handlebars.create()
for (const file of fs.readdirSync(path.join(ROOT, 'src/helpers'))) {
  if (file.endsWith('.js')) hbs.registerHelper(path.basename(file, '.js'), require(path.join(ROOT, 'src/helpers', file)))
}
for (const file of fs.readdirSync(path.join(ROOT, 'src/partials'))) {
  if (file.endsWith('.hbs')) hbs.registerPartial(path.basename(file, '.hbs'), fs.readFileSync(path.join(ROOT, 'src/partials', file), 'utf8'))
}
for (const name of STUBBED) hbs.registerPartial(name, '')

const SLUG = 'multiplayer-gaming'
const STEPS = ['start-environment', 'create-topics', 'verify-end-to-end']
const stepUrl = (id) => `/solutions/${SLUG}/${id}/`
const PROD = `/solutions/${SLUG}/take-to-production/`
const SOLUTION = {
  id: SLUG,
  version: 'v1.0.0',
  title: 'Keep a live leaderboard current',
  url: `/solutions/${SLUG}/`,
  download: 'authenticated',
  files: [],
  steps: STEPS.map((id, i) => ({ id, url: stepUrl(id), title: 'Title of ' + id, order: i + 1 })),
  production: { title: 'Take it to production', url: PROD },
}
const NAV = {
  home: { title: 'Solutions', url: '/solutions/' },
  overview: { title: SOLUTION.title, url: SOLUTION.url },
  steps: SOLUTION.steps,
  production: SOLUTION.production,
}
const CONTENTS = '<div id="preamble"><div class="sectionbody"><div class="paragraph"><p>Work through each topic.</p></div></div></div><div class="sect1"><h2 id="prod-security">Security</h2><div class="sectionbody"><p>Use TLS.</p></div></div>'

function pageModel (layout, attributes, url) {
  return {
    page: {
      layout,
      url,
      title: layout === 'solution-production' ? 'Take it to production' : 'T',
      component: { name: 'solutions', url: '/solutions/' },
      contents: CONTENTS,
      attributes: {
        solution: JSON.stringify(SOLUTION),
        'solution-nav': JSON.stringify(NAV),
        'solution-step-count': String(STEPS.length),
        ...attributes,
      },
    },
    site: { path: '', keys: {}, components: {} },
  }
}

function renderLayout () {
  const model = pageModel('solution-production', {
    'solution-prev-url': stepUrl('verify-end-to-end'),
    'solution-prev-title': 'Title of verify-end-to-end',
  }, PROD)
  const template = hbs.compile(fs.readFileSync(path.join(ROOT, 'src/layouts/solution-production.hbs'), 'utf8'))
  return parseHTML(template(model, { data: { root: model } })).document
}

const NAV_TREE = hbs.compile(fs.readFileSync(path.join(ROOT, 'src/partials/nav-tree-solution.hbs'), 'utf8'))
const navDocument = (model) => parseHTML(`<!DOCTYPE html><html><body>${NAV_TREE(model, { data: { root: model } })}</body></html>`).document

function renderNav (layout, attributes, url) {
  return navDocument(pageModel(layout, attributes, url))
}

// True when `b` comes after `a` in the document.
const after = (document, a, b) => {
  const html = document.documentElement.outerHTML
  return html.indexOf(a.outerHTML) < html.indexOf(b.outerHTML)
}

test('the production page has the step shell, with no step number, mark-complete or quiz', { skip }, () => {
  const document = renderLayout()
  const body = document.body
  assert.ok(body.classList.contains('solution-step'), 'step shell: CSS and scripts apply')
  assert.ok(body.classList.contains('solution-production'))
  assert.equal(body.getAttribute('data-solution-id'), SLUG)
  assert.equal(body.hasAttribute('data-step-id'), false, 'no step id, so progress never marks this page')
  assert.equal(body.getAttribute('data-solution-step-count'), '3')
  const text = body.textContent.replace(/\s+/g, ' ')
  assert.doesNotMatch(text, /Step \d+ of \d+/)
  assert.equal(document.querySelector('[data-sol-complete]'), null, 'no mark-complete')
  assert.equal(document.querySelector('[data-sol-complete-continue]'), null)
  assert.equal(document.querySelector('[data-sol-quiz]'), null, 'no quiz')
  assert.equal(document.querySelector('[data-sol-rail-actions]'), null, 'no step rail actions')
  assert.equal(document.querySelector('.sol-step-header h1').textContent.trim(), 'Take it to production')
  assert.equal(document.querySelector('.sol-rail-summary-label').textContent.trim(), 'Take it to production')
})

test('the production page puts the card after the introduction, and its only neighbour is the last step', { skip }, () => {
  const document = renderLayout()
  const article = document.querySelector('article.doc')
  const card = article.querySelector('[data-sol-productionize]')
  assert.ok(card, 'the Take this to production card')
  assert.equal(card.querySelector('h2').id, 'take-to-production')
  assert.equal(card.querySelector('h2').textContent.trim(), 'Plan it for your system')
  const intro = article.querySelector('#preamble .paragraph')
  assert.ok(intro, 'the introduction')
  assert.ok(after(document, intro, card), 'the card follows the introduction')
  const topic = article.querySelector('#prod-security')
  assert.ok(after(document, card, topic), 'the card comes before the topics')
  assert.ok(card.closest('#preamble'), 'inside the preamble, so On this page does not list it')
  assert.equal(card.querySelector('[data-sol-productionize-mcp]').hasAttribute('open'), false, 'MCP setup starts collapsed')
  const prev = article.querySelector('[data-sol-prev]')
  assert.equal(prev.getAttribute('href'), '../verify-end-to-end/')
  assert.match(prev.textContent, /Previous\s*Title of verify-end-to-end/)
  assert.equal(article.querySelector('[data-sol-next]'), null)
  assert.equal(article.querySelector('[data-sol-finish]').getAttribute('href'), '../')
  // The rail's done panel scrolls to the card on this page.
  assert.equal(document.querySelector('aside [data-sol-done] [data-sol-productionize-link]').getAttribute('href'), '#take-to-production')
})

test('the sidebar lists the production page after the steps, unnumbered and with no tick', { skip }, () => {
  const document = renderNav('solution-step', { 'solution-step-id': 'create-topics' }, stepUrl('create-topics'))
  const item = document.querySelector('.sol-nav-production')
  assert.ok(item, 'listed')
  const steps = document.querySelector('[data-sol-nav-steps]').closest('.sol-nav-group')
  assert.ok(after(document, steps, item), 'after the Steps group')
  assert.equal(item.closest('[data-sol-nav-steps]'), null, 'not inside the step list')
  assert.equal(item.hasAttribute('data-sol-nav-step'), false, 'not a step: never counted or ticked')
  assert.equal(item.querySelector('.sol-nav-step-num, .sol-nav-step-check, [data-sol-nav-step-status]'), null)
  const link = item.querySelector('a')
  assert.equal(link.textContent.trim(), 'Take it to production')
  assert.equal(link.getAttribute('href'), '../take-to-production/')
  assert.equal(item.classList.contains('is-current-page'), false)
  assert.equal(link.hasAttribute('aria-current'), false)
  assert.equal(document.querySelectorAll('[data-sol-nav-step]').length, STEPS.length)
})

test('on the production page its sidebar entry is current, and no step is', { skip }, () => {
  const document = renderNav('solution-production', {}, PROD)
  const item = document.querySelector('.sol-nav-production')
  assert.ok(item.classList.contains('is-current-page'))
  assert.equal(item.querySelector('a').getAttribute('aria-current'), 'page')
  assert.equal(document.querySelectorAll('.sol-nav-step.is-current-page').length, 0)
})

test('a solution without the production page has no entry for it', { skip }, () => {
  const model = pageModel('solution', {}, SOLUTION.url)
  model.page.attributes['solution-nav'] = JSON.stringify({ ...NAV, production: null })
  const document = navDocument(model)
  assert.equal(document.querySelector('.sol-nav-production'), null)
})

test('the production layout reaches the solution nav, the TOC, the title and the breadcrumbs', () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  assert.match(read('src/partials/nav-menu-scroll.hbs'), /\(eq page\.layout 'solution-production'\)[^}]*\)\}\}\s*\{\{> nav-tree-solution\}\}/)
  assert.match(read('src/partials/toc.hbs'), /\(eq page\.layout 'solution-production'\)/)
  assert.match(read('src/partials/head-title.hbs'), /\(eq page\.layout 'solution-production'\)/)
  assert.match(read('src/partials/breadcrumbs.hbs'), /\(eq page\.layout 'solution-production'\)/)
  assert.match(read('src/helpers/has-markdown.js'), /'solution-production'/)
})
