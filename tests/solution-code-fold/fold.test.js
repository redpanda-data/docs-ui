/**
 * Long code blocks on solution pages (src/js/30-solution-code-fold.js):
 * fold/unfold over 30 lines, no double-fold inside a closed <details>, the
 * copy button still sees the full text, file header bars from titles, and
 * line counts on collapsible summaries.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const { el, makeDocument } = require('../solution-progress/helpers/dom')

const SCRIPT = fs.readFileSync(path.join(__dirname, '../../src/js/30-solution-code-fold.js'), 'utf8')

function codeText (lines) {
  const out = []
  for (let i = 1; i <= lines; i++) out.push('line ' + i)
  return out.join('\n') + '\n'
}

// .listingblock > [.title] + .content > pre.highlight > code, with the toolbox
// 06-copy-to-clipboard.js appends to .content.
function listing (lines, opts) {
  const o = opts || {}
  const code = el('code', { class: 'language-go', 'data-lang': 'go', text: codeText(lines) })
  const pre = el('pre', { class: 'highlight' }, [code])
  const toolbox = el('div', { class: 'source-toolbox' }, [el('button', { class: 'copy-button' })])
  const content = el('div', { class: 'content' }, [pre, toolbox])
  const children = []
  if (o.title) children.push(el('div', { class: 'title' }, [el('code', { text: o.title })]))
  children.push(content)
  const block = el('div', { class: 'listingblock' }, children)
  return { block, content, pre, code, toolbox }
}

function run ({ bodyClass, blocks, reduceMotion }) {
  const doc = el('article', { class: 'doc' }, blocks)
  const body = el('body', { class: bodyClass === undefined ? 'article solution-step' : bodyClass }, [doc])
  const document = makeDocument(body)
  const calls = { scrolled: [] }
  const context = {
    console,
    document,
    window: {
      matchMedia: (q) => ({ matches: q.indexOf('reduced-motion') !== -1 ? !!reduceMotion : false }),
      getComputedStyle: () => ({ lineHeight: '24px', paddingTop: '16px', paddingBottom: '16px' }),
    },
  }
  vm.runInNewContext(SCRIPT, context)
  return { api: context.window.docsSolutionsCodeFold, doc, calls, document }
}

test('countLines ignores one trailing newline and empty input', () => {
  const { api } = run({ blocks: [] })
  assert.equal(api.countLines(''), 0)
  assert.equal(api.countLines('a'), 1)
  assert.equal(api.countLines('a\nb\n'), 2)
  assert.equal(api.countLines('a\n\nb'), 3)
})

test('a listing over 30 lines folds to 14 lines with a Show all button; clicking toggles', () => {
  const long = listing(45)
  const short = listing(30)
  run({ blocks: [long.block, short.block] })

  assert.ok(long.block.classes.has('sol-code-fold') && long.block.classes.has('is-folded'))
  assert.equal(long.content.style.maxHeight, (14 * 24 + 32) + 'px', 'about 14 lines plus padding')
  const button = long.block.querySelector('[data-sol-code-fold]')
  assert.ok(button, 'toggle rendered')
  assert.equal(button.textContent, 'Show all 45 lines')
  assert.equal(button.getAttribute('aria-expanded'), 'false')

  button.dispatch('click')
  assert.ok(!long.block.classes.has('is-folded'))
  assert.equal(long.content.style.maxHeight, '')
  assert.equal(button.textContent, 'Show less')
  assert.equal(button.getAttribute('aria-expanded'), 'true')

  button.dispatch('click')
  assert.ok(long.block.classes.has('is-folded'))
  assert.equal(button.textContent, 'Show all 45 lines')

  assert.ok(!short.block.classes.has('sol-code-fold'), 'exactly 30 lines is not folded')
  assert.equal(short.block.querySelector('[data-sol-code-fold]'), null)
})

test('folding only clips: the code keeps every line for the copy button', () => {
  const long = listing(60)
  run({ blocks: [long.block] })
  assert.equal(long.code.textContent, codeText(60), 'text untouched')
  assert.equal(long.code.hidden, false)
  assert.equal(long.pre.hidden, false)
  assert.equal(long.pre.children.length, 1, 'no lines removed or wrapped away')
  assert.equal(long.code.style.display, undefined)
  assert.equal(long.pre.style.maxHeight, undefined, 'the clip is on .content, not on pre or code')
  assert.ok(long.block.querySelector('.copy-button'), 'copy button still present')
})

// Asciidoctor's [%collapsible] output: <details><summary class="title">...</summary><div class="content">...
function collapsible (summaryText, blocks, open) {
  const attrs = open ? { open: '' } : {}
  return el('details', attrs, [el('summary', { class: 'title', text: summaryText }), el('div', { class: 'content' }, blocks)])
}

test('a block inside a closed <details> is never folded a second time; an open one is', () => {
  const closedInner = listing(50)
  const closed = collapsible('Complete source: services/leaderboard/main.go', [closedInner.block])
  const openInner = listing(50)
  const open = collapsible('Complete source: services/achievements/main.go', [openInner.block], true)
  run({ blocks: [closed, open] })
  assert.ok(!closedInner.block.classes.has('sol-code-fold'), 'closed details: left alone')
  assert.equal(closedInner.block.querySelector('[data-sol-code-fold]'), null)
  assert.ok(openInner.block.classes.has('is-folded'), 'open details: folded like any block')
})

test('a long listing inside a closed <details> folds once the details opens, and only once', () => {
  const inner = listing(50)
  const details = collapsible('Complete source: services/leaderboard/main.go', [inner.block])
  run({ blocks: [details] })
  assert.ok(!inner.block.classes.has('sol-code-fold'))

  details.open = true
  details.dispatch('toggle')
  assert.ok(inner.block.classes.has('is-folded'), 'folded on open')
  assert.equal(inner.block.querySelectorAll('[data-sol-code-fold]').length, 1)
  assert.equal(inner.block.querySelector('[data-sol-code-fold]').textContent, 'Show all 50 lines')

  details.open = false
  details.dispatch('toggle')
  details.open = true
  details.dispatch('toggle')
  assert.equal(inner.block.querySelectorAll('[data-sol-code-fold]').length, 1, 'no second toggle after reopening')

  const short = listing(12)
  const shortDetails = collapsible('Complete source: Makefile', [short.block])
  run({ blocks: [shortDetails] })
  shortDetails.open = true
  shortDetails.dispatch('toggle')
  assert.ok(!short.block.classes.has('sol-code-fold'), 'short listing never folds')
})

test('a listing title becomes a file header bar and the toolbox moves into it', () => {
  const titled = listing(10, { title: 'services/leaderboard/main.go' })
  run({ blocks: [titled.block] })
  assert.ok(titled.block.classes.has('sol-code-titled'))
  const title = titled.block.children[0]
  assert.ok(title.classes.has('sol-code-title'))
  assert.equal(titled.toolbox.parentNode, title, 'toolbox relocated into the header, aligned right by CSS')
  assert.equal(titled.content.querySelector('.source-toolbox'), null)
  assert.ok(!titled.block.classes.has('sol-code-fold'), 'short block: header only, no fold')
})

test('[%collapsible] summaries (no extra class) get the line count of the single listing they hide', () => {
  const inner = listing(37)
  const details = collapsible('Complete source: services/leaderboard/main.go', [inner.block])
  const summary = details.children[0]
  const two = collapsible('Two files', [listing(5).block, listing(6).block])
  run({ blocks: [details, two] })
  const badge = summary.querySelector('[data-sol-details-lines]')
  assert.ok(badge, 'badge added to a plain <details><summary class="title">')
  assert.equal(badge.textContent, '37 lines')
  assert.match(summary.textContent, /^Complete source: services\/leaderboard\/main\.go/)
  assert.ok(details.classes.has('sol-details'))
  assert.equal(two.querySelector('[data-sol-details-lines]'), null, 'ambiguous: no count')
  assert.ok(two.classes.has('sol-details'), 'still styled')
})

test('does nothing outside solution pages, and is idempotent when re-run', () => {
  const long = listing(80)
  const r = run({ bodyClass: 'article', blocks: [long.block] })
  assert.equal(r.api, undefined, 'module exits before exposing anything on other pages')
  assert.ok(!long.block.classes.has('sol-code-fold'))

  const again = listing(80)
  const s = run({ blocks: [again.block] })
  s.api.run(s.document)
  assert.equal(again.block.querySelectorAll('[data-sol-code-fold]').length, 1, 'one toggle after a second pass')
})

test('reduced motion: collapsing scrolls without smooth behavior', () => {
  const long = listing(45)
  let scrollOpts = null
  long.block.getBoundingClientRect = () => ({ top: -500 })
  long.block.scrollIntoView = (opts) => { scrollOpts = opts }
  run({ blocks: [long.block], reduceMotion: true })
  const button = long.block.querySelector('[data-sol-code-fold]')
  button.dispatch('click')
  button.dispatch('click')
  // Objects created inside the vm carry that context's Object prototype.
  assert.deepEqual(JSON.parse(JSON.stringify(scrollOpts)), { block: 'start' })

  const other = listing(45)
  let smooth = null
  other.block.getBoundingClientRect = () => ({ top: -500 })
  other.block.scrollIntoView = (opts) => { smooth = opts }
  run({ blocks: [other.block], reduceMotion: false })
  const b2 = other.block.querySelector('[data-sol-code-fold]')
  b2.dispatch('click')
  b2.dispatch('click')
  assert.deepEqual(JSON.parse(JSON.stringify(smooth)), { behavior: 'smooth', block: 'start' })
})
