/**
 * Preferences in the progress store (28-solution-progress.js): the platform
 * the reader last picked. The merge rules are the
 * shared fixture's (store.test.js runs every vector); these cover the store
 * API, what goes over the wire, and sign-in and sign-out.
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const { run, STORE_KEY } = require('./helpers/run')

test('setPref stores a platform stamped now, and getPrefs reads it back', () => {
  const r = run({ page: 'none' })
  assert.deepEqual(r.api.getPrefs(), {})
  assert.equal(r.api.setPref('platform', 'kubernetes'), true)
  assert.deepEqual(r.api.getPrefs(), { platform: { value: 'kubernetes', at: r.clock.now } })
  assert.deepEqual(r.storedStore().prefs, r.api.getPrefs(), 'persisted in localStorage')
})

test('a second edit in the same millisecond is stamped after the first, so it wins', () => {
  const r = run({ page: 'none' })
  r.api.setPref('platform', 'local')
  r.api.setPref('platform', 'cloud')
  assert.deepEqual(r.api.getPrefs().platform, { value: 'cloud', at: r.clock.now + 1 })
})

test('setPref rejects invalid values and stores nothing', () => {
  const r = run({ page: 'none' })
  assert.equal(r.api.setPref('platform', 'windows'), false)
  assert.equal(r.api.setPref('cloud', { bootstrap: 'a.example.com:9092' }), false, 'no cloud preference')
  assert.equal(r.api.setPref('theme', 'dark'), false)
  assert.deepEqual(r.api.getPrefs(), {})
  assert.equal(r.storedStore(), null, 'nothing written')
})

test('a stored cloud entry from an earlier client is dropped on read', () => {
  const stored = { v: 2, updatedAt: 0, solutions: {}, prefs: { platform: { value: 'local', at: 1 }, cloud: { bootstrap: 'a.example.com:9092', schemaRegistry: null, user: 'ada', at: 1 } } }
  const r = run({ page: 'none', localStore: stored })
  assert.deepEqual(r.api.getPrefs(), { platform: { value: 'local', at: 1 } })
})

test('a store without prefs reads as before, and no prefs key appears', () => {
  const stored = { v: 2, updatedAt: 5, solutions: { demo: { steps: { s1: { done: true, at: 5 } }, updatedAt: 5 } } }
  const r = run({ page: 'none', localStore: stored })
  assert.deepEqual(r.api.getPrefs(), {})
  assert.equal('prefs' in r.api.getState(), false)
})

test('signed in, a preference change is PUT with the progress after the debounce', async () => {
  const r = run({ page: 'none', signedIn: true, hint: 'true' })
  await r.flush()
  r.api.setPref('platform', 'kubernetes')
  await r.flush()
  const puts = r.puts()
  assert.equal(puts.length, 1)
  assert.deepEqual(puts[0].body.prefs, { platform: { value: 'kubernetes', at: r.clock.now } })
})

test('a PUT with no prefs sends no prefs key, so the server keeps what it has', async () => {
  const r = run({ page: 'none', signedIn: true, hint: 'true', dirty: true, localStore: { v: 2, updatedAt: 5, solutions: { demo: { steps: { s1: { done: true, at: 5 } }, updatedAt: 5 } } } })
  await r.flush()
  assert.equal(r.puts().length, 1)
  assert.equal('prefs' in r.puts()[0].body, false)
})

test('signing in merges the account prefs: the later entry wins', async () => {
  const local = { v: 2, updatedAt: 0, solutions: {}, prefs: { platform: { value: 'local', at: 1000 } } }
  const remote = { v: 2, updatedAt: 0, solutions: {}, prefs: { platform: { value: 'kubernetes', at: 2000 } } }
  const r = run({ page: 'none', signedIn: true, hint: 'true', localStore: local, remote })
  await r.flush()
  assert.deepEqual(r.api.getPrefs(), { platform: remote.prefs.platform })
})

test('an old server answer without prefs never erases local ones', async () => {
  const local = { v: 2, updatedAt: 0, solutions: {}, prefs: { platform: { value: 'cloud', at: 1000 } } }
  const r = run({
    page: 'none',
    signedIn: true,
    localStore: local,
    remote: { v: 2, updatedAt: 0, solutions: {} },
    putResponse: (sent) => ({ progress: { v: 2, updatedAt: sent.updatedAt, solutions: sent.solutions } }),
  })
  await r.flush()
  assert.equal(r.puts().length, 1, 'first sign-in uploads')
  assert.deepEqual(r.api.getPrefs(), local.prefs)
})

test('sign-out clears synced preferences from the device along with progress', () => {
  const stored = { v: 2, updatedAt: 0, solutions: {}, prefs: { platform: { value: 'kubernetes', at: 1 } } }
  const r = run({ page: 'none', signedIn: false, hint: 'true', localStore: stored })
  assert.deepEqual(r.api.getPrefs(), {})
  assert.equal(STORE_KEY in r.local.data, false)
})
