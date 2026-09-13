/**
 * Local progress store in src/js/28-solution-progress.js: the merge contract
 * shared with docs-site (fixtures/merge-vectors.json), caps, fail-closed
 * storage, the version-changed notice, sign-out clearing local state, and the
 * first-sign-in PUT.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { run, STORE_KEY, HINT_KEY, DIRTY_KEY } = require('./helpers/run')

const VECTORS = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/merge-vectors.json'), 'utf8'))

test('the shared fixture has enough vectors to be a contract', () => {
  assert.ok(VECTORS.vectors.length >= 8, 'at least 8 vectors')
  assert.ok(Array.isArray(VECTORS.rules) && VECTORS.rules.length >= 5)
  const names = new Set(VECTORS.vectors.map((v) => v.name))
  assert.equal(names.size, VECTORS.vectors.length, 'vector names are unique')
})

for (const vector of VECTORS.vectors) {
  test('merge vector: ' + vector.name, () => {
    const { api } = run({ page: 'none' })
    assert.deepEqual(api.merge(vector.local, vector.remote), vector.expected)
  })
}

test('merge is deterministic and idempotent on its own output', () => {
  const { api } = run({ page: 'none' })
  for (const vector of VECTORS.vectors) {
    const once = api.merge(vector.local, vector.remote)
    assert.deepEqual(api.merge(once, once), once, vector.name + ': merging a store with itself is a no-op')
    assert.deepEqual(api.merge(once, vector.remote), once, vector.name + ': re-merging the remote side changes nothing')
  }
})

test('the API is exposed on every page, not only solution pages', () => {
  const { api } = run({ page: 'none' })
  assert.equal(typeof api.getState, 'function')
  assert.equal(typeof api.markComplete, 'function')
  assert.equal(typeof api.setCurrent, 'function')
  assert.equal(typeof api.save, 'function')
  assert.equal(typeof api.merge, 'function')
  assert.equal(typeof api.track, 'function')
  assert.deepEqual(api.getState(), { v: 1, updatedAt: 0, solutions: {} })
})

test('caps: more than 50 solutions evicts the least recently updated', () => {
  const solutions = {}
  for (let i = 1; i <= 55; i++) {
    solutions['sol-' + i] = { completedSteps: ['s1'], currentStep: 's1', startedAt: i, updatedAt: i * 10, completedAt: null, solutionVersion: 'v1.0.0' }
  }
  const { api } = run({ page: 'none', localStore: { v: 1, updatedAt: 550, solutions } })
  const state = api.getState()
  const ids = Object.keys(state.solutions)
  assert.equal(ids.length, 50)
  assert.ok(!('sol-1' in state.solutions), 'oldest evicted')
  assert.ok(!('sol-5' in state.solutions), 'the five oldest are gone')
  assert.ok('sol-6' in state.solutions && 'sol-55' in state.solutions, 'newest 50 kept')
})

test('caps: a record keeps at most the last 100 completed steps', () => {
  const steps = []
  for (let i = 1; i <= 120; i++) steps.push('step-' + i)
  const { api } = run({
    page: 'none',
    localStore: { v: 1, updatedAt: 1, solutions: { demo: { completedSteps: steps, currentStep: 'step-120', startedAt: 1, updatedAt: 1, completedAt: null, solutionVersion: 'v1' } } },
  })
  const record = api.getState().solutions.demo
  assert.equal(record.completedSteps.length, 100)
  assert.equal(record.completedSteps[0], 'step-21', 'the oldest 20 were dropped')
  assert.equal(record.completedSteps[99], 'step-120')
})

test('malformed storage is treated as empty rather than thrown', () => {
  const { api } = run({ page: 'none', localRaw: { [STORE_KEY]: '{not json' } })
  assert.deepEqual(api.getState(), { v: 1, updatedAt: 0, solutions: {} })
  const { api: api2 } = run({ page: 'none', localRaw: { [STORE_KEY]: JSON.stringify({ v: 1, solutions: { demo: 'nope', ok: { completedSteps: 'x', updatedAt: 5 } } }) } })
  assert.deepEqual(Object.keys(api2.getState().solutions), ['ok'], 'bad records dropped, salvageable ones normalized')
  assert.deepEqual(api2.getState().solutions.ok.completedSteps, [])
})

test('fails closed when storage throws: empty state, in-memory progress, no exception', () => {
  const overview = run({ page: 'overview', storageThrows: true })
  assert.deepEqual(overview.api.getState(), { v: 1, updatedAt: 0, solutions: {} }, 'unreadable storage reads as empty')
  assert.equal(overview.els.count.textContent, '0 of 3')

  const step = run({ page: 'step', stepId: 's1', storageThrows: true })
  assert.doesNotThrow(() => step.els.complete.dispatch('click'))
  const record = step.api.getState().solutions.demo
  assert.ok(record, 'the page keeps working from memory')
  assert.deepEqual(record.completedSteps, ['s1'])
  assert.equal(step.els.count.textContent, '1 of 3', 'the UI reflects the in-memory state')
  assert.equal(Object.keys(step.local.data).length, 0, 'nothing was written')
})

test('loading a step only records it as current; nothing is marked complete implicitly', () => {
  const { api, els } = run({ page: 'step', stepId: 's2' })
  const record = api.getState().solutions.demo
  assert.equal(record.currentStep, 's2')
  assert.deepEqual(record.completedSteps, [])
  assert.ok(record.startedAt > 0, 'first view starts the solution')
  assert.equal(els.count.textContent, '0 of 3')
  assert.equal(els.state.textContent, 'In progress')
})

test('an explicit mark-complete click updates the record, the count and the ticks; a second click undoes it', () => {
  const { api, els } = run({ page: 'step', stepId: 's1' })
  els.complete.dispatch('click')
  let record = api.getState().solutions.demo
  assert.deepEqual(record.completedSteps, ['s1'])
  assert.equal(record.solutionVersion, 'v1.0.0')
  assert.equal(els.count.textContent, '1 of 3')
  assert.equal(els.complete.getAttribute('aria-pressed'), 'true')
  assert.equal(els.completeLabel.textContent, 'Completed')
  assert.ok(els.progressSteps.children[0].classes.has('is-complete'))
  assert.equal(els.fill.style.width, '33%')

  els.complete.dispatch('click')
  record = api.getState().solutions.demo
  assert.deepEqual(record.completedSteps, [])
  assert.equal(els.complete.getAttribute('aria-pressed'), 'false')
})

test('unknown step ids are kept but never counted', () => {
  const { api, els } = run({
    page: 'overview',
    localStore: { v: 1, updatedAt: 5, solutions: { demo: { completedSteps: ['ghost', 's1'], currentStep: 's1', startedAt: 1, updatedAt: 5, completedAt: null, solutionVersion: 'v1.0.0' } } },
  })
  assert.equal(els.count.textContent, '1 of 3')
  assert.deepEqual(api.getState().solutions.demo.completedSteps, ['ghost', 's1'], 'ghost survives for a future version')
})

test('completing the last step sets completedAt once and shows the done panel', () => {
  const { api, els, calls, clock } = run({
    page: 'step',
    stepId: 's3',
    localStore: { v: 1, updatedAt: 5, solutions: { demo: { completedSteps: ['s1', 's2'], currentStep: 's2', startedAt: 1000, updatedAt: 5, completedAt: null, solutionVersion: 'v1.0.0' } } },
  })
  assert.equal(els.done.hidden, true)
  els.complete.dispatch('click')
  const record = api.getState().solutions.demo
  assert.equal(record.completedAt, clock.now)
  assert.equal(els.done.hidden, false)
  assert.equal(els.state.textContent, 'Completed')
  const complete = calls.heap.find((e) => e.name === 'solution_complete')
  assert.ok(complete, 'solution_complete tracked')
  assert.equal(complete.props.duration_ms, clock.now - 1000)
  const dl = calls.heap.filter((e) => e.name === 'solution_complete')
  assert.equal(dl.length, 1)
})

test('version notice: shown once when the stored version differs from the page version', () => {
  const stored = { v: 1, updatedAt: 5, solutions: { demo: { completedSteps: ['s1'], currentStep: 's1', startedAt: 1, updatedAt: 5, completedAt: null, solutionVersion: 'v1.0.0' } } }
  const same = run({ page: 'overview', version: 'v1.0.0', localStore: stored })
  assert.equal(same.els.versionNotice.hidden, true, 'no notice when versions match')

  const changed = run({ page: 'overview', version: 'v1.1.0', localStore: stored })
  assert.equal(changed.els.versionNotice.hidden, false, 'notice shown on mismatch')
  assert.equal(changed.els.count.textContent, '1 of 3', 'progress is kept')

  changed.els.versionDismiss.dispatch('click')
  assert.equal(changed.els.versionNotice.hidden, true)

  const again = run({ page: 'overview', version: 'v1.1.0', localStore: stored, sessionRaw: changed.session.data })
  assert.equal(again.els.versionNotice.hidden, true, 'dismissed for the rest of the session')
})

test('sign-out (hint true -> false) clears local progress', () => {
  const stored = { v: 1, updatedAt: 5, solutions: { demo: { completedSteps: ['s1'], currentStep: 's1', startedAt: 1, updatedAt: 5, completedAt: null, solutionVersion: 'v1.0.0' } } }
  const { api, local } = run({ page: 'none', signedIn: false, hint: 'true', localStore: stored })
  assert.deepEqual(api.getState(), { v: 1, updatedAt: 0, solutions: {} })
  assert.equal(STORE_KEY in local.data, false, 'storage key removed')
  assert.equal(local.data[HINT_KEY], 'false')
})

test('anonymous browsing (hint false -> false) leaves local progress alone and never calls the server', async () => {
  const stored = { v: 1, updatedAt: 5, solutions: { demo: { completedSteps: ['s1'], currentStep: 's1', startedAt: 1, updatedAt: 5, completedAt: null, solutionVersion: 'v1.0.0' } } }
  const r = run({ page: 'none', signedIn: false, hint: 'false', localStore: stored })
  await r.flush()
  assert.deepEqual(r.api.getState().solutions.demo.completedSteps, ['s1'])
  assert.equal(r.calls.fetch.length, 0)
})

test('first sign-in: GET, then PUT the merged store, and the server answer replaces local', async () => {
  const local = { v: 1, updatedAt: 2000, solutions: { demo: { completedSteps: ['s1'], currentStep: 's1', startedAt: 1000, updatedAt: 2000, completedAt: null, solutionVersion: 'v1.0.0' } } }
  const remote = { v: 1, updatedAt: 3000, solutions: { demo: { completedSteps: ['s2'], currentStep: 's2', startedAt: 1500, updatedAt: 3000, completedAt: null, solutionVersion: 'v1.0.0' } } }
  const r = run({
    page: 'none',
    signedIn: true,
    localStore: local,
    remote,
    putResponse: (sent) => Object.assign({}, sent, { solutions: Object.assign({}, sent.solutions, { extra: { completedSteps: [], currentStep: 'x', startedAt: 1, updatedAt: 1, completedAt: null, solutionVersion: null } }) }),
  })
  await r.flush()

  assert.equal(r.gets().length, 1, 'one GET')
  const puts = r.puts()
  assert.equal(puts.length, 1, 'one PUT on first sign-in')
  const expected = r.api.merge(local, remote)
  assert.deepEqual(puts[0].body, { v: 1, updatedAt: expected.updatedAt, solutions: expected.solutions }, 'PUT payload is the merged store')
  assert.deepEqual(puts[0].body.solutions.demo.completedSteps, ['s1', 's2'], 'anonymous progress survives the first sign-in')
  assert.equal(puts[0].init.credentials, 'include')

  assert.ok('extra' in r.api.getState().solutions, 'server response replaced local')
  assert.equal(r.local.data[HINT_KEY], 'true')
  assert.equal(DIRTY_KEY in r.local.data, false, 'dirty flag cleared after a successful PUT')
})

test('already signed in and clean: GET merges into local, no PUT', async () => {
  const local = { v: 1, updatedAt: 2000, solutions: { demo: { completedSteps: ['s1'], currentStep: 's1', startedAt: 1000, updatedAt: 2000, completedAt: null, solutionVersion: 'v1.0.0' } } }
  const remote = { v: 1, updatedAt: 3000, solutions: { other: { completedSteps: ['a1'], currentStep: 'a1', startedAt: 1, updatedAt: 3000, completedAt: null, solutionVersion: 'v2.0.0' } } }
  const r = run({ page: 'none', signedIn: true, hint: 'true', localStore: local, remote })
  await r.flush()
  assert.equal(r.gets().length, 1)
  assert.equal(r.puts().length, 0)
  assert.deepEqual(Object.keys(r.api.getState().solutions).sort(), ['demo', 'other'])
})

test('already signed in but dirty: PUT after GET', async () => {
  const local = { v: 1, updatedAt: 2000, solutions: { demo: { completedSteps: ['s1'], currentStep: 's1', startedAt: 1000, updatedAt: 2000, completedAt: null, solutionVersion: 'v1.0.0' } } }
  const r = run({ page: 'none', signedIn: true, hint: 'true', dirty: true, localStore: local })
  await r.flush()
  assert.equal(r.puts().length, 1)
})

test('a 401 on GET leaves local state untouched and does not PUT', async () => {
  const local = { v: 1, updatedAt: 2000, solutions: { demo: { completedSteps: ['s1'], currentStep: 's1', startedAt: 1000, updatedAt: 2000, completedAt: null, solutionVersion: 'v1.0.0' } } }
  const r = run({
    page: 'none',
    signedIn: true,
    localStore: local,
    fetch: (url, init, fallback) => (init && init.method) === 'PUT' ? fallback(url, init) : { status: 401, ok: false, json: () => Promise.resolve({}) },
  })
  await r.flush()
  assert.equal(r.puts().length, 0)
  assert.deepEqual(r.api.getState().solutions.demo.completedSteps, ['s1'])
})

test('signed-in mutations are pushed after a debounce', async () => {
  const r = run({ page: 'step', stepId: 's1', signedIn: true, hint: 'true' })
  await r.flush()
  const before = r.puts().length
  r.els.complete.dispatch('click')
  assert.equal(r.puts().length, before, 'not sent synchronously')
  await r.flush()
  assert.equal(r.puts().length, before + 1, 'sent once the debounce timer fires')
  assert.deepEqual(r.puts()[r.puts().length - 1].body.solutions.demo.completedSteps, ['s1'])
})

test('the remote GET is cached for 60 seconds in sessionStorage', async () => {
  const r = run({ page: 'none', signedIn: true, hint: 'true' })
  await r.flush()
  assert.equal(r.gets().length, 1)
  const again = run({ page: 'none', signedIn: true, hint: 'true', sessionRaw: r.session.data, now: r.clock.now + 30000 })
  await again.flush()
  assert.equal(again.gets().length, 0, 'served from cache')
  const later = run({ page: 'none', signedIn: true, hint: 'true', sessionRaw: r.session.data, now: r.clock.now + 61000 })
  await later.flush()
  assert.equal(later.gets().length, 1, 'refetched after the TTL')
})

test('track() reaches heap and the dataLayer without PII', () => {
  const { api, calls, dataLayer } = run({ page: 'none' })
  api.track('solution_start', { solution_id: 'demo', email: undefined })
  assert.deepEqual(calls.heap, [{ name: 'solution_start', props: { solution_id: 'demo' } }])
  assert.deepEqual(dataLayer(), [{ event: 'solution_start', solution_id: 'demo' }])
  const noHeap = run({ page: 'none', heap: false })
  assert.doesNotThrow(() => noHeap.api.track('x', {}))
  assert.equal(noHeap.dataLayer().length, 1)
})
