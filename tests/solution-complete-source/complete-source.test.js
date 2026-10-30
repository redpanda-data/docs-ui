/**
 * Complete source blocks that repeat a listing (src/js/28-solution-complete-source.js).
 *
 * A collapsed "Complete source: <path>" block is replaced with a pointer only
 * when an earlier listing on the page shows the same path with the same code.
 * Every near miss (another path, an excerpt, a later listing, a listing that is
 * itself collapsed, a details with more than the listing) keeps the block.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const { el, makeDocument } = require('../solution-progress/helpers/dom')

const JS_DIR = path.join(__dirname, '../../src/js')
const SCRIPT = fs.readFileSync(path.join(JS_DIR, '28-solution-complete-source.js'), 'utf8')

const MAIN_GO = 'package main\n\nfunc main() {\n\tserve()\n}\n'

// .listingblock > [.title > code] + .content > pre > code, as Asciidoctor and
// the solutions-catalog extension render it.
function listing (code, opts) {
  const o = opts || {}
  const attrs = { class: 'listingblock' }
  if (o.file) attrs['data-solution-file'] = o.file
  if (o.tag) attrs['data-solution-tag'] = o.tag
  if (o.id) attrs.id = o.id
  const children = []
  if (o.title) children.push(el('div', { class: 'title' }, [el('code', { text: o.title })]))
  children.push(el('div', { class: 'content' }, [el('pre', { class: 'highlight' }, [el('code', { 'data-lang': 'go', text: code })])]))
  return el('div', attrs, children)
}

// Asciidoctor's [%collapsible] example block.
function completeSource (filePath, blocks) {
  return el('details', {}, [
    el('summary', { class: 'title', text: 'Complete source: ' + filePath }),
    el('div', { class: 'content' }, blocks),
  ])
}

function run (blocks, bodyClass) {
  const article = el('article', { class: 'doc' }, blocks)
  const body = el('body', { class: bodyClass === undefined ? 'article solution-step' : bodyClass }, [article])
  const document = makeDocument(body)
  document.createTextNode = (text) => el('span', { text })
  document.getElementById = (id) => body.querySelector('#' + id)
  const context = { console, document, window: {} }
  vm.runInNewContext(SCRIPT, context)
  return { article, api: context.window.docsSolutionsCompleteSource }
}

const kinds = (article) => article.children.map((c) => (c.tagName === 'DETAILS' ? 'details' : c.className))

test('a Complete source block that repeats a titled listing becomes a pointer to it', () => {
  // The preview-src/solution-step-test.adoc case: .services/leaderboard/main.go,
  // then the same file under Complete source.
  const shown = listing(MAIN_GO, { title: 'services/leaderboard/main.go' })
  const { article } = run([shown, completeSource('services/leaderboard/main.go', [listing(MAIN_GO)])])
  assert.deepEqual(kinds(article), ['listingblock', 'paragraph sol-complete-source-ref'])
  const ref = article.children[1]
  assert.equal(ref.getAttribute('data-sol-complete-source-ref'), 'services/leaderboard/main.go')
  const link = ref.querySelector('a')
  assert.equal(shown.getAttribute('id'), 'sol-source-services-leaderboard-main-go', 'the listing gets an anchor')
  assert.equal(link.getAttribute('href'), '#sol-source-services-leaderboard-main-go')
  assert.equal(link.querySelector('code').textContent, 'services/leaderboard/main.go')
  assert.deepEqual(ref.children[0].children.map((c) => c.textContent || c.tagName), ['Complete source: ', 'A', ', shown in full above.'])
})

test('a listing annotated with the same whole file matches without a title, and keeps its own id', () => {
  const shown = listing(MAIN_GO, { file: 'main.go', id: 'main-listing' })
  const { article } = run([shown, completeSource('main.go', [listing(MAIN_GO, { file: 'main.go' })])])
  assert.equal(article.children[1].querySelector('a').getAttribute('href'), '#main-listing')
})

test('trailing whitespace and the final newline do not count as a difference', () => {
  const { article } = run([
    listing('a  \nb\n\n', { title: 'x.txt' }),
    completeSource('x.txt', [listing('a\r\nb')]),
  ])
  assert.deepEqual(kinds(article), ['listingblock', 'paragraph sol-complete-source-ref'])
})

test('an excerpt of the same file keeps the Complete source block', () => {
  const { article } = run([
    listing('func main() {\n\tserve()\n}\n', { title: 'main.go', file: 'main.go', tag: 'main' }),
    listing('package main\n', { file: 'main.go' }), // a lines= range: no tag, other code
    completeSource('main.go', [listing(MAIN_GO, { file: 'main.go' })]),
  ])
  assert.deepEqual(kinds(article), ['listingblock', 'listingblock', 'details'])
})

test('the same code under another path keeps the Complete source block', () => {
  const { article } = run([listing(MAIN_GO, { title: 'cmd/main.go' }), completeSource('main.go', [listing(MAIN_GO)])])
  assert.deepEqual(kinds(article), ['listingblock', 'details'])
})

test('a tagged listing never counts as the whole file, even with the same text', () => {
  const { article } = run([
    listing(MAIN_GO, { file: 'main.go', tag: 'all' }),
    completeSource('main.go', [listing(MAIN_GO)]),
  ])
  assert.deepEqual(kinds(article), ['listingblock', 'details'])
})

test('only an earlier listing counts', () => {
  const { article } = run([completeSource('main.go', [listing(MAIN_GO)]), listing(MAIN_GO, { title: 'main.go' })])
  assert.deepEqual(kinds(article), ['details', 'listingblock'])
})

test('a listing inside another collapsed block does not count as shown', () => {
  const { article } = run([
    el('details', {}, [el('summary', { text: 'Show the file' }), el('div', { class: 'content' }, [listing(MAIN_GO, { title: 'main.go' })])]),
    completeSource('main.go', [listing(MAIN_GO)]),
  ])
  assert.deepEqual(kinds(article), ['details', 'details'])
})

test('two Complete source blocks for the same file are not merged with each other', () => {
  const { article } = run([completeSource('main.go', [listing(MAIN_GO)]), completeSource('main.go', [listing(MAIN_GO)])])
  assert.deepEqual(kinds(article), ['details', 'details'])
})

test('a details with more than the one listing is left alone', () => {
  const { article } = run([
    listing(MAIN_GO, { title: 'main.go' }),
    completeSource('main.go', [el('div', { class: 'paragraph', text: 'Note' }), listing(MAIN_GO)]),
  ])
  assert.deepEqual(kinds(article), ['listingblock', 'details'])
})

test('pages outside Solutions are untouched', () => {
  const { article, api } = run([listing(MAIN_GO, { title: 'main.go' }), completeSource('main.go', [listing(MAIN_GO)])], 'article')
  assert.equal(api, undefined)
  assert.deepEqual(kinds(article), ['listingblock', 'details'])
})

test('it runs before the modules that decorate listings and details', () => {
  // gulp concatenates src/js/+([0-9])-*.js in name order.
  const order = fs.readdirSync(JS_DIR).filter((f) => /^\d+-.*\.js$/.test(f)).sort()
  const at = (name) => order.indexOf(name)
  assert.ok(at('28-solution-complete-source.js') >= 0)
  assert.ok(at('28-solution-complete-source.js') < at('28-solution-progress.js'), 'before the Download controls')
  assert.ok(at('28-solution-complete-source.js') < at('30-solution-code-fold.js'), 'before details and fold decoration')
})
