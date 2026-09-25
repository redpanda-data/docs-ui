'use strict'

/**
 * Runs src/js/29-solutions-home.js against a landing page whose cards and
 * checkboxes come from the real templates (see render.js), in a fresh vm
 * context. Returns the handles the tests filter and assert on.
 */
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { el, makeDocument } = require('../solution-progress/helpers/dom')
const { renderCard, renderFilters, attributesOf, checkboxesOf } = require('./render')

const SCRIPT = fs.readFileSync(path.join(__dirname, '../../src/js/29-solutions-home.js'), 'utf8')

function run (options) {
  const o = options || {}
  const records = o.records || []
  const catalog = { count: records.length, all: records, facets: o.facets || {} }

  // Cards, straight from solution-card.hbs.
  const cards = records.map((solution) => el('a', attributesOf(renderCard({ solution }))))

  // Checkboxes, straight from solutions-filters.hbs, so the names under test
  // are the names a reader's browser would post.
  const filtersHtml = renderFilters({ catalog })
  const boxes = checkboxesOf(filtersHtml).map((box) =>
    el('input', { type: 'checkbox', name: box.name, value: box.value }))
  boxes.forEach((box) => { box.value = box.attrs.value })
  // Each box sits in its label row with the count, as solutions-filters.hbs
  // renders it, so the live counts have somewhere to go.
  const rows = boxes.map((box) => el('label', { class: 'sol-filter-row' }, [box, el('span', { class: 'sol-filter-count', text: '?' })]))
  ;(o.checked || []).forEach(([name, value]) => {
    const box = boxes.find((b) => b.attrs.name === name && b.attrs.value === value)
    if (!box) throw new Error('no checkbox rendered for ' + name + '=' + value)
    box.checked = true
  })

  const q = el('input', { type: 'search', 'data-sol-filter-q': '' })
  const active = el('span', { 'data-sol-filters-active': '', hidden: '' })
  const clear = el('button', { type: 'button', 'data-sol-filters-clear': '', hidden: '' })
  const count = el('p', { 'data-sol-count': '' })
  const empty = el('div', { 'data-sol-empty': '', hidden: '' })
  const form = el('form', { 'data-sol-filters-form': '' }, [q].concat(rows, [clear]))
  // The catalog the layout embeds next to the grid, which search reads for
  // the fields a card does not carry (description, platforms).
  const embedded = el('script', { type: 'application/json', 'data-sol-catalog': '', text: JSON.stringify({ solutions: records }) })
  const continueGrid = el('div', { 'data-sol-continue-grid': '' })
  const continueSection = el('section', { 'data-sol-continue': '', hidden: '' }, [continueGrid])
  const body = el('body', {}, [
    continueSection,
    el('details', { 'data-sol-filters': '', open: '' }, [el('summary', {}, [active]), form]),
    el('div', { 'data-sol-results': '' }, [count, el('div', { 'data-sol-grid': '' }, cards), empty]),
  ].concat(o.noCatalog ? [] : [embedded]))

  const document = makeDocument(body)
  const replaceState = []
  const context = {
    console,
    document,
    URLSearchParams,
    window: {
      location: { pathname: '/solutions/', search: o.search || '', hash: '' },
      history: { replaceState: (state, title, url) => replaceState.push(url) },
      addEventListener: () => {},
      docsSolutions: o.api || null,
    },
  }
  context.window.window = context.window
  vm.runInNewContext(SCRIPT, context)

  const shown = () => cards.filter((c) => !c.hidden).map((c) => c.getAttribute('data-solution-id'))
  return {
    cards,
    boxes,
    q,
    form,
    clear,
    active,
    count,
    empty,
    continueSection,
    continueGrid,
    filtersHtml,
    // The live count and dimmed state of one option, as a reader sees it.
    option: (name, value) => {
      const box = run.find(boxes, name, value)
      return { count: box.parentNode.querySelector('.sol-filter-count').textContent, dimmed: box.parentNode.classList.contains('is-empty') }
    },
    replaceState,
    shown,
    // The URL the module last wrote, which is also the state it would restore.
    url: () => (replaceState.length ? replaceState[replaceState.length - 1] : null),
    check: (name, value, on) => {
      const box = run.find(boxes, name, value)
      box.checked = on !== false
      form.dispatch('change', { target: box })
      return box
    },
    search: (text) => { q.value = text; form.dispatch('input', { target: q }) },
    clickClear: () => clear.dispatch('click', {}),
  }
}

run.find = function (boxes, name, value) {
  const box = boxes.find((b) => b.attrs.name === name && b.attrs.value === value)
  if (!box) throw new Error('no checkbox for ' + name + '=' + value)
  return box
}

module.exports = { run }
