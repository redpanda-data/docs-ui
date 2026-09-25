/**
 * Un-marking and multi-copy consistency: an un-mark must survive the server's
 * merge and other devices, two tabs must not overwrite each other, a PUT
 * answer must not drop a step marked while it was in flight, and a page
 * restored from the back-forward cache must show current progress.
 *
 * The fake server stores one document and merges every PUT into it with the
 * module's own merge, which the shared fixture proves equal to docs-site's
 * mergeAll.
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const { run, doneIds, STORE_KEY, DIRTY_KEY } = require('./helpers/run')

const V = 'v1.0.0'

function fakeServer (initial) {
  const server = { doc: initial || { v: 2, updatedAt: 0, solutions: {} }, merge: null }
  server.fetch = (url, init, fallback) => {
    const method = (init && init.method) || 'GET'
    if (url !== '/solutions/progress') return fallback(url, init)
    if (method === 'GET') return { status: 200, ok: true, json: () => Promise.resolve({ progress: JSON.parse(JSON.stringify(server.doc)) }) }
    const sent = JSON.parse(init.body)
    server.doc = server.merge(server.doc, sent)
    return { status: 200, ok: true, json: () => Promise.resolve({ progress: JSON.parse(JSON.stringify(server.doc)) }) }
  }
  return server
}

function device (server, o) {
  const r = run(Object.assign({ page: 'step', signedIn: true, hint: 'true', fetch: server.fetch }, o))
  if (!server.merge) server.merge = (a, b) => r.api.merge(a, b, r.clock.now)
  return r
}

test('signed in: an un-mark is not brought back by the server merge', async () => {
  const server = fakeServer()
  const r = device(server, { stepId: 's1' })
  await r.flush()
  r.els.complete.dispatch('click')
  await r.flush()
  assert.deepEqual(doneIds(server.doc.solutions.demo), ['s1'], 'the mark reached the server')

  r.clock.now += 1000
  r.els.complete.dispatch('click')
  await r.flush()
  assert.deepEqual(doneIds(server.doc.solutions.demo), [], 'the un-mark reached the server')
  assert.equal(server.doc.solutions.demo.steps.s1.done, false, 'stored as an un-mark, not dropped')
  assert.deepEqual(r.api.getState().solutions.demo.completedSteps, [], 'and the PUT answer did not re-mark it locally')
  assert.equal(r.els.complete.getAttribute('aria-pressed'), 'false')
})

test('cross-device: a stale device that still has the step done does not undo an un-mark, and a later re-mark wins', async () => {
  const server = fakeServer()
  // Laptop marks s1 and s2.
  const laptop = device(server, { stepId: 's1', now: 1000000 })
  await laptop.flush()
  laptop.els.complete.dispatch('click')
  await laptop.flush()
  const laptop2 = device(server, { stepId: 's2', now: 1001000, localRaw: laptop.local.data })
  await laptop2.flush()
  laptop2.els.complete.dispatch('click')
  await laptop2.flush()
  const laptopStorage = Object.assign({}, laptop2.local.data)
  assert.deepEqual(doneIds(server.doc.solutions.demo), ['s1', 's2'])

  // Phone signs in (first sign-in on this device), opens s1, un-marks it.
  const phone = device(server, { stepId: 's1', hint: undefined, now: 1005000 })
  await phone.flush()
  assert.equal(phone.els.complete.getAttribute('aria-pressed'), 'true', 'the phone sees the laptop progress')
  phone.clock.now += 1000
  phone.els.complete.dispatch('click')
  await phone.flush()
  assert.deepEqual(doneIds(server.doc.solutions.demo), ['s2'])

  // Laptop comes back later with its stale copy (s1 still done) and a newer
  // visit, and syncs through the server.
  const back = device(server, { stepId: 's3', now: 1010000, localRaw: laptopStorage, dirty: true, sessionRaw: {} })
  await back.flush()
  assert.deepEqual(back.api.getState().solutions.demo.completedSteps, ['s2'], 'the un-mark won on the stale device')
  assert.deepEqual(doneIds(server.doc.solutions.demo), ['s2'], 'and the stale PUT did not resurrect it on the server')

  // Laptop re-marks s1 after that: the later mark wins everywhere.
  const again = device(server, { stepId: 's1', now: 1020000, localRaw: back.local.data })
  await again.flush()
  again.els.complete.dispatch('click')
  await again.flush()
  assert.deepEqual(doneIds(server.doc.solutions.demo), ['s1', 's2'])
  const phoneLater = device(server, { stepId: 's2', now: 1030000, localRaw: phone.local.data, sessionRaw: {} })
  await phoneLater.flush()
  assert.deepEqual(phoneLater.api.getState().solutions.demo.completedSteps.sort(), ['s1', 's2'])
})

test('a PUT answer that predates a mark made while it was in flight keeps the mark and stays dirty', async () => {
  let releasePut
  const puts = []
  const r = run({
    page: 'step',
    stepId: 's1',
    signedIn: true,
    hint: 'false', // first sign-in on this device: PUT on load
    localStore: { v: 2, updatedAt: 500, solutions: { demo: { steps: { s2: { done: true, at: 500 } }, currentStep: 's2', startedAt: 400, updatedAt: 500, completedAt: null, solutionVersion: V } } },
    fetch: (url, init, fallback) => {
      const method = (init && init.method) || 'GET'
      if (url === '/solutions/progress' && method === 'PUT') {
        const sent = JSON.parse(init.body)
        puts.push(sent)
        // The first PUT is held until the test releases it, and answers with
        // exactly what was sent (the server had nothing else).
        if (puts.length === 1) return new Promise((resolve) => { releasePut = () => resolve({ status: 200, ok: true, json: () => Promise.resolve({ progress: sent }) }) })
        return { status: 200, ok: true, json: () => Promise.resolve({ progress: sent }) }
      }
      return fallback(url, init)
    },
  })
  await r.flush()
  assert.equal(puts.length, 1, 'first-sign-in PUT in flight')
  assert.equal(puts[0].solutions.demo.steps.s1, undefined, 'it was sent before s1 was marked')

  // Mark s1 while the PUT is outstanding, then let the stale answer land.
  r.clock.now += 100
  r.els.complete.dispatch('click')
  releasePut()
  await r.flush()

  assert.deepEqual(r.api.getState().solutions.demo.completedSteps.sort(), ['s1', 's2'], 'the stale answer did not drop s1')
  assert.ok(puts.length >= 2, 'sent again')
  assert.equal(puts[puts.length - 1].solutions.demo.steps.s1.done, true, 'with s1 in it')
  assert.equal(DIRTY_KEY in r.local.data, false, 'clean once the follow-up PUT landed')
})

test('two signed-out tabs: each write merges what the other tab stored, and a storage event re-renders', () => {
  const a = run({ page: 'step', stepId: 's1' })
  const b = run({ page: 'step', stepId: 's2', sharedLocal: a.local })
  // Both tabs are open; A marks s1, then B (whose memory predates that) marks s2.
  a.els.complete.dispatch('click')
  b.clock.now += 10
  b.els.complete.dispatch('click')
  const stored = JSON.parse(a.local.data[STORE_KEY])
  assert.deepEqual(doneIds(stored.solutions.demo), ['s1', 's2'], 'B did not overwrite A')

  // A hears about B's write and shows it without a reload.
  assert.equal(a.els.count.textContent, '1 of 3', 'A has not re-read yet')
  a.fire('storage', { key: STORE_KEY })
  assert.equal(a.els.count.textContent, '2 of 3')
  // Unrelated keys are ignored.
  a.fire('storage', { key: 'something-else' })
  assert.equal(a.els.count.textContent, '2 of 3')
})

test('back-forward cache: a persisted pageshow re-reads storage and re-renders; a normal one does nothing', () => {
  const a = run({ page: 'overview' })
  assert.equal(a.els.count.textContent, '0 of 3')
  // Another page (same storage) marked two steps while this one sat in bfcache.
  a.local.data[STORE_KEY] = JSON.stringify({ v: 2, updatedAt: 5, solutions: { demo: { steps: { s1: { done: true, at: 5 }, s2: { done: true, at: 5 } }, currentStep: 's2', startedAt: 1, updatedAt: 5, completedAt: null, solutionVersion: V } } })
  a.fire('pageshow', { persisted: false })
  assert.equal(a.els.count.textContent, '0 of 3', 'a fresh load is not a restore')
  a.fire('pageshow', { persisted: true })
  assert.equal(a.els.count.textContent, '2 of 3')
  assert.equal(a.els.start.getAttribute('href'), '/solutions/demo/s3/')
})

test('sign-out keeps progress that never reached the account, and clears synced progress', () => {
  const stored = { v: 2, updatedAt: 5, solutions: { demo: { steps: { s1: { done: true, at: 5 } }, currentStep: 's1', startedAt: 1, updatedAt: 5, completedAt: null, solutionVersion: V } } }
  const dirty = run({ page: 'none', signedIn: false, hint: 'true', dirty: true, localStore: stored })
  assert.deepEqual(dirty.api.getState().solutions.demo.completedSteps, ['s1'], 'unsynced progress kept on the device')
  assert.equal(dirty.local.data[DIRTY_KEY], '1', 'still owed to the account on the next sign-in')
  const clean = run({ page: 'none', signedIn: false, hint: 'true', localStore: stored })
  assert.deepEqual(clean.api.getState().solutions, {}, 'synced progress is cleared from a possibly shared device')
})

test('v1 local stores are migrated on read', () => {
  const r = run({
    page: 'overview',
    localStore: { v: 1, updatedAt: 5, solutions: { demo: { completedSteps: ['s1', 's2'], currentStep: 's2', startedAt: 1, updatedAt: 5, completedAt: null, solutionVersion: V } } },
  })
  assert.equal(r.els.count.textContent, '2 of 3')
  const state = r.api.getState()
  assert.equal(state.v, 2)
  assert.equal(state.solutions.demo.steps.s1.done, true)
  assert.equal(state.solutions.demo.steps.s1.at, 5)
})
