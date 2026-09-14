/**
 * Long code blocks on solution pages (src/js/30-solution-code-fold.js):
 * fold by rendered height (not source lines), unfold, re-measure on resize,
 * no double-fold inside a closed <details> (fold once it opens), the copy
 * button still sees the full text, file header bars from titles, and line
 * counts on collapsible summaries.
 *
 * The stub's getComputedStyle reports a 24px line-height and 16px vertical
 * padding, so a block folds to 14 * 24 + 32 = 368px and is considered tall
 * above 16 * 24 + 32 = 416px of scrollHeight.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const { el, makeDocument } = require('../solution-progress/helpers/dom')

const SCRIPT = fs.readFileSync(path.join(__dirname, '../../src/js/30-solution-code-fold.js'), 'utf8')
const LINE = 24
const PAD = 32
const FOLDED = 14 * LINE + PAD

function codeText (lines) {
  const out = []
  for (let i = 1; i <= lines; i++) out.push('line ' + i)
  return out.join('\n') + '\n'
}

// .listingblock > [.title] + .content > pre.highlight > code, with the toolbox
// 06-copy-to-clipboard.js appends to .content. `renderedLines` mimics how many
// lines the browser laid out (wrapping makes it larger than the source count).
function listing (lines, opts) {
  const o = opts || {}
  const code = el('code', { class: 'language-go', 'data-lang': 'go', text: codeText(lines) })
  const pre = el('pre', { class: 'highlight' }, [code])
  pre.scrollHeight = (o.renderedLines === undefined ? lines : o.renderedLines) * LINE + PAD
  const toolbox = el('div', { class: 'source-toolbox' }, [el('button', { class: 'copy-button' })])
  const content = el('div', { class: 'content' }, [pre, toolbox])
  const children = []
  if (o.title) children.push(el('div', { class: 'title' }, [el('code', { text: o.title })]))
  children.push(content)
  const block = el('div', { class: 'listingblock' }, children)
  return { block, content, pre, code, toolbox }
}

// Asciidoctor's [%collapsible] output: <details><summary class="title">...</summary><div class="content">...
function collapsible (summaryText, blocks, open) {
  const attrs = open ? { open: '' } : {}
  return el('details', attrs, [el('summary', { class: 'title', text: summaryText }), el('div', { class: 'content' }, blocks)])
}

function run ({ bodyClass, blocks, reduceMotion }) {
  const doc = el('article', { class: 'doc' }, blocks)
  const body = el('body', { class: bodyClass === undefined ? 'article solution-step' : bodyClass }, [doc])
  const document = makeDocument(body)
  const timers = []
  const listeners = {}
  const context = {
    console,
    document,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null },
    window: {
      matchMedia: (q) => ({ matches: q.indexOf('reduced-motion') !== -1 ? !!reduceMotion : false }),
      getComputedStyle: () => ({ lineHeight: LINE + 'px', paddingTop: '16px', paddingBottom: '16px' }),
      addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn) },
    },
  }
  vm.runInNewContext(SCRIPT, context)
  const flushTimers = () => { const due = timers.splice(0, timers.length); due.forEach((t) => t.fn && t.fn()) }
  const fire = (type) => (listeners[type] || []).forEach((fn) => fn({ type }))
  return { api: context.window.docsSolutionsCodeFold, doc, document, timers, flushTimers, fire }
}

test('countLines ignores one trailing newline and empty input', () => {
  const { api } = run({ blocks: [] })
  assert.equal(api.countLines(''), 0)
  assert.equal(api.countLines('a'), 1)
  assert.equal(api.countLines('a\nb\n'), 2)
  assert.equal(api.countLines('a\n\nb'), 3)
})

test('a tall listing folds to 14 lines with a Show all button; clicking toggles', () => {
  const long = listing(45)
  const short = listing(12)
  run({ blocks: [long.block, short.block] })

  assert.ok(long.block.classes.has('sol-code-fold') && long.block.classes.has('is-folded'))
  assert.equal(long.content.style.maxHeight, FOLDED + 'px', 'about 14 lines plus padding')
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

  assert.ok(!short.block.classes.has('sol-code-fold'), 'a short block is not folded')
  assert.equal(short.block.querySelector('[data-sol-code-fold]'), null)
})

test('the decision is the rendered height, not the source line count', () => {
  const wrapped = listing(20, { renderedLines: 40 })
  const tallSource = listing(60, { renderedLines: 60 })
  const justUnder = listing(16, { renderedLines: 16 })
  const justOver = listing(17, { renderedLines: 17 })
  run({ blocks: [wrapped.block, tallSource.block, justUnder.block, justOver.block] })

  assert.ok(wrapped.block.classes.has('is-folded'), '20 source lines wrapped to 40 rendered lines folds')
  assert.equal(wrapped.block.querySelector('[data-sol-code-fold]').textContent, 'Show all 20 lines', 'label uses the source count')
  assert.ok(tallSource.block.classes.has('is-folded'))
  assert.ok(!justUnder.block.classes.has('sol-code-fold'), '16 rendered lines: nothing worth hiding')
  assert.ok(justOver.block.classes.has('is-folded'), '17 rendered lines: folds')
})

test('re-measures on resize (debounced) and on window load: folds late, unfolds when the block fits again', () => {
  const block = listing(20, { renderedLines: 20 })
  const r = run({ blocks: [block.block] })
  assert.ok(block.block.classes.has('is-folded'))

  // Viewport widened: no more wrapping, the block fits.
  block.pre.scrollHeight = 12 * LINE + PAD
  r.fire('resize')
  assert.ok(block.block.classes.has('is-folded'), 'not before the debounce')
  r.flushTimers()
  assert.ok(!block.block.classes.has('sol-code-fold'), 'unfolded')
  assert.equal(block.content.style.maxHeight, '')
  assert.equal(block.block.querySelector('[data-sol-code-fold]'), null, 'toggle removed')

  // Narrowed again: wraps, folds again, exactly one toggle.
  block.pre.scrollHeight = 30 * LINE + PAD
  r.fire('resize')
  r.fire('resize')
  r.flushTimers()
  assert.ok(block.block.classes.has('is-folded'))
  assert.equal(block.block.querySelectorAll('[data-sol-code-fold]').length, 1)

  // A block that could not be measured at first (scrollHeight 0) decides on load.
  const late = listing(50, { renderedLines: 0 })
  const s = run({ blocks: [late.block] })
  assert.ok(!late.block.classes.has('sol-code-fold'), 'undecided while unrendered')
  late.pre.scrollHeight = 50 * LINE + PAD
  s.fire('load')
  assert.ok(late.block.classes.has('is-folded'))
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

test('a block inside a closed <details> is never folded a second time; an open one is', () => {
  const closedInner = listing(50, { renderedLines: 0 })
  const closed = collapsible('Complete source: services/leaderboard/main.go', [closedInner.block])
  const openInner = listing(50)
  const open = collapsible('Complete source: services/achievements/main.go', [openInner.block], true)
  run({ blocks: [closed, open] })
  assert.ok(!closedInner.block.classes.has('sol-code-fold'), 'closed details: left alone')
  assert.equal(closedInner.block.querySelector('[data-sol-code-fold]'), null)
  assert.ok(openInner.block.classes.has('is-folded'), 'open details: folded like any block')
})

test('a long listing inside a closed <details> folds once the details opens, and only once', () => {
  const inner = listing(50, { renderedLines: 0 })
  const details = collapsible('Complete source: services/leaderboard/main.go', [inner.block])
  run({ blocks: [details] })
  assert.ok(!inner.block.classes.has('sol-code-fold'))

  details.open = true
  inner.pre.scrollHeight = 50 * LINE + PAD // rendered now
  details.dispatch('toggle')
  assert.ok(inner.block.classes.has('is-folded'), 'folded on open')
  assert.equal(inner.block.querySelectorAll('[data-sol-code-fold]').length, 1)
  assert.equal(inner.block.querySelector('[data-sol-code-fold]').textContent, 'Show all 50 lines')

  details.open = false
  details.dispatch('toggle')
  details.open = true
  details.dispatch('toggle')
  assert.equal(inner.block.querySelectorAll('[data-sol-code-fold]').length, 1, 'no second toggle after reopening')

  const short = listing(12, { renderedLines: 0 })
  const shortDetails = collapsible('Complete source: Makefile', [short.block])
  run({ blocks: [shortDetails] })
  shortDetails.open = true
  short.pre.scrollHeight = 12 * LINE + PAD
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
  const inner = listing(37, { renderedLines: 0 })
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
  s.api.measure(s.document)
  assert.equal(again.block.querySelectorAll('[data-sol-code-fold]').length, 1, 'one toggle after further passes')
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
