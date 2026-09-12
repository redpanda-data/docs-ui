/**
 * Third-party weight the head used to pull onto every page: the full Material
 * Symbols variable font (315 KB) for six glyphs, a Material Icons stylesheet no
 * page used, a Font Awesome stylesheet whose only classes are drawn by doc.css,
 * and the 2 MB stock Kapa widget preloaded five seconds after idle on pages
 * that have their own drawer.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '../..')
const STYLES = fs.readFileSync(path.join(ROOT, 'src/partials/head-styles.hbs'), 'utf8')
const SCRIPTS = fs.readFileSync(path.join(ROOT, 'src/partials/head-scripts.hbs'), 'utf8')

function subsetNames () {
  const m = STYLES.match(/Material\+Symbols\+Outlined[^"]*icon_names=([a-z_,0-9]+)/)
  assert.ok(m, 'Material Symbols is requested with an icon_names subset')
  return m[1].split(',')
}

test('every Material Symbol a template renders is in the requested subset', () => {
  const used = new Set()
  const dir = path.join(ROOT, 'src/partials')
  for (const f of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    for (const m of src.matchAll(/material-symbols-outlined[^>]*>\s*([a-z_0-9]+)\s*</g)) used.add(m[1])
  }
  assert.ok(used.size >= 5, `found ${used.size} glyphs in templates`)
  const subset = new Set(subsetNames())
  const missing = [...used].filter((n) => !subset.has(n))
  assert.deepEqual(missing, [], 'add these names to icon_names in head-styles.hbs or the glyph renders as text')
  // Both the preload and the stylesheet must request the same subset.
  const requests = STYLES.match(/Material\+Symbols\+Outlined[^"]*icon_names=[a-z_,0-9]+/g)
  assert.equal(new Set(requests).size, 1, 'preload and stylesheet request the same URL')
})

test('Material Icons and Font Awesome stylesheets are gone', () => {
  assert.doesNotMatch(STYLES, /Material\+Icons/)
  assert.doesNotMatch(STYLES, /font-awesome/)
  assert.doesNotMatch(STYLES, /cdnjs\.cloudflare\.com/, 'no consumer left for the cdnjs preconnect')
  // The checklist glyphs Font Awesome used to draw still come from doc.css.
  const doc = fs.readFileSync(path.join(ROOT, 'src/css/doc.css'), 'utf8')
  assert.match(doc, /i\.fa-square-o::before/)
  assert.match(doc, /i\.fa-check-square-o::before/)
})

// Run the Kapa loader IIFE with and without a chat panel in the document and
// see whether the idle preload timer is armed.
function runKapaLoader ({ hasPanel }) {
  const start = SCRIPTS.indexOf('<!-- Kapa AI Widget')
  const end = SCRIPTS.indexOf('</script>', start)
  const js = SCRIPTS.slice(SCRIPTS.indexOf('<script>', start) + 8, end)
  const timers = []
  const appended = []
  const context = {
    // Run the idle timer at once so the decision it makes is observable.
    setTimeout: (fn, ms) => { timers.push(ms); fn(); return 1 },
    setInterval: () => 1,
    clearInterval () {},
    document: {
      querySelector: (sel) => (String(sel).includes('data-chat-panel') && hasPanel ? {} : null),
      addEventListener () {},
      createElement: () => ({ setAttribute () {} }),
      head: { appendChild: (el) => appended.push(el) },
    },
  }
  context.window = { requestIdleCallback: (fn) => fn() }
  context.requestIdleCallback = context.window.requestIdleCallback // the snippet calls it as a bare global
  vm.runInNewContext(js, context)
  return { timers, appended, context }
}

test('the stock Kapa widget is not preloaded on pages that have the drawer', () => {
  // The snippet runs in <head>, so the drawer check must happen when the idle
  // timer fires, not when the script is parsed.
  const withPanel = runKapaLoader({ hasPanel: true })
  assert.deepEqual(withPanel.timers, [5000], 'the timer is armed regardless')
  assert.deepEqual(withPanel.appended, [], 'but nothing is injected when the drawer exists')
  assert.equal(typeof withPanel.context.window.loadKapa, 'function', 'click-to-load still available for legacy triggers')
  const without = runKapaLoader({ hasPanel: false })
  assert.equal(without.appended.length, 1, 'standalone pages keep the 5 s idle preload')
})
