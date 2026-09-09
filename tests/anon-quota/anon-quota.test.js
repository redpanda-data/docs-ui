'use strict'

// Anonymous Ask AI quota client (src/js/react/anonQuota.js): verdict mapping,
// fail-open behaviour, request ordering, and when the wall replaces the
// composer. The real endpoint contract is docs-site
// netlify/functions/kapa-quota.mjs; the shapes below mirror its responses.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Module = require('node:module')
const esbuild = require('esbuild')

const ROOT = path.join(__dirname, '..', '..')

// The module is ESM in a package without "type": "module"; CI runs Node 18,
// which cannot require() ESM. Transform with the same esbuild the bundle uses.
// Loaded fresh per test: the module holds the snapshot and sequence counters.
function loadEsm (relPath) {
  const filename = path.join(ROOT, relPath)
  const { code } = esbuild.transformSync(fs.readFileSync(filename, 'utf8'), { format: 'cjs', loader: 'js' })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod._compile(code, filename)
  return mod.exports
}

// Minimal browser: window events, sessionStorage, CustomEvent (a global only
// from Node 19, so always provide it), a document stub, and a scriptable fetch.
//
// Listeners are really registered and really called, because schedulePeek's
// whole job is deciding which event it waits for. `events` collects published
// verdicts only (detail-carrying), so a bare signal like docs-chat:open doesn't
// show up in the verdict assertions.
function fakeBrowser ({ inline = false } = {}) {
  const events = []
  const store = new Map()
  const listeners = new Map()
  global.window = {
    addEventListener (type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener (type, fn) {
      const set = listeners.get(type)
      if (set) set.delete(fn)
    },
    dispatchEvent (ev) {
      if (ev.detail !== undefined) events.push(ev.detail)
      const set = listeners.get(ev.type)
      if (set) for (const fn of Array.from(set)) fn(ev)
      return true
    },
  }
  global.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
  }
  global.CustomEvent = class CustomEvent { constructor (type, init) { this.type = type; this.detail = init && init.detail } }
  // #kapa-chat-root carrying AskAI.jsx's data-mounted marker is the docs home
  // page's inline Ask AI. Absent (or unmounted) means the drawer.
  global.document = {
    getElementById: (id) => (inline && id === 'kapa-chat-root' ? { dataset: { mounted: 'true' } } : null),
  }
  return { events, store, listeners }
}

const calls = []
const json = (status, body) => ({ status, json: async () => body })
const respond = (status, body) => { global.fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return json(status, body) } }

let browser
let quota
test.beforeEach(() => {
  browser = fakeBrowser()
  calls.length = 0
  quota = loadEsm('src/js/react/anonQuota.js')
})
test.afterEach(() => { delete global.window; delete global.sessionStorage; delete global.CustomEvent; delete global.document; delete global.fetch })

// Rebuild the environment for a test that needs the home page's inline mount
// rather than the drawer.
function inlineBrowser () {
  browser = fakeBrowser({ inline: true })
  quota = loadEsm('src/js/react/anonQuota.js')
  return browser
}

const openDrawer = () => global.window.dispatchEvent(new global.CustomEvent('docs-chat:open'))
const settle = () => new Promise((resolve) => setImmediate(resolve))

test('a normal verdict is mapped from the wire shape and published everywhere', async () => {
  respond(200, { allowed: true, limit: 3, used: 1, remaining: 2, reset_at: '2026-09-10T10:00:00Z' })
  const v = await quota.consumeQuota()
  assert.deepEqual(v, { allowed: true, degraded: false, limit: 3, used: 1, remaining: 2, resetAt: '2026-09-10T10:00:00Z', loginUrl: null })
  assert.deepEqual(calls, [{ peek: false }])
  assert.equal(quota.getQuota(), v)
  assert.equal(global.window.__DOCS_ANON_QUOTA, v)
  assert.deepEqual(browser.events, [v])
})

test('a refused consume (429 with login_url) is exhausted and carries the sign-in link', async () => {
  respond(429, { allowed: false, limit: 3, used: 3, remaining: 0, reset_at: '2026-09-10T10:00:00Z', login_url: '/login' })
  const v = await quota.consumeQuota()
  assert.equal(v.allowed, false)
  assert.equal(v.loginUrl, '/login')
  assert.equal(quota.quotaExhausted(v), true)
})

test('404/405 marks the endpoint absent for the session and publishes an open verdict', async () => {
  respond(404, null)
  const v = await quota.peekQuota()
  assert.deepEqual(v, { allowed: true, degraded: true, remaining: null, limit: null, used: null, resetAt: null, loginUrl: null })
  assert.equal(browser.store.get('docs-quota-absent'), '1')
  assert.deepEqual(browser.events, [v], 'the open verdict is published, not just returned')
  // No further round trips this session.
  await quota.consumeQuota()
  assert.equal(calls.length, 1)
})

test('a network failure fails open without caching the failure', async () => {
  global.fetch = async () => { throw new TypeError('Failed to fetch') }
  const v = await quota.consumeQuota()
  assert.equal(v.allowed, true)
  assert.equal(v.degraded, true)
  assert.equal(browser.store.has('docs-quota-absent'), false)
  respond(200, { allowed: true, limit: 3, used: 0, remaining: 3 })
  await quota.consumeQuota()
  assert.equal(calls.length, 1, 'the next call asks again')
})

test('a fail-open verdict clears a stale exhausted state, so the UI matches the gate', async () => {
  respond(429, { allowed: false, limit: 3, used: 3, remaining: 0, login_url: '/login' })
  await quota.consumeQuota()
  assert.equal(quota.quotaExhausted(quota.getQuota()), true)
  global.fetch = async () => { throw new TypeError('Failed to fetch') }
  await quota.peekQuota()
  assert.equal(quota.quotaExhausted(quota.getQuota()), false)
  assert.equal(browser.events.length, 2)
})

test('the flood guard (rate_limited, no login_url) is not the product wall', async () => {
  respond(429, { error: 'rate_limited' })
  const v = await quota.consumeQuota()
  assert.equal(v.allowed, true)
  assert.equal(quota.quotaExhausted(v), false)
})

test('signed in: unlimited, never exhausted', async () => {
  respond(200, { allowed: true, unlimited: true, authenticated: true })
  const v = await quota.peekQuota()
  assert.equal(v.unlimited, true)
  assert.equal(quota.quotaExhausted(v), false)
  assert.equal(quota.quotaExhausted({ ...v, remaining: 0 }), false)
})

test('a degraded verdict is always allowed, whatever the wire says', async () => {
  respond(200, { allowed: false, degraded: true, remaining: 0 })
  const v = await quota.consumeQuota()
  assert.equal(v.allowed, true)
  assert.equal(quota.quotaExhausted(v), false)
})

test('an older peek cannot overwrite a newer consume verdict', async () => {
  let releasePeek
  global.fetch = async (url, init) => {
    const { peek } = JSON.parse(init.body)
    if (peek) return new Promise((resolve) => { releasePeek = () => resolve(json(200, { allowed: true, limit: 3, used: 2, remaining: 1 })) })
    return json(200, { allowed: true, limit: 3, used: 3, remaining: 0 })
  }
  const peeking = quota.peekQuota() // slow: the cold-start warmer
  const consumed = await quota.consumeQuota() // fast: the reader's third question
  assert.equal(consumed.remaining, 0)
  releasePeek()
  const peeked = await peeking
  assert.equal(peeked.remaining, 1, 'the caller still gets its own verdict')
  assert.equal(quota.getQuota().remaining, 0, 'but the published state is the newer one')
  assert.deepEqual(browser.events.map((e) => e.remaining), [0])
})

test('quotaExhausted: the last permitted question walls once the answer settles', () => {
  const last = { allowed: true, degraded: false, unlimited: undefined, remaining: 0, limit: 3 }
  assert.equal(quota.quotaExhausted(last, false), false, 'still streaming: keep the composer and Stop')
  assert.equal(quota.quotaExhausted(last, true), true)
  assert.equal(quota.quotaExhausted(last), true)
  assert.equal(quota.quotaExhausted({ ...last, remaining: 1 }), false)
  assert.equal(quota.quotaExhausted({ ...last, remaining: null }), false, 'unknown count is not zero')
  assert.equal(quota.quotaExhausted({ ...last, degraded: true }), false)
  assert.equal(quota.quotaExhausted({ ...last, allowed: false }, false), true, 'a refusal walls immediately')
  assert.equal(quota.quotaExhausted(null), false)
})

test('the api service gate refuses on the verdict, not on the UI', async () => {
  // The gate is `if (!verdict.allowed)` in persistentApiService.js; pin that it
  // is what a refused consume produces and what a degraded one never does.
  const src = fs.readFileSync(path.join(ROOT, 'src/js/react/persistentApiService.js'), 'utf8')
  assert.match(src, /const verdict = await consumeQuota\(\)\s*\n\s*if \(!verdict\.allowed\)/)
})

// --- schedulePeek: WHERE the peek fires ------------------------------------
//
// The drawer's root markup ships on every page and AskAI.bundle.js is a plain
// defer script, so ChatSdkInterface mounts on every pageview. Peeking from that
// mount put a function invocation and a Neon read behind every anonymous
// pageview, which is what these tests exist to stop regressing.

test('in the drawer, schedulePeek asks nothing until the reader opens it', async () => {
  respond(200, { allowed: true, limit: 3, used: 0, remaining: 3, reset_at: '2026-09-10T10:00:00Z' })
  quota.schedulePeek()
  await settle()
  assert.equal(calls.length, 0, 'mounting the drawer must not touch the endpoint')

  openDrawer()
  await settle()
  assert.deepEqual(calls, [{ peek: true }], 'a deliberate open peeks, and only peeks')
  assert.equal(browser.events.length, 1, 'the verdict reaches the UI')
})

test('a second open does not peek again', async () => {
  respond(200, { allowed: true, limit: 3, used: 1, remaining: 2, reset_at: '2026-09-10T10:00:00Z' })
  quota.schedulePeek()
  openDrawer()
  await settle()
  openDrawer()
  openDrawer()
  await settle()
  assert.equal(calls.length, 1, 'one peek per pageview; later verdicts come from the consumes')
})

test('the home page inline chat peeks on mount, since its composer is already on screen', async () => {
  browser = inlineBrowser()
  respond(200, { allowed: true, limit: 3, used: 0, remaining: 3, reset_at: '2026-09-10T10:00:00Z' })
  quota.schedulePeek()
  await settle()
  assert.deepEqual(calls, [{ peek: true }], 'no drawer to open, so waiting for one would strand the countdown')
})

test('teardown unsubscribes, so a later open cannot peek for an unmounted drawer', async () => {
  respond(200, { allowed: true, limit: 3, used: 0, remaining: 3, reset_at: '2026-09-10T10:00:00Z' })
  const cancel = quota.schedulePeek()
  cancel()
  openDrawer()
  await settle()
  assert.equal(calls.length, 0)
})

test('the drawer-open signal is the one the panel scripts dispatch', () => {
  // 19-chat-panel.js and partials/chat-panel-bump.hbs both dispatch this exact
  // name on a deliberate open, and deliberately not on their restore path.
  assert.equal(quota.DRAWER_OPEN_EVENT, 'docs-chat:open')
})
