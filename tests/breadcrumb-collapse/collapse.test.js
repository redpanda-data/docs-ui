'use strict'
/**
 * 21-breadcrumb-collapse.js on a linkedom DOM with stubbed layout: a crumb
 * the CSS cuts short gets its full text as a title, the ellipsis button shows
 * for it even when nothing is hidden, and the menu lists the whole trail in
 * full with the current page last. Plus the header.css rules that make the
 * cut a real ellipsis in the collapsed state too.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '..', '..')
const SCRIPT = fs.readFileSync(path.join(ROOT, 'src/js/21-breadcrumb-collapse.js'), 'utf8')
const CSS = fs.readFileSync(path.join(ROOT, 'src/css/header.css'), 'utf8')

let parseHTML = null
try { ({ parseHTML } = require('linkedom')) } catch { /* reported below */ }
const skip = parseHTML ? false : 'linkedom is not installed (npm ci)'

const SOLUTION = 'Keep a live leaderboard current as game events stream in'

// `crumbs`: [text, href|null, { natural, shown }]: natural is the text's full
// width, shown the width the CSS leaves it. `available` is the bar's width.
function load (crumbs, available) {
  const lis = crumbs.map(([text, href]) => href ? `<li><a href="${href}">${text}</a></li>` : `<li><span>${text}</span></li>`).join('')
  const { document, window } = parseHTML(`<html><body><div class="topbar-crumbs"><nav class="breadcrumbs"><ul>${lis}</ul></nav></div></body></html>`)
  const container = document.querySelector('.topbar-crumbs')
  Object.defineProperty(container, 'clientWidth', { get: () => available })
  document.querySelectorAll('.breadcrumbs li').forEach((li, i) => {
    const [, , size] = crumbs[i]
    Object.defineProperty(li, 'offsetWidth', { get: () => size.natural })
    const label = li.firstElementChild
    Object.defineProperty(label, 'scrollWidth', { get: () => size.natural })
    Object.defineProperty(label, 'clientWidth', { get: () => (li.classList.contains('bc-hidden') ? 0 : size.shown) })
  })
  const timers = []
  const win = { addEventListener: () => {} }
  vm.runInNewContext(SCRIPT, { window: win, document, setTimeout: (fn) => timers.push(fn), clearTimeout: () => {}, Array })
  timers.forEach((fn) => fn())
  const button = document.querySelector('.bc-ellipsis')
  const open = () => {
    button.dispatchEvent(new window.Event('click'))
    return Array.from(document.querySelectorAll('.bc-dropdown > *')).map((el) => ({
      tag: el.tagName, text: el.textContent, current: el.getAttribute('aria-current'),
    }))
  }
  return { document, container, button, open, labels: () => Array.from(document.querySelectorAll('.breadcrumbs li:not(.bc-ellipsis-li) > *')) }
}

const fits = (w) => ({ natural: w, shown: w })
const cut = (w, shown) => ({ natural: w, shown })

test('a crumb cut short gets its full text as a title, and the button shows with nothing hidden', { skip }, () => {
  const page = load([['Home', '/'], [SOLUTION, '/solutions/mg/', cut(400, 176)], ['Register the schemas', null, fits(160)]].map((c, i) => c[2] ? c : [...c, fits(60)]), 2000)
  assert.equal(page.container.classList.contains('is-collapsed'), false, 'three crumbs never collapse')
  assert.equal(page.container.classList.contains('has-truncated'), true)
  const [home, solution, current] = page.labels()
  assert.equal(solution.getAttribute('title'), SOLUTION)
  assert.equal(home.hasAttribute('title'), false)
  assert.equal(current.hasAttribute('title'), false)
  assert.deepEqual(page.open(), [
    { tag: 'A', text: 'Home', current: null },
    { tag: 'A', text: SOLUTION, current: null },
    { tag: 'SPAN', text: 'Register the schemas', current: 'page' },
  ])
})

test('a collapsed trail lists every crumb in full, not only the hidden ones', { skip }, () => {
  const page = load([
    ['Home', '/', fits(60)],
    ['Solutions', '/solutions/', fits(80)],
    [SOLUTION, '/solutions/mg/', cut(400, 176)],
    ['Register the schemas', '/solutions/mg/register-schemas/', cut(300, 120)],
  ], 500)
  assert.equal(page.container.classList.contains('is-collapsed'), true)
  const labels = page.labels()
  assert.equal(labels[1].hasAttribute('title'), false, 'a hidden crumb is listed, not titled')
  assert.equal(labels[2].getAttribute('title'), SOLUTION)
  assert.equal(labels[3].getAttribute('title'), 'Register the schemas', 'the last crumb too')
  const listed = page.open()
  assert.deepEqual(listed.map((e) => e.text), ['Home', 'Solutions', SOLUTION, 'Register the schemas'])
  assert.equal(listed[3].current, 'page')
  assert.equal(listed[3].tag, 'SPAN', 'the current page is not a link to itself')
})

test('a trail that fits has no titles and no button', { skip }, () => {
  const page = load([['Home', '/', fits(60)], ['Streaming', '/streaming/', fits(80)], ['Topics', null, fits(60)]], 2000)
  assert.equal(page.container.classList.contains('has-truncated'), false)
  assert.equal(page.container.classList.contains('is-collapsed'), false)
  assert.ok(page.labels().every((el) => !el.hasAttribute('title')))
})

test('every crumb label truncates with an ellipsis, and the collapsed state no longer resets it', () => {
  assert.match(CSS, /\.topbar-crumbs \.breadcrumbs li > a,\s*\.topbar-crumbs \.breadcrumbs li > span \{[^}]*text-overflow: ellipsis;/)
  assert.doesNotMatch(CSS, /^\s*text-overflow: unset;/m)
  assert.match(CSS, /\.topbar-crumbs\.has-truncated \.breadcrumbs li\.bc-ellipsis-li/)
})
