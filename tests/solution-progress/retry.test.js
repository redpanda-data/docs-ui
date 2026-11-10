/**
 * Server failures must never lose anonymous progress: a failed GET or PUT
 * keeps the local store and the dirty flag, and the next load retries.
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const { run, doneIds, DIRTY_KEY, HINT_KEY } = require('./helpers/run')

const LOCAL = { v: 1, updatedAt: 2000, solutions: { demo: { completedSteps: ['s1'], currentStep: 's1', startedAt: 1000, updatedAt: 2000, completedAt: null, solutionVersion: 'v1.0.0' } } }

function failingPut (status) {
  return (url, init, fallback) => ((init && init.method) === 'PUT'
    ? { status, ok: false, json: () => Promise.resolve({ error: 'nope' }) }
    : fallback(url, init))
}

for (const status of [409, 429, 503]) {
  test('PUT ' + status + ' on first sign-in keeps local state and the dirty flag, and the next load retries', async () => {
    const first = run({ page: 'none', signedIn: true, localStore: LOCAL, fetch: failingPut(status) })
    await first.flush()
    assert.equal(first.puts().length, 1, 'the upload was attempted')
    assert.deepEqual(first.api.getState().solutions.demo.completedSteps, ['s1'], 'local progress kept')
    assert.equal(first.local.data[DIRTY_KEY], '1', 'still dirty')
    assert.equal(first.local.data[HINT_KEY], 'true')

    // Next load, server healthy. Not a "first sign-in" any more, but dirty.
    const second = run({ page: 'none', signedIn: true, localRaw: first.local.data, sessionRaw: first.session.data })
    await second.flush()
    assert.equal(second.puts().length, 1, 'retried')
    assert.deepEqual(doneIds(second.puts()[0].body.solutions.demo), ['s1'])
    assert.equal(DIRTY_KEY in second.local.data, false, 'clean after success')
  })
}

test('GET 503 on first sign-in keeps local state, does not PUT, and the next load uploads', async () => {
  const first = run({
    page: 'none',
    signedIn: true,
    localStore: LOCAL,
    fetch: (url, init, fallback) => (((init && init.method) || 'GET') === 'GET' && url === '/solutions/progress'
      ? { status: 503, ok: false, json: () => Promise.resolve({}) }
      : fallback(url, init)),
  })
  await first.flush()
  assert.equal(first.gets().length, 1)
  assert.equal(first.puts().length, 0, 'never PUT over an unknown server state')
  assert.deepEqual(first.api.getState().solutions.demo.completedSteps, ['s1'])
  assert.equal(first.local.data[DIRTY_KEY], '1', 'the upload is still owed')

  const second = run({ page: 'none', signedIn: true, localRaw: first.local.data, sessionRaw: first.session.data })
  await second.flush()
  assert.equal(second.gets().length, 1, 'no cache entry was written for the failure, so it refetches')
  assert.equal(second.puts().length, 1, 'anonymous progress finally uploaded')
})

test('a network error on PUT keeps the dirty flag', async () => {
  const r = run({
    page: 'none',
    signedIn: true,
    hint: 'true',
    dirty: true,
    localStore: LOCAL,
    fetch: (url, init, fallback) => ((init && init.method) === 'PUT' ? 'network-error' : fallback(url, init)),
  })
  await r.flush()
  assert.equal(r.puts().length, 1)
  assert.equal(r.local.data[DIRTY_KEY], '1')
  assert.deepEqual(r.api.getState().solutions.demo.completedSteps, ['s1'])
})

test('a PUT answered with {progress: store} is adopted like a GET body', async () => {
  const r = run({
    page: 'none',
    signedIn: true,
    localStore: LOCAL,
    putResponse: (sent) => ({ ok: true, progress: Object.assign({}, sent, { solutions: Object.assign({}, sent.solutions, { fromserver: { completedSteps: ['a1'], currentStep: 'a1', startedAt: 1, updatedAt: 1, completedAt: null, solutionVersion: null } }) }) }),
  })
  await r.flush()
  assert.deepEqual(Object.keys(r.api.getState().solutions).sort(), ['demo', 'fromserver'], 'server answer replaced local')
  const cached = JSON.parse(r.session.data['docs-solutions-progress-remote'])
  assert.ok(cached.store.solutions.fromserver, 'remote cache updated from the PUT response')
})
