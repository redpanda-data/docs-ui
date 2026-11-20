/**
 * Returning from sign-in with ?intent=save|download (the return_to built by
 * the gates). The params must be consumed exactly once, the download must
 * only start for a fresh pending intent from this tab, and nothing happens
 * for a reader who came back signed out.
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const { run, PENDING_KEY } = require('./helpers/run')

const NOW = 1700000000000
const pending = (intent, at) => ({ intent, solution: 'demo', step: 's1', version: 'v1.0.0', at: at === undefined ? NOW - 1000 : at })

test('intent=save while signed in: PUTs, toasts "Progress saved", strips the params', async () => {
  const r = run({ signedIn: true, hint: 'true', search: '?intent=save&step=s1', pending: pending('save'), now: NOW })
  await r.flush()
  assert.ok(r.puts().length >= 1, 'progress pushed to the account')
  assert.equal(r.toasts().length, 1)
  assert.equal(r.toasts()[0].textContent, 'Progress saved')
  assert.deepEqual(r.calls.replaceState, ['/solutions/demo/s1/'], 'intent and step params stripped')
  assert.equal(PENDING_KEY in r.session.data, false, 'pending intent consumed')
  assert.ok(r.calls.heap.some((e) => e.name === 'solution_save_progress' && e.props.intent === 'return'))
})

test('intent=download while signed in with a fresh pending intent: navigates to the download once', async () => {
  const r = run({ signedIn: true, hint: 'true', search: '?intent=download&step=s1&version=v1.0.0', pending: pending('download'), now: NOW })
  await r.flush()
  assert.equal(r.calls.assign.length, 1, 'exactly one navigation')
  assert.equal(r.calls.assign[0], r.els.download.getAttribute('href'), 'uses the rendered download link')
  assert.deepEqual(r.calls.replaceState, ['/solutions/demo/s1/'])
  assert.ok(r.calls.heap.some((e) => e.name === 'solution_download' && e.props.source === 'intent'))
})

test('intent=download without a pending intent (bookmarked or shared URL) does not download', async () => {
  const r = run({ signedIn: true, hint: 'true', search: '?intent=download&step=s1&version=v1.0.0', now: NOW })
  await r.flush()
  assert.equal(r.calls.assign.length, 0)
  assert.deepEqual(r.calls.replaceState, ['/solutions/demo/s1/'], 'params still stripped')
})

test('a pending intent older than 15 minutes is expired', async () => {
  const r = run({ signedIn: true, hint: 'true', search: '?intent=download&step=s1', pending: pending('download', NOW - 16 * 60 * 1000), now: NOW })
  await r.flush()
  assert.equal(r.calls.assign.length, 0)
  assert.equal(PENDING_KEY in r.session.data, false, 'stale intent discarded')
})

test('a pending intent for a different solution or intent does not match', async () => {
  const other = Object.assign(pending('download'), { solution: 'other' })
  const r = run({ signedIn: true, hint: 'true', search: '?intent=download&step=s1', pending: other, now: NOW })
  await r.flush()
  assert.equal(r.calls.assign.length, 0)
  const mismatch = run({ signedIn: true, hint: 'true', search: '?intent=download&step=s1', pending: pending('save'), now: NOW })
  await mismatch.flush()
  assert.equal(mismatch.calls.assign.length, 0)
})

test('coming back signed out: params stripped, nothing else happens', async () => {
  const r = run({ signedIn: false, search: '?intent=download&step=s1&version=v1.0.0', pending: pending('download'), now: NOW })
  await r.flush()
  assert.equal(r.calls.assign.length, 0)
  assert.equal(r.calls.fetch.length, 0)
  assert.equal(r.toasts().length, 0)
  assert.deepEqual(r.calls.replaceState, ['/solutions/demo/s1/'])
})

test('other query params survive the strip', async () => {
  const r = run({ signedIn: true, hint: 'true', search: '?utm_source=x&intent=save&step=s1', pending: pending('save'), now: NOW })
  await r.flush()
  assert.deepEqual(r.calls.replaceState, ['/solutions/demo/s1/?utm_source=x'])
})

test('no intent param: history is left alone', async () => {
  const r = run({ signedIn: true, hint: 'true', search: '?utm_source=x', now: NOW })
  await r.flush()
  assert.deepEqual(r.calls.replaceState, [])
  assert.equal(r.calls.assign.length, 0)
})

test('the pending intent written by the gate is what the return path expects', async () => {
  const gate = run({ signedIn: false, accountHidden: false, now: NOW })
  gate.els.download.dispatch('click')
  const stored = JSON.parse(gate.session.data[PENDING_KEY])
  assert.deepEqual(stored, { intent: 'download', solution: 'demo', step: 's1', version: 'v1.0.0', at: NOW })

  // Same browser tab, back from sign-in with the return_to the gate built.
  const detail = gate.signinEvents()[0].detail
  const [pathname, search] = detail.returnTo.split('?')
  const back = run({ signedIn: true, pathname, search: '?' + search, sessionRaw: gate.session.data, now: NOW + 60000 })
  await back.flush()
  assert.equal(back.calls.assign.length, 1, 'download starts on return')
})
