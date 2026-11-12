/**
 * Preferences in the progress store (28-solution-progress.js): the platform
 * the reader last picked and the Your cluster values. The merge rules are the
 * shared fixture's (store.test.js runs every vector); these cover the store
 * API, what goes over the wire, and sign-in and sign-out.
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const { run, STORE_KEY } = require('./helpers/run')

const BS = 'seed-1a2b.byoc.prd.cloud.redpanda.com:9092'
const SR = 'https://schema-registry-1a2b.byoc.prd.cloud.redpanda.com:30081'

test('setPref stores a platform and a cloud entry, each stamped now, and getPrefs reads them back', () => {
  const r = run({ page: 'none' })
  assert.deepEqual(r.api.getPrefs(), {})
  assert.equal(r.api.setPref('platform', 'kubernetes'), true)
  assert.equal(r.api.setPref('cloud', { bootstrap: BS, schemaRegistry: SR, user: 'ada' }), true)
  assert.deepEqual(r.api.getPrefs(), {
    platform: { value: 'kubernetes', at: r.clock.now },
    cloud: { bootstrap: BS, schemaRegistry: SR, user: 'ada', at: r.clock.now },
  })
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
  assert.equal(r.api.setPref('cloud', { bootstrap: 'no-port.example.com' }), false)
  assert.equal(r.api.setPref('cloud', { schemaRegistry: 'http://sr.example.com' }), false)
  assert.equal(r.api.setPref('cloud', { user: '<b>ada</b>' }), false)
  assert.equal(r.api.setPref('cloud', { user: 'a'.repeat(257) }), false)
  assert.equal(r.api.setPref('theme', 'dark'), false)
  assert.deepEqual(r.api.getPrefs(), {})
  assert.equal(r.storedStore(), null, 'nothing written')
})

test('a password handed to setPref is never stored', () => {
  const r = run({ page: 'none' })
  assert.equal(r.api.setPref('cloud', { bootstrap: BS, user: 'ada', password: 'hunter2' }), true)
  assert.doesNotMatch(r.local.data[STORE_KEY], /hunter2|password/)
})

test('a clear is stored as nulls with a fresh time, not deleted', () => {
  const r = run({ page: 'none' })
  r.api.setPref('cloud', { bootstrap: BS })
  r.clock.now += 10
  r.api.setPref('cloud', {})
  assert.deepEqual(r.api.getPrefs().cloud, { bootstrap: null, schemaRegistry: null, user: null, at: r.clock.now })
})

test('validCloudValue applies the server checks field by field', () => {
  const r = run({ page: 'none' })
  assert.equal(r.api.validCloudValue('bootstrap', BS + ',' + BS), true)
  assert.equal(r.api.validCloudValue('bootstrap', 'host:65536'), false)
  assert.equal(r.api.validCloudValue('schemaRegistry', SR), true)
  assert.equal(r.api.validCloudValue('schemaRegistry', 'https://ada:pw@sr.example.com'), false)
  assert.equal(r.api.validCloudValue('user', 'svc.loader-01@example'), true)
  assert.equal(r.api.validCloudValue('user', 'ada; rm -rf ~'), false)
  assert.equal(r.api.validCloudValue('password', 'x'), false, 'there is no password field')
  assert.equal(r.api.validCloudValue('hasOwnProperty', 'x'), false)
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
  r.api.setPref('platform', 'cloud')
  r.api.setPref('cloud', { bootstrap: BS, user: 'ada' })
  await r.flush()
  const puts = r.puts()
  assert.equal(puts.length, 1)
  assert.deepEqual(puts[0].body.prefs, {
    platform: { value: 'cloud', at: r.clock.now },
    cloud: { bootstrap: BS, schemaRegistry: null, user: 'ada', at: r.clock.now },
  })
})

test('a PUT with no prefs sends no prefs key, so the server keeps what it has', async () => {
  const r = run({ page: 'none', signedIn: true, hint: 'true', dirty: true, localStore: { v: 2, updatedAt: 5, solutions: { demo: { steps: { s1: { done: true, at: 5 } }, updatedAt: 5 } } } })
  await r.flush()
  assert.equal(r.puts().length, 1)
  assert.equal('prefs' in r.puts()[0].body, false)
})

test('signing in merges the account prefs: the later entry wins on each side', async () => {
  const local = { v: 2, updatedAt: 0, solutions: {}, prefs: { platform: { value: 'local', at: 1000 }, cloud: { bootstrap: BS, schemaRegistry: null, user: null, at: 5000 } } }
  const remote = { v: 2, updatedAt: 0, solutions: {}, prefs: { platform: { value: 'kubernetes', at: 2000 }, cloud: { bootstrap: null, schemaRegistry: SR, user: 'grace', at: 4000 } } }
  const r = run({ page: 'none', signedIn: true, hint: 'true', localStore: local, remote })
  await r.flush()
  assert.deepEqual(r.api.getPrefs(), { platform: remote.prefs.platform, cloud: local.prefs.cloud })
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
  const stored = { v: 2, updatedAt: 0, solutions: {}, prefs: { cloud: { bootstrap: BS, schemaRegistry: null, user: 'ada', at: 1 } } }
  const r = run({ page: 'none', signedIn: false, hint: 'true', localStore: stored })
  assert.deepEqual(r.api.getPrefs(), {})
  assert.equal(STORE_KEY in r.local.data, false)
})
