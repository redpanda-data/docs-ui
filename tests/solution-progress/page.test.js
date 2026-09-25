/**
 * What the reader sees: both Mark step complete buttons and every header chip
 * agree, Continue goes to the first step not done, completedAt follows the
 * step list, the finish card reaches narrow screens, Start again really
 * resets (after an in-page confirm), progress bars have accessible text, the
 * page survives blocked storage, download errors come back as a message, and
 * draft solutions do not offer a download that can only fail.
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const { run, doneIds, STORE_KEY, DIRTY_KEY } = require('./helpers/run')

const V = 'v1.0.0'
const rec = (steps, extra) => Object.assign({ steps, currentStep: null, startedAt: 1, updatedAt: 50, completedAt: null, solutionVersion: V }, extra || {})
const storeOf = (record) => ({ v: 2, updatedAt: record.updatedAt, solutions: { demo: record } })
const ALL_DONE = { s1: { done: true, at: 10 }, s2: { done: true, at: 20 }, s3: { done: true, at: 30 } }

test('both Mark step complete buttons, in live DOM order, and every header chip follow the step state', () => {
  const r = run({ page: 'step', stepId: 's1', actionRow: true })
  // The action row copy comes first in the DOM; the reader at >=1281px clicks
  // the rail copy.
  r.els.complete.dispatch('click')
  for (const [button, label] of [[r.els.complete, r.els.completeLabel], [r.els.rowComplete, r.els.rowCompleteLabel]]) {
    assert.equal(button.getAttribute('aria-pressed'), 'true')
    assert.equal(label.textContent, 'Completed')
  }
  assert.equal(r.els.headerStatus.hidden, false)
  assert.equal(r.els.headerStatus2.hidden, false)

  // A second click (from the other copy) undoes it, and both copies say so.
  r.clock.now += 1
  r.els.rowComplete.dispatch('click')
  for (const [button, label] of [[r.els.complete, r.els.completeLabel], [r.els.rowComplete, r.els.rowCompleteLabel]]) {
    assert.equal(button.getAttribute('aria-pressed'), 'false')
    assert.equal(label.textContent, 'Mark step complete')
  }
  assert.equal(r.els.headerStatus.hidden, true)
  assert.equal(r.els.headerStatus2.hidden, true)
})

test('overview Continue points at the first step not done, not the step just finished', () => {
  const r = run({ page: 'overview', localStore: storeOf(rec({ s1: { done: true, at: 10 }, s2: { done: true, at: 20 } }, { currentStep: 's2' })) })
  assert.equal(r.els.startLabel.textContent, 'Continue')
  assert.equal(r.els.start.getAttribute('href'), '/solutions/demo/s3/')
  // A gap earlier in the list comes first.
  const gap = run({ page: 'overview', localStore: storeOf(rec({ s2: { done: true, at: 20 }, s3: { done: true, at: 30 } }, { currentStep: 's3' })) })
  assert.equal(gap.els.start.getAttribute('href'), '/solutions/demo/s1/')
})

test('completedAt follows the step list: a completion of an older version is replaced when this one is finished', () => {
  // Finished v0.9.0 (two steps); v1.0.0 has three.
  const old = storeOf(rec({ s1: { done: true, at: 10 }, s2: { done: true, at: 20 } }, { completedAt: 20, solutionVersion: 'v0.9.0' }))
  const r = run({ page: 'step', stepId: 's3', localStore: old })
  assert.equal(r.els.state.textContent, 'In progress', 'not complete against this step list')
  assert.equal(r.els.done.hidden, true)
  r.clock.now += 1000
  r.els.complete.dispatch('click')
  const record = r.api.getState().solutions.demo
  assert.equal(record.solutionVersion, V)
  assert.equal(record.completedAt, r.clock.now, 'stamped for this version, not left at the old completion')
  assert.equal(r.calls.heap.filter((e) => e.name === 'solution_complete').length, 1, 'and it counts as finishing')
  assert.equal(r.els.done.hidden, false)
})

test('completedAt is stamped on load when every step is done but none was recorded, and un-marking clears it', () => {
  const merged = run({ page: 'step', stepId: 's2', localStore: storeOf(rec(ALL_DONE)) })
  assert.equal(merged.api.getState().solutions.demo.completedAt, 30, 'the latest step change, so every device agrees')
  merged.clock.now += 1
  merged.els.complete.dispatch('click')
  assert.equal(merged.api.getState().solutions.demo.completedAt, null)
  merged.clock.now += 1
  merged.els.complete.dispatch('click')
  assert.equal(merged.api.getState().solutions.demo.completedAt, merged.clock.now)
  const overview = run({ page: 'overview', localStore: storeOf(rec(ALL_DONE)) })
  assert.equal(overview.api.getState().solutions.demo.completedAt, 30)
  assert.equal(overview.local.data[DIRTY_KEY], '1', 'owed to the account')
})

test('narrow screens show the finish card in the action row; wide screens keep it in the rail only', () => {
  const narrow = run({ page: 'step', stepId: 's3', actionRow: true, mobile: true, localStore: storeOf(rec(ALL_DONE, { completedAt: 30 })) })
  assert.equal(narrow.els.rowDone.hidden, false, 'inline copy shown')
  assert.equal(narrow.els.done.hidden, false)
  const wide = run({ page: 'step', stepId: 's3', actionRow: true, mobile: false, localStore: storeOf(rec(ALL_DONE, { completedAt: 30 })) })
  assert.equal(wide.els.rowDone.hidden, true, 'inline copy hidden where the rail is visible')
  assert.equal(wide.els.done.hidden, false)
  const unfinished = run({ page: 'step', stepId: 's1', actionRow: true, mobile: true })
  assert.equal(unfinished.els.rowDone.hidden, true)
})

test('on a narrow overview the rail opens for a reader who has finished', () => {
  const done = run({ page: 'overview', mobile: true, localStore: storeOf(rec(ALL_DONE, { completedAt: 30 })) })
  assert.equal(done.els.rail.open, true)
  const partway = run({ page: 'overview', mobile: true, localStore: storeOf(rec({ s1: { done: true, at: 10 } })) })
  assert.equal(partway.els.rail.open, false)
})

test('Start again asks in the page, then clears every step and goes to step 1', async () => {
  const r = run({ page: 'overview', signedIn: true, hint: 'true', localStore: storeOf(rec(ALL_DONE, { completedAt: 30 })) })
  await r.flush()
  assert.equal(r.els.startLabel.textContent, 'Start again')
  assert.equal(r.els.start.getAttribute('href'), '/solutions/demo/s1/')

  const ev = r.els.start.dispatch('click')
  assert.equal(ev.defaultPrevented, true, 'no navigation before the reader confirms')
  const confirm = r.els.body.querySelector('[data-sol-reset-confirm]')
  assert.ok(confirm, 'inline confirm shown')
  assert.equal(confirm.getAttribute('role'), 'group')
  assert.equal(r.api.getState().solutions.demo.completedSteps.length, 3, 'nothing cleared yet')

  // Cancel leaves everything alone.
  r.els.body.querySelector('[data-sol-reset-no]').dispatch('click')
  assert.equal(r.els.body.querySelector('[data-sol-reset-confirm]'), null)
  assert.equal(r.api.getState().solutions.demo.completedSteps.length, 3)

  r.els.start.dispatch('click')
  r.clock.now += 1000
  r.els.body.querySelector('[data-sol-reset-yes]').dispatch('click')
  const state = r.api.getState().solutions.demo
  assert.deepEqual(state.completedSteps, [])
  assert.equal(state.completedAt, null)
  assert.equal(state.steps.s1.done, false, 'recorded as un-marks, so the reset survives a merge')
  assert.deepEqual(r.calls.assign, ['/solutions/demo/s1/'])
  await r.flush()
  const put = r.puts()[r.puts().length - 1]
  assert.deepEqual(doneIds(put.body.solutions.demo), [], 'the reset reached the account')
  // And a stale copy of the old progress merged afterwards does not undo it.
  const merged = r.api.merge(storeOf(rec(ALL_DONE, { completedAt: 30 })), r.api.getState())
  assert.deepEqual(doneIds(merged.solutions.demo), [])
})

test('progress bars carry value text', () => {
  const r = run({ page: 'step', stepId: 's1', actionRow: true })
  r.els.complete.dispatch('click')
  assert.equal(r.els.bar.getAttribute('aria-valuetext'), '1 of 3 steps complete')
  assert.equal(r.els.rowBar.getAttribute('aria-valuetext'), '1 of 3 steps complete')
  assert.equal(r.els.bar.getAttribute('aria-valuenow'), '1')
})

test('a storage getter that throws does not stop the script, and the page says progress is not saved', () => {
  let r
  assert.doesNotThrow(() => { r = run({ page: 'step', stepId: 's1', storageGetterThrows: true }) })
  assert.equal(typeof r.api.getState, 'function', 'the API was installed, so the rest of site.js runs too')
  r.els.complete.dispatch('click')
  assert.equal(r.els.count.textContent, '1 of 3', 'works from memory')
  assert.equal(r.controls().length, 0, 'download controls hidden (no auth), without throwing')
  assert.match(r.els.sync.textContent, /Not saved/, 'no false "Saved on this device"')
  assert.ok(r.els.sync.classes.has('is-error'))
})

test('"Saved on this device" only when the write landed', () => {
  const ok = run({ page: 'step', stepId: 's1' })
  ok.els.complete.dispatch('click')
  assert.equal(ok.els.sync.textContent, 'Saved on this device')
  const blocked = run({ page: 'step', stepId: 's1', storageThrows: true })
  blocked.els.complete.dispatch('click')
  assert.match(blocked.els.sync.textContent, /Not saved/)
})

test('a download error sent back by docs-site becomes a message that points at the build-along files', () => {
  const r = run({ page: 'step', stepId: 's1', search: '?download_error=bundle_not_ready&x=1' })
  const toast = r.toasts()[0]
  assert.ok(toast, 'message shown')
  assert.equal(toast.getAttribute('role'), 'alert')
  assert.match(toast.textContent, /not ready to download yet/)
  assert.match(toast.textContent, /build along/)
  assert.deepEqual(r.calls.replaceState, ['/solutions/demo/s1/?x=1'], 'the code is stripped from the URL')
  const unknown = run({ page: 'step', stepId: 's1', search: '?download_error=<script>' })
  assert.match(unknown.toasts()[0].textContent, /did not work/)
  assert.equal(unknown.calls.heap.find((e) => e.name === 'solution_download_error').props.error, 'unknown')
})

test('a draft solution labels the download as not released yet and offers no file controls', () => {
  const r = run({ page: 'overview', status: 'draft', accountHidden: false })
  assert.equal(r.els.download.getAttribute('href'), null)
  assert.equal(r.els.download.getAttribute('aria-disabled'), 'true')
  assert.equal(r.els.download.textContent, 'Download available at release')
  assert.equal(r.controls().length, 0)
  const ev = r.els.download.dispatch('click')
  assert.equal(ev.defaultPrevented, true)
  assert.equal(r.signinEvents().length, 0, 'no sign-in for a download that cannot happen')
  const published = run({ page: 'overview', accountHidden: false })
  assert.ok(published.els.download.getAttribute('href'))
  assert.ok(published.controls().length > 0)
})

test('back from a sign-in trip docs-site started (no pending record in this tab): a message, not silence', () => {
  const r = run({ page: 'step', stepId: 's1', signedIn: true, hint: 'true', search: '?intent=download&version=v1.0.0' })
  assert.equal(r.calls.assign.length, 0, 'still no automatic download')
  assert.match(r.toasts()[0].textContent, /signed in\. Select Download/)
  const file = run({ page: 'step', stepId: 's1', signedIn: true, hint: 'true', search: '?intent=download&version=v1.0.0&path=docker-compose.yml' })
  assert.match(file.toasts()[0].textContent, /docker-compose\.yml/)
})

test('the stored document never carries the derived completedSteps list', () => {
  const r = run({ page: 'step', stepId: 's1' })
  r.els.complete.dispatch('click')
  const stored = JSON.parse(r.local.data[STORE_KEY])
  assert.equal(stored.v, 2)
  assert.equal('completedSteps' in stored.solutions.demo, false)
  assert.deepEqual(r.api.getRecord('demo').completedSteps, ['s1'], 'but readers of the API still get it')
})
