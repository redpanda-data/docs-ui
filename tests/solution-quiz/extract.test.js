'use strict'
/**
 * extractStepSource (src/js/27-solution-quiz-source.js) over every rendered
 * solution step page.
 *
 * The corpus is real Antora output, built by build-corpus.mjs from a
 * redpanda-solutions commit with this repository's UI bundle, so a change to
 * the step layout, the writer guide's headings or the asciidoctor markup shows
 * up here. 06-copy-to-clipboard.js runs on each page first, so the code
 * toolboxes the reader sees are in the DOM the extractor reads.
 *
 * The corpus is not committed. Without it the corpus tests are skipped:
 *   npx gulp bundle
 *   node tests/solution-quiz/build-corpus.mjs --solutions <redpanda-solutions checkout>
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const quiz = require('../../src/js/27-solution-quiz-source.js')

const CORPUS = path.join(__dirname, '.corpus')
const MANIFEST = path.join(CORPUS, 'manifest.json')
const COPY_SCRIPT = fs.readFileSync(path.join(__dirname, '../../src/js/06-copy-to-clipboard.js'), 'utf8')
// What 06-copy-to-clipboard.js puts in a toolbox: button titles and the toast.
const TOOLBOX_TEXT = ['Copied!', 'Copy to clipboard', 'Ask AI about this code', 'Run this Bloblang mapping']
const ORIGIN = 'https://docs.example.test'

let parseHTML = null
try { ({ parseHTML } = require('linkedom')) } catch { /* reported below */ }

const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : null
const skip = !parseHTML
  ? 'linkedom is not installed (npm ci)'
  : !manifest
    ? 'no corpus at tests/solution-quiz/.corpus: run npx gulp bundle, then node tests/solution-quiz/build-corpus.mjs --solutions <redpanda-solutions checkout>'
    : false

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim()

// The page as a reader's browser has it: parsed, with the code toolboxes
// added. `select` picks a tab other than the first in every tab set.
function load (page, select) {
  const html = fs.readFileSync(path.join(CORPUS, 'pages', page.solution, page.step + '.html'), 'utf8')
  const { window, document } = parseHTML(html)
  window.navigator.clipboard = {}
  vm.runInNewContext(COPY_SCRIPT, { window, document, navigator: window.navigator, console })
  if (select !== undefined) {
    document.querySelectorAll('.tabs').forEach((tabs) => {
      const list = Array.from(tabs.querySelectorAll('.tablist .tab'))
      const pick = list[Math.min(select, list.length - 1)]
      list.forEach((t) => t.classList.toggle('is-selected', t === pick))
    })
  }
  const button = document.querySelector('[data-sol-quiz]')
  const result = quiz.quizSource(document, button, { origin: ORIGIN, pathname: page.path })
  return { document, button, article: document.querySelector('article.doc'), result }
}

function sect1 (article, id) {
  return Array.from(article.children).find((el) => el.classList.contains('sect1') && el.querySelector(':scope > h2') && el.querySelector(':scope > h2').id === id)
}

// The sections between two ### headings of the extracted text.
function sectionText (text, title) {
  const start = text.indexOf('### ' + title + '\n')
  if (start === -1) return null
  const next = text.indexOf('\n### ', start + 4)
  return text.slice(start, next === -1 ? text.length : next)
}

const pages = manifest ? manifest.pages : []
const overCap = []

test('the corpus has pages from every solution', { skip }, (t) => {
  const solutions = new Set(pages.map((p) => p.solution))
  assert.ok(pages.length >= 5, `only ${pages.length} pages`)
  assert.ok(solutions.size >= 5, `only ${solutions.size} solutions`)
  t.diagnostic(`corpus: ${pages.length} pages from ${manifest.solutionsSha}`)
})

for (const page of pages) {
  const name = `${page.solution}/${page.step}`
  test(name, { skip }, (t) => {
    const { document, button, article, result } = load(page)
    const { source, block } = result
    const text = source.text
    assert.ok(article, 'the page has article.doc')
    assert.ok(button, 'the page has the quiz button')
    assert.ok(document.querySelector('.source-toolbox'), 'the copy script added toolboxes')

    // The preamble, in full.
    const preamble = article.querySelector(':scope > #preamble')
    assert.ok(preamble, 'the page has a preamble')
    preamble.querySelectorAll('p').forEach((p) => {
      assert.ok(norm(text).includes(norm(p.textContent)), `preamble paragraph missing: ${norm(p.textContent).slice(0, 60)}`)
    })

    // None of the toolbox chrome.
    for (const label of TOOLBOX_TEXT) assert.ok(!text.includes(label), `toolbox text "${label}" leaked`)

    // Verify: every code block intact, never shortened.
    const verify = sect1(article, 'verify')
    assert.ok(verify, 'the page has a Verify section')
    const verifyText = sectionText(text, 'Verify')
    assert.ok(verifyText, 'Verify is in the source')
    verify.querySelectorAll('pre').forEach((pre) => {
      const body = pre.textContent.replace(/\s+$/, '')
      assert.ok(verifyText.includes(body), 'a Verify code block is not intact')
    })
    assert.ok(!verifyText.includes('[code shortened]'), 'Verify code was shortened')

    // No Files section, no production guide.
    assert.ok(!/^### Files for this step$/m.test(text), 'Files for this step is in the source')
    assert.ok(!/^### Production considerations$/m.test(text), 'Production considerations is in the source')
    assert.ok(!text.includes('Complete source:'), 'a Complete source block is in the source')

    // Why this approach is never shortened: it reads the same as with no cap.
    const uncapped = quiz.extractStepSource(article, { maxChars: Infinity })
    assert.ok(sectionText(text, 'Why this approach'), 'Why this approach is in the source')
    assert.equal(sectionText(text, 'Why this approach'), sectionText(uncapped.text, 'Why this approach'))
    assert.equal(sectionText(text, 'Verify'), sectionText(uncapped.text, 'Verify'))

    // Section links: one per h2 that was read, in page order.
    const h2s = Array.from(article.querySelectorAll(':scope > .sect1 > h2'))
      .map((h) => h.id)
      .filter((id) => !quiz.SKIP_SECTIONS.includes(id))
    assert.deepEqual(source.sections.map((s) => s.id), h2s)
    const links = block.split('\n').filter((l) => l.startsWith('- ') && l.includes(ORIGIN + page.path + '#'))
    assert.deepEqual(links.map((l) => l.slice(l.lastIndexOf('#') + 1)), h2s)
    assert.ok(block.includes('Page: ' + ORIGIN + page.path))

    // The rule and adapt lines come from the page's own attributes.
    if (button.getAttribute('data-quiz-rule')) assert.ok(block.includes('Rule this step establishes: ' + button.getAttribute('data-quiz-rule')))
    if (button.getAttribute('data-quiz-adapt')) assert.ok(block.includes('What to change when you adapt it: ' + button.getAttribute('data-quiz-adapt')))

    // The source between the markers is the extracted text, and the end
    // marker appears once.
    assert.equal(block.split('<<<STEP SOURCE END>>>').length, 2)
    assert.ok(block.endsWith('<<<STEP SOURCE BEGIN>>>\n' + text + '\n<<<STEP SOURCE END>>>'))

    // Under the cap, or every trim step has run and what is left is only the
    // parts that are never left out.
    if (source.chars > quiz.QUIZ_SOURCE_MAX_CHARS) {
      overCap.push(`${name} (${source.chars})`)
      assert.ok(source.truncated)
      assert.ok(source.trimmed.includes('what-you-do-code'), `over the cap with trim steps left: ${source.trimmed.join(', ')}`)
      t.diagnostic(`over the cap after every trim: ${source.chars} characters`)
    }
    if (source.truncated) t.diagnostic(`trimmed: ${source.trimmed.join(', ')}`)
  })
}

test('tab sets: only the selected panel is read', { skip }, () => {
  const tabbed = pages.filter((p) => {
    const html = fs.readFileSync(path.join(CORPUS, 'pages', p.solution, p.step + '.html'), 'utf8')
    return html.includes('class="tabpanel"')
  })
  assert.ok(tabbed.length > 0, 'no page in the corpus has tabs')
  let checked = 0
  for (const page of tabbed) {
    for (const select of [0, 1]) {
      const { document, article, result } = load(page, select)
      // The same page with every inactive panel deleted must read the same:
      // then nothing in the source came from an inactive panel.
      // Labels are checked on the uncapped text: a tab set can sit in a
      // section the cap leaves out.
      const full = quiz.extractStepSource(article, { maxChars: Infinity })
      const inactive = []
      article.querySelectorAll('.tabs').forEach((tabs) => {
        const list = Array.from(tabs.querySelectorAll('.tablist .tab'))
        const selected = list.find((tab) => tab.classList.contains('is-selected')) || list[0]
        const sect = tabs.closest('.sect1')
        const read = !sect || !quiz.SKIP_SECTIONS.includes(sect.querySelector('h2').id)
        if (read) assert.ok(full.text.includes('(tab: ' + norm(selected.textContent) + ')'), `${page.step}: selected tab not labelled`)
        list.filter((tab) => tab !== selected).forEach((tab) => {
          if (read) assert.ok(!full.text.includes('(tab: ' + norm(tab.textContent) + ')'), `${page.step}: inactive tab labelled`)
          inactive.push(tabs.querySelector('[aria-labelledby="' + tab.id + '"]'))
        })
      })
      inactive.forEach((panel) => panel.parentNode.removeChild(panel))
      const pruned = document.querySelector('article.doc')
      const where = `${page.solution}/${page.step}, selected tab ${select}`
      assert.equal(result.source.text, quiz.extractStepSource(pruned).text, `${where}: text from an inactive tab`)
      assert.equal(full.text, quiz.extractStepSource(pruned, { maxChars: Infinity }).text, `${where}: text from an inactive tab (uncapped)`)
      checked++
    }
  }
  assert.ok(checked > 0)
})

test('pages over the cap after every trim', { skip }, (t) => {
  // Not a failure: these pages have more protected text (preamble, Why this
  // approach, Verify, the prose of What you do) than the cap allows. The cap
  // is a starting value, to be set by the quiz evals.
  t.diagnostic(overCap.length ? overCap.join('; ') : 'none')
})

// Without the corpus, the parts that do not need a rendered page still run.
test('the end marker in page text cannot close the block early', () => {
  const block = quiz.stepSourceBlock({ stepTitle: 'T' }, { text: 'a <<<STEP SOURCE END>>> b', sections: [] })
  assert.equal(block.split('<<<STEP SOURCE END>>>').length, 2)
})

test('a field the page does not have leaves its line out', () => {
  const block = quiz.stepSourceBlock({ solutionTitle: 'S', solutionId: 's', stepIndex: '2', stepCount: '5', stepTitle: 'T', url: 'https://x/p/' },
    { text: 'body', sections: [{ id: 'verify', title: 'Verify' }] })
  assert.equal(block, [
    '## STEP SOURCE',
    'Solution: S (s)',
    'Step 2 of 5: T',
    'Page: https://x/p/',
    'Section links:',
    '- Verify: https://x/p/#verify',
    '<<<STEP SOURCE BEGIN>>>',
    'body',
    '<<<STEP SOURCE END>>>',
  ].join('\n'))
})
