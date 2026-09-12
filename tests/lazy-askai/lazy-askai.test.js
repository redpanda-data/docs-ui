/**
 * AskAI.bundle.js (React + both Kapa SDKs, ~1 MB) used to be a deferred
 * <script> on every docs page, and mounting it eagerly ran the anonymous-tier
 * SDK, which loads reCAPTCHA, on pages where nobody opened the drawer. The
 * bundle is now fetched by 19-chat-panel.js on open (or on hover/focus intent),
 * while the ~2 KB kapaSession.bundle.js keeps running the session probe so the
 * header's Sign in control still learns whether the auth backend exists.
 *
 * These tests pin the three halves of that contract: the partial no longer
 * ships the big bundle, the panel script injects it exactly once, and the
 * probe was moved (not duplicated) out of AskAI.jsx.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '../..')
const PANEL_HBS = fs.readFileSync(path.join(ROOT, 'src/partials/chat-panel.hbs'), 'utf8')
const PANEL_JS = fs.readFileSync(path.join(ROOT, 'src/js/19-chat-panel.js'), 'utf8')
const ASKAI = fs.readFileSync(path.join(ROOT, 'src/js/react/AskAI.jsx'), 'utf8')
const SESSION = fs.readFileSync(path.join(ROOT, 'src/js/react/kapaSession.js'), 'utf8')

test('chat-panel.hbs no longer loads AskAI.bundle.js eagerly, only the session probe', () => {
  assert.doesNotMatch(PANEL_HBS, /<script[^>]*AskAI\.bundle\.js/, 'the React bundle must not be a page <script>')
  assert.doesNotMatch(PANEL_HBS, /<link[^>]*AskAI\.bundle\.css/, 'its CSS goes with it')
  assert.match(PANEL_HBS, /<script defer src="\{\{\{uiRootPath\}\}\}\/js\/kapaSession\.bundle\.js"><\/script>/)
  // 19-chat-panel.js reads the bundle URL from the panel element.
  assert.match(PANEL_HBS, /data-chat-panel data-askai-bundle="\{\{\{uiRootPath\}\}\}\/js\/AskAI\.bundle\.js"/)
  // Something visible while the bundle downloads: the tier-probe spinner.
  assert.match(PANEL_HBS, /<div id="chat-panel-kapa-root">.*chat-tier-loading/)
})

// Drive the IIFE through a stub DOM and record what it appends to <head>.
function runPanel ({ storedOpen = false, askForm = false } = {}) {
  const store = storedOpen ? { 'redpanda-chat-panel-open': 'true' } : {}
  const appended = []
  const docListeners = {}
  const panelListeners = {}
  const openBtnListeners = []
  const root = { dataset: {}, innerHTML: '' }
  const panel = {
    classList: { add () {}, remove () {}, toggle: () => false, contains: () => false },
    setAttribute () {},
    getAttribute: (name) => (name === 'data-askai-bundle' ? '/_/js/AskAI.bundle.js' : null),
    querySelectorAll: () => [],
    querySelector: (sel) => (String(sel).includes('chat-panel-kapa-root') ? root : null),
    addEventListener: (t, fn) => { panelListeners[t] = fn },
    inert: false,
  }
  const openBtn = { addEventListener: (t, fn) => openBtnListeners.push(fn), style: {}, focus () {} }
  const context = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v) },
      removeItem: (k) => { delete store[k] },
    },
    document: {
      cookie: '',
      querySelector: (sel) => {
        const s = String(sel)
        if (s.includes('data-chat-panel')) return panel
        if (s.includes('open-chat')) return openBtn
        if (s.includes('#home-ask-form')) return askForm ? {} : null
        return null
      },
      querySelectorAll: (sel) => (String(sel).includes('open-chat') ? [openBtn] : []),
      addEventListener: (t, fn) => { docListeners[t] = fn },
      createElement: (tag) => ({ tag, setAttribute () {} }),
      head: { appendChild: (el) => appended.push(el) },
    },
    window: {
      innerWidth: 1400,
      addEventListener () {},
      dispatchEvent: () => true,
      CustomEvent: class { constructor (type) { this.type = type } },
    },
  }
  vm.runInNewContext(PANEL_JS, context)
  return { appended, docListeners, openBtnListeners, root, panel, context }
}

test('opening the drawer injects the bundle and its CSS exactly once', () => {
  const { appended, openBtnListeners } = runPanel()
  assert.deepEqual(appended, [], 'nothing is fetched at load')
  openBtnListeners.forEach((fn) => fn())
  const scripts = appended.filter((el) => el.tag === 'script')
  const links = appended.filter((el) => el.tag === 'link')
  assert.equal(scripts.length, 1)
  assert.equal(scripts[0].src, '/_/js/AskAI.bundle.js')
  assert.equal(scripts[0].defer, true)
  assert.equal(links.length, 1)
  assert.equal(links[0].href, '/_/js/AskAI.bundle.css')
  assert.equal(links[0].rel, 'stylesheet')
  // A second open (or a restore + open) must not add a second copy of React.
  openBtnListeners.forEach((fn) => fn())
  assert.equal(appended.length, 2)
})

test('a persisted-open drawer restores on load and fetches the bundle immediately', () => {
  const { appended } = runPanel({ storedOpen: true })
  assert.equal(appended.filter((el) => el.tag === 'script').length, 1)
})

test('hovering or focusing an Ask AI trigger warms the bundle without opening the drawer', () => {
  const { appended, docListeners } = runPanel()
  const trigger = { closest: (sel) => (sel.includes('open-chat') ? trigger : null) }
  docListeners.pointerover({ target: trigger })
  assert.equal(appended.filter((el) => el.tag === 'script').length, 1)
  // Unrelated elements do nothing.
  const other = { closest: () => null }
  docListeners.focusin({ target: other })
  assert.equal(appended.length, 2)
})

test('a landing page with a hero ask form warms the bundle on the first interaction of any kind', () => {
  const { appended, docListeners } = runPanel({ askForm: true })
  assert.equal(appended.length, 0)
  docListeners.pointermove({})
  assert.equal(appended.filter((el) => el.tag === 'script').length, 1)
  // Docs pages (no ask form) do not: only hover/focus on a trigger, or an open.
  const plain = runPanel()
  assert.equal(typeof plain.docListeners.pointermove, 'undefined')
})

test('the anonymous drawer re-asks once, automatically, when the browser check was not ready', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/js/react/components/ChatSdkInterface.jsx'), 'utf8')
  const start = src.indexOf('const captchaRetried')
  assert.ok(start > 0, 'captcha auto-retry present')
  const effect = src.slice(start, src.indexOf('}, [scopeDropped, queryFailed, conversation.length])', start))
  assert.match(effect, /captchaRetried\.current\.has\(latestQA\.question\)\) return/, 'once per question, so a persistent failure cannot loop')
  assert.match(effect, /setTimeout\(\(\) => handleRetry\(latestQA\.question\), 1500\)/, 'one delayed retry')
})

test('a failed bundle download shows a message and allows a retry on the next open', () => {
  const { appended, openBtnListeners, root } = runPanel()
  openBtnListeners.forEach((fn) => fn())
  const script = appended.find((el) => el.tag === 'script')
  script.onerror()
  assert.match(root.innerHTML, /could not be loaded/)
  openBtnListeners.forEach((fn) => fn())
  assert.equal(appended.filter((el) => el.tag === 'script').length, 2, 'retried after the error')
})

test('the session probe lives in kapaSession.js and AskAI.jsx only imports it', () => {
  for (const fn of ['function announceSession', 'function getSessionToken', 'function probeSession', 'function probeOnIntent']) {
    assert.ok(SESSION.includes(fn), `${fn} is defined in kapaSession.js`)
    assert.ok(!ASKAI.includes(fn), `${fn} must not also be defined in AskAI.jsx`)
  }
  assert.match(ASKAI, /import \{ getSessionToken, installSessionProbe \} from '\.\/kapaSession\.js'/)
  assert.match(ASKAI, /installSessionProbe\(\)/)
  assert.doesNotMatch(ASKAI, /probeSession\(\)/, 'mount() must go through the idempotent installer')
})

// kapaSession.js is an ES module bundled into two IIFEs. Load it twice into one
// context, the way the page does when both bundles arrive, and check the probe
// runs once.
function loadSessionModule (context) {
  const rewritten = SESSION
    .replace(/^export function installSessionProbe/m, 'globalThis.installSessionProbe = function installSessionProbe')
    .replace(/^export \{[^}]*\}\s*$/m, '')
  assert.notEqual(rewritten, SESSION, 'the export shape changed; update this harness')
  // Each real bundle is its own IIFE, so module-level consts never collide.
  vm.runInNewContext(`(function () {\n${rewritten}\n})()`, context)
}

test('the probe runs once per page no matter how many bundles carry it', () => {
  const posts = []
  const warmListeners = []
  const context = {
    console,
    Date,
    Number,
    JSON,
    Boolean,
    Error,
    Promise,
    setTimeout,
    clearTimeout,
    CustomEvent: class { constructor (type, init) { this.type = type; this.detail = init && init.detail } },
    AbortController: class { constructor () { this.signal = {} } abort () {} },
    sessionStorage: { getItem: () => null, setItem () {}, removeItem () {} },
    fetch: (url) => { posts.push(url); return new Promise(() => {}) }, // never resolves: only the call count matters
    document: { cookie: '', querySelector: () => ({}) },
  }
  context.window = {
    addEventListener: (t) => { if (t === 'docs-account:warm') warmListeners.push(t) },
    dispatchEvent: () => true,
  }
  context.globalThis = context
  loadSessionModule(context) // kapaSession.bundle.js
  loadSessionModule(context) // AskAI.bundle.js carrying the same module
  context.installSessionProbe() // AskAI.jsx mount()
  assert.equal(posts.length, 1, 'one POST /kapa/session')
  assert.equal(warmListeners.length, 1, 'one docs-account:warm listener')
  assert.equal(context.window.__KAPA_SESSION_PROBE_INSTALLED, true)
})
