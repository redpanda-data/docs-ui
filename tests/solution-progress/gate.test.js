/**
 * Auth gates: only Save and the authenticated download ask for sign-in.
 * Anonymous readers can start, mark steps and see progress; the gate opens
 * the shared header modal with task-specific copy and a return path carrying
 * the intent; when the account backend is unavailable the gate degrades to
 * "saved on this device" and the download CTA disappears.
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const { run, PENDING_KEY } = require('./helpers/run')

test('anonymous Save opens the sign-in modal with save copy and a save intent return path', () => {
  const r = run({ signedIn: false, accountHidden: false })
  r.els.save.dispatch('click')
  const events = r.signinEvents()
  assert.equal(events.length, 1)
  const detail = events[0].detail
  assert.equal(detail.title, 'Sign in to save your progress')
  assert.ok(detail.lead.length > 20)
  assert.equal(detail.cta, 'Sign in and save')
  assert.equal(detail.returnTo, '/solutions/demo/s1/?intent=save&step=s1')
  assert.equal(JSON.parse(r.session.data[PENDING_KEY]).intent, 'save')
  assert.equal(r.puts().length, 0, 'nothing is sent to the server anonymously')
  assert.ok(r.calls.heap.some((e) => e.name === 'solution_login_cta_click' && e.props.intent === 'save'))
})

test('anonymous click on the authenticated download is intercepted and opens the modal with a download intent', () => {
  const r = run({ signedIn: false, accountHidden: false })
  const ev = r.els.download.dispatch('click')
  assert.equal(ev.defaultPrevented, true, 'the link does not navigate')
  const detail = r.signinEvents()[0].detail
  assert.equal(detail.title, 'Sign in to download the complete example')
  assert.equal(detail.cta, 'Sign in and download')
  assert.equal(detail.returnTo, '/solutions/demo/s1/?intent=download&step=s1&version=v1.0.0')
})

test('the gate\'s own Sign in button carries the download intent', () => {
  const r = run({ signedIn: false, accountHidden: false })
  r.els.signin.dispatch('click')
  assert.equal(r.signinEvents()[0].detail.returnTo, '/solutions/demo/s1/?intent=download&step=s1&version=v1.0.0')
})

test('a public download is never gated', () => {
  const r = run({ signedIn: false, accountHidden: false, download: 'public' })
  const ev = r.els.download.dispatch('click')
  assert.equal(ev.defaultPrevented, false)
  assert.equal(r.signinEvents().length, 0)
  assert.equal(r.els.gate.hidden, false, 'the sign-in-to-save nudge can still show')
  assert.ok(r.calls.heap.some((e) => e.name === 'solution_download' && e.props.source === 'click'))
})

test('signed-in Save PUTs immediately, toasts, and never opens the modal', async () => {
  const r = run({ signedIn: true, hint: 'true' })
  await r.flush()
  const before = r.puts().length
  r.els.save.dispatch('click')
  await r.flush()
  assert.equal(r.signinEvents().length, 0)
  assert.equal(r.puts().length, before + 1)
  assert.equal(r.toasts()[0].textContent, 'Progress saved')
  assert.equal(r.els.gate.hidden, true, 'gate hidden for signed-in readers')
  assert.equal(r.els.saveLabel.textContent, 'Save now')
})

test('signed-in download click navigates normally and is tracked', () => {
  const r = run({ signedIn: true, hint: 'true' })
  const ev = r.els.download.dispatch('click')
  assert.equal(ev.defaultPrevented, false)
  assert.equal(r.signinEvents().length, 0)
  assert.ok(r.calls.heap.some((e) => e.name === 'solution_download'))
})

test('auth unavailable: "saved on this device", no sign-in button, download CTA hidden, build-along files untouched', () => {
  const r = run({ signedIn: false, accountHidden: true, kapaLoginUrl: undefined, isUiPreview: false })
  assert.equal(r.els.gateText.textContent, 'Progress is saved on this device.')
  assert.equal(r.els.signin.hidden, true)
  assert.equal(r.els.download.hidden, true)
  assert.equal(r.els.downloadPanel.hidden, true)
  assert.equal(r.els.save.hidden, true, 'nothing to save to')
  r.els.save.dispatch('click')
  assert.equal(r.signinEvents().length, 0, 'no modal to open')
  assert.equal(r.toasts().length, 1)
  assert.equal(r.toasts()[0].textContent, 'Progress is saved on this device.')
})

test('auth becomes available when the header learns of it (kapa-session), and in the UI preview', () => {
  const r = run({ signedIn: false, accountHidden: true })
  assert.equal(r.els.download.hidden, true)
  r.els.account.hidden = false
  r.window.listeners['kapa-session'].forEach((fn) => fn({ detail: {} }))
  assert.equal(r.els.download.hidden, false)
  assert.equal(r.els.gateText.textContent, 'Sign in to save progress and download the complete example.')

  const preview = run({ signedIn: false, accountHidden: true, isUiPreview: true })
  assert.equal(preview.els.download.hidden, false, 'the preview has no backend but must show the UI')
})

test('anonymous readers can mark steps and see progress without any gate', () => {
  const r = run({ signedIn: false, accountHidden: false })
  r.els.complete.dispatch('click')
  assert.equal(r.signinEvents().length, 0)
  assert.deepEqual(r.api.getState().solutions.demo.completedSteps, ['s1'])
  assert.equal(r.els.count.textContent, '1 of 3')
  assert.equal(r.els.sync.textContent, 'Saved on this device')
  assert.equal(r.calls.fetch.length, 0)
})

test('the overview Start CTA becomes Continue pointing at the current step', () => {
  const r = run({
    page: 'overview',
    localStore: { v: 1, updatedAt: 5, solutions: { demo: { completedSteps: ['s1'], currentStep: 's2', startedAt: 1, updatedAt: 5, completedAt: null, solutionVersion: 'v1.0.0' } } },
  })
  assert.equal(r.els.startLabel.textContent, 'Continue')
  assert.equal(r.els.start.getAttribute('href'), '/solutions/demo/s2/')
  assert.equal(r.els.heroProgress.hidden, false)
  assert.equal(r.els.heroProgress.textContent, '1 of 3 steps done')
  assert.ok(r.els.nav.children[0].classes.has('is-complete'), 'sidebar tick matched on step id')
  assert.ok(r.els.stepList.children[0].classes.has('is-complete'), 'body Steps list ticked too')
  assert.ok(!r.els.nav.children[1].classes.has('is-complete'))
})

test('the rail <details> collapses on narrow screens and stays open otherwise', () => {
  const wide = run({ mobile: false })
  assert.equal(wide.els.rail.open, true)
  const narrow = run({ mobile: true })
  assert.equal(narrow.els.rail.open, false)
})
