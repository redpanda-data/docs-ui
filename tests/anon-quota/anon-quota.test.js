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

// Same transform, but with named imports replaced, so a module with SDK and
// sibling imports can be executed instead of read as text.
function loadEsmWithStubs (relPath, stubs) {
  const filename = path.join(ROOT, relPath)
  const { code } = esbuild.transformSync(fs.readFileSync(filename, 'utf8'), { format: 'cjs', loader: 'js' })
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  const load = Module._load
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    return load.call(this, request, parent, isMain)
  }
  try { mod._compile(code, filename) } finally { Module._load = load }
  return mod.exports
}

// The real quota client wired into the real service wrapper, with only the Kapa
// SDK and the threadId store stubbed. `submitted` records what actually reached
// Kapa, which is the thing every gate assertion below is really about.
function makeService () {
  const submitted = []
  const aborts = []
  class DefaultKapaApiService {
    submitQuery (args) { submitted.push(args); return 'sent' }
    abortCurrent () { aborts.push(true) }
    addFeedback () {}
  }
  const svc = loadEsmWithStubs('src/js/react/persistentApiService.js', {
    '@kapaai/react-sdk': { DefaultKapaApiService, processStream: () => {} },
    './chatPersistence': { getSavedThreadId: () => null },
    './anonQuota.js': quota,
  }).createPersistentApiService()
  return { svc, submitted, aborts }
}

// Minimal browser: window events, sessionStorage, CustomEvent (a global only
// from Node 19, so always provide it), a document stub, and a scriptable fetch.
//
// Listeners are really registered and really called, because schedulePeek's
// whole job is deciding which event it waits for. `events` collects published
// verdicts only (detail-carrying), so a bare signal like docs-chat:open doesn't
// show up in the verdict assertions.
function fakeBrowser ({ inline = false, drawerOpenedBy = null, noStorage = false } = {}) {
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
      if (ev.type === 'docs-quota' && ev.detail !== undefined) events.push(ev.detail)
      const set = listeners.get(ev.type)
      if (set) for (const fn of Array.from(set)) fn(ev)
      return true
    },
  }
  // noStorage models private browsing / storage disabled, where every accessor
  // throws. The module must degrade rather than break, and must not fall back
  // to peeking on every pageview.
  global.sessionStorage = noStorage
    ? {
      getItem () { throw new Error('storage disabled') },
      setItem () { throw new Error('storage disabled') },
      removeItem () { throw new Error('storage disabled') },
    }
    : {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)) },
      removeItem: (k) => { store.delete(k) },
    }
  global.CustomEvent = class CustomEvent { constructor (type, init) { this.type = type; this.detail = init && init.detail } }
  // #kapa-chat-root carrying AskAI.jsx's data-mounted marker is the docs home
  // page's inline Ask AI. Absent (or unmounted) means the drawer.
  //
  // drawerOpenedBy models a panel that was ALREADY open when the component
  // mounted: 'user' for a deliberate click that beat the bundle, 'restore' for
  // the page-load path that reopens a panel the reader left open.
  global.document = {
    getElementById: (id) => (inline && id === 'kapa-chat-root' ? { dataset: { mounted: 'true' } } : null),
    querySelector: (sel) => {
      if (sel !== '[data-chat-panel]' || !drawerOpenedBy) return null
      return {
        classList: { contains: (c) => c === 'is-open' },
        dataset: { openedBy: drawerOpenedBy },
      }
    },
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

// Rebuild the environment with a chosen starting state, keeping whatever the
// previous one had in sessionStorage when `keepStore` is passed. That is how a
// second pageview in the same tab session is modelled: new page, new module
// instance, same session storage.
function reload (opts = {}, keepStore = null) {
  browser = fakeBrowser(opts)
  if (keepStore) for (const [k, v] of keepStore) browser.store.set(k, v)
  calls.length = 0
  quota = loadEsm('src/js/react/anonQuota.js')
  return browser
}

const openDrawerRestored = () =>
  global.window.dispatchEvent(Object.assign(new global.CustomEvent('docs-chat:open'), { detail: { restored: true } }))

const openDrawer = () => global.window.dispatchEvent(new global.CustomEvent('docs-chat:open'))
const settle = () => new Promise((resolve) => setImmediate(resolve))

test('a normal verdict is mapped from the wire shape and published everywhere', async () => {
  respond(200, { allowed: true, limit: 3, used: 1, remaining: 2, reset_at: '2026-09-10T10:00:00Z' })
  const v = await quota.consumeQuota()
  assert.deepEqual(v, { allowed: true, degraded: false, limit: 3, used: 1, remaining: 2, resetAt: '2026-09-10T10:00:00Z', loginUrl: null, blockedBy: null })
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
  assert.deepEqual(v, { allowed: true, degraded: true, remaining: null, limit: null, used: null, resetAt: null, loginUrl: null, blockedBy: null })
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

// --- the gate, run rather than read ----------------------------------------

test('a refused consume never reaches Kapa, and says why', async () => {
  respond(429, { allowed: false, limit: 3, used: 3, remaining: 0, reset_at: '2026-09-10T10:00:00Z', login_url: '/login', blocked_by: 'visitor' })
  const { svc, submitted } = makeService()
  const errors = []
  await svc.submitQuery({ query: 'q' }, { onError: (m) => errors.push(m) })
  assert.deepEqual(submitted, [], 'the refusal is the gate, so nothing is sent')
  assert.equal(errors.length, 1)
})

test('a degraded verdict is let through: the docs AI never goes dark on a broken counter', async () => {
  respond(200, null) // unparseable body -> the fail-open verdict
  const { svc, submitted } = makeService()
  await svc.submitQuery({ query: 'q' }, {})
  assert.equal(submitted.length, 1)
})

test('Stop during the quota round trip settles the submission without waiting for it', async () => {
  // The point of the race in submitQuery. With a plain await, this submission
  // stays pending for the client's full 4s timeout and the SDK's own `finally`
  // (no request-id guard) then fires against whatever is in flight by then,
  // re-enabling the composer and swapping out Stop mid-stream. Nothing here
  // ever resolves the fetch, so `await` returning at all IS the assertion.
  global.fetch = () => new Promise(() => {})
  const { svc, submitted, aborts } = makeService()
  const inFlight = svc.submitQuery({ query: 'q' }, {})
  svc.abortCurrent()
  // Raced against a short deadline rather than plainly awaited, so a regression
  // reports itself as a clean failure here instead of hanging the run and
  // stranding the never-resolving fetch for every test after it.
  const outcome = await Promise.race([
    inFlight.then(() => 'settled'),
    new Promise((resolve) => setTimeout(() => resolve('still pending'), 500)),
  ])
  assert.equal(outcome, 'settled', 'Stop must not wait out the quota round trip')
  assert.deepEqual(submitted, [], 'a stopped question must not start streaming afterwards')
  assert.deepEqual(aborts, [true], 'and the abort still reaches the default service')
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

test('the refusing budget is carried through, so the wall can word itself', async () => {
  // The counts are always the visitor's, even when the shared per-network
  // ceiling is what refused (docs-site kapa-quota.mjs won't publish the
  // ceiling's size). Without blockedBy the wall tells someone who asked one
  // question that they have used all three.
  respond(429, { allowed: false, limit: 3, used: 1, remaining: 2, reset_at: '2026-09-10T10:00:00Z', login_url: '/login', blocked_by: 'ip' })
  const v = await quota.consumeQuota()
  assert.equal(v.blockedBy, 'ip')
  assert.equal(v.remaining, 2, 'and the misleading count is still what the server sent')
  assert.equal(quota.quotaExhausted(v), true, 'a refusal still walls, whichever budget refused')
})

test('a verdict with no blocker reports none rather than undefined', async () => {
  respond(200, { allowed: true, limit: 3, used: 1, remaining: 2, reset_at: '2026-09-10T10:00:00Z' })
  const v = await quota.consumeQuota()
  assert.equal(v.blockedBy, null)
})

// --- the remembered verdict -------------------------------------------------
//
// Gating the peek on a deliberate open left one group behind: a reader who
// browses with the drawer already open never opens it again, so they saw no
// countdown and no wall until a question was refused. Remembering the verdict
// for the tab session serves them from cache instead of from the endpoint.

const A_VERDICT = { allowed: true, limit: 3, used: 1, remaining: 2, reset_at: '2099-01-01T00:00:00Z' }

test('a verdict remembered earlier in the session is served without a request', async () => {
  respond(200, A_VERDICT)
  quota.schedulePeek()
  openDrawer()
  await settle()
  assert.equal(calls.length, 1, 'first page pays one request')

  // Next pageview in the same tab: new module instance, same session storage,
  // and this time the drawer comes back already open.
  reload({ drawerOpenedBy: 'restore' }, browser.store)
  quota.schedulePeek()
  await settle()
  assert.equal(calls.length, 0, 'no request on the restored page')
  assert.equal(quota.getQuota().remaining, 2, 'and the countdown still knows the budget')
})

test('a remembered refusal raises the wall with no request', async () => {
  // The property the peek existed for, kept for restored drawers: the wall is
  // up before the reader types, rather than after a question is swallowed.
  respond(429, { allowed: false, limit: 3, used: 3, remaining: 0, reset_at: '2099-01-01T00:00:00Z', login_url: '/login', blocked_by: 'visitor' })
  quota.schedulePeek()
  openDrawer()
  await settle()

  reload({ drawerOpenedBy: 'restore' }, browser.store)
  quota.schedulePeek()
  await settle()
  assert.equal(calls.length, 0)
  assert.equal(quota.quotaExhausted(quota.getQuota()), true)
  assert.equal(quota.getQuota().loginUrl, '/login', 'including what the wall needs to render')
})

test('a restored drawer with nothing remembered asks once, then remembers', async () => {
  reload({ drawerOpenedBy: 'restore' })
  respond(200, A_VERDICT)
  quota.schedulePeek()
  await settle()
  assert.equal(calls.length, 1, 'one request per session, not per pageview')

  reload({ drawerOpenedBy: 'restore' }, browser.store)
  quota.schedulePeek()
  await settle()
  assert.equal(calls.length, 0)
})

test('a restored drawer asks nothing when the session cannot be remembered', async () => {
  // Private browsing: with no cache, peeking here would come back on every
  // pageview, which is the cost the gate exists to remove. Losing the countdown
  // is the better failure.
  reload({ drawerOpenedBy: 'restore', noStorage: true })
  respond(200, A_VERDICT)
  quota.schedulePeek()
  await settle()
  assert.equal(calls.length, 0)

  // ...and the same reader still gets a verdict the moment they open it
  // themselves, because that is a fresh decision to use Ask AI.
  reload({ noStorage: true })
  respond(200, A_VERDICT)
  quota.schedulePeek()
  openDrawer()
  await settle()
  assert.equal(calls.length, 1)
})

test('a restored open event is ignored without storage, a deliberate one is not', async () => {
  reload({ noStorage: true })
  respond(200, A_VERDICT)
  quota.schedulePeek()
  openDrawerRestored()
  await settle()
  assert.equal(calls.length, 0, 'restore cannot be remembered, so it must not ask')
  openDrawer()
  await settle()
  assert.equal(calls.length, 1, 'the reader opening it is still worth a request')
})

test('a drawer the reader opened before the bundle loaded is not missed', async () => {
  // The CSS-only drawer opens on click before JS attaches, so the open can
  // predate this component. An event sent then is lost; the attribute is not.
  reload({ drawerOpenedBy: 'user' })
  respond(200, A_VERDICT)
  quota.schedulePeek()
  await settle()
  assert.deepEqual(calls, [{ peek: true }])
})

test('a remembered verdict from a window that has ended is discarded', async () => {
  respond(200, { ...A_VERDICT, reset_at: '2020-01-01T00:00:00Z' })
  quota.schedulePeek()
  openDrawer()
  await settle()
  assert.equal(calls.length, 1)

  reload({ drawerOpenedBy: 'restore' }, browser.store)
  respond(200, A_VERDICT)
  quota.schedulePeek()
  await settle()
  assert.equal(calls.length, 1, 'the expired verdict is no cache at all, so it asks again')
})

test('a degraded verdict is never remembered', async () => {
  // "We could not get a trustworthy answer" must not be cached, or it would
  // suppress the next real check for the rest of the session.
  // The server's own degraded answer (kapa-quota.mjs's belt-and-braces catch),
  // which unlike the client-side fail-open DOES carry a reset_at and so would
  // otherwise look cacheable.
  respond(200, { allowed: true, degraded: true, limit: 3, used: 0, remaining: 3, reset_at: '2099-01-01T00:00:00Z' })
  quota.schedulePeek()
  openDrawer()
  await settle()
  assert.equal(quota.getQuota().degraded, true)
  assert.equal(browser.store.has('docs-quota-verdict'), false, 'not written to the session cache')

  reload({ drawerOpenedBy: 'restore' }, browser.store)
  respond(200, A_VERDICT)
  quota.schedulePeek()
  await settle()
  assert.equal(calls.length, 1, 'so the next page asks for a real one')
  assert.equal(quota.getQuota().remaining, 2)
})
