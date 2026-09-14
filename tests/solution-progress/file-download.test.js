/**
 * Downloading the file behind a snippet: the control the module adds to an
 * annotated code block's toolbox, the sign-in gate in front of it, and the
 * return path that starts the download once the reader is back. The bundle
 * download shares all of that machinery, so each test says which of the two it
 * is exercising.
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const { run, PENDING_KEY } = require('./helpers/run')

const MAIN_GO = 'services/leaderboard/main.go'
const ENDPOINT = '/solutions/download'
const fileUrl = (path, opts) => {
  const o = opts || {}
  return ENDPOINT + '?solution=' + (o.solution || 'demo') +
    '&version=' + (o.version || 'v1.0.0') +
    '&path=' + encodeURIComponent(path) +
    '&return=' + encodeURIComponent(o.return || '/solutions/demo/s1/')
}

test('only the annotated blocks get a control, and it goes in the toolbox after the copy button', () => {
  const r = run({ signedIn: true })
  const controls = r.controls()
  assert.equal(controls.length, 3, 'the three blocks that came from an include::example$')
  assert.equal(r.els.commandBlock.querySelector('[data-sol-file-download]'), null, 'a shell command is not a file')

  const toolbox = r.els.fileBlock.querySelector('.source-toolbox')
  const button = toolbox.children[toolbox.children.length - 1]
  assert.equal(button.getAttribute('data-sol-file-download'), MAIN_GO)
  assert.equal(button.tagName, 'BUTTON')
  assert.equal(button.getAttribute('type'), 'button')
  // fileBlock is a tagged region, so its label says so; the wording itself is
  // asserted in the next test.
  assert.equal(button.getAttribute('aria-label'), 'Download the full file ' + MAIN_GO, 'the label names the file')
  assert.equal(button.getAttribute('title'), 'Download the full file ' + MAIN_GO)
  assert.equal(button.getAttribute('data-analytics'), 'solution_download')
  assert.ok(button.classes.has('sol-file-download'))
  assert.match(button.innerHTML, /<svg[^>]*>/, 'an icon, like the copy button')
  assert.match(button.innerHTML, /Download<\/span>/)
})

test('a block that showed only a tagged region says the whole file is what downloads', () => {
  const r = run({ signedIn: true })
  assert.equal(r.els.fileBlock.getAttribute('data-solution-tag'), 'consumer')
  assert.equal(r.els.fileBlockPlain.getAttribute('data-solution-tag'), null)

  const tagged = r.control(MAIN_GO)
  assert.equal(tagged.getAttribute('aria-label'), 'Download the full file ' + MAIN_GO)
  assert.equal(tagged.getAttribute('title'), 'Download the full file ' + MAIN_GO)

  const whole = r.control('docker-compose.yml')
  assert.equal(whole.getAttribute('aria-label'), 'Download docker-compose.yml', 'an untagged block is left as it was')
  assert.equal(whole.getAttribute('title'), 'Download docker-compose.yml')
  assert.doesNotMatch(whole.getAttribute('aria-label'), /full file/)

  // The wording differs; what is served does not. The filename has to match the
  // repo's own, so a tagged region still downloads its whole file.
  tagged.dispatch('click')
  whole.dispatch('click')
  assert.deepEqual(r.calls.assign, [fileUrl(MAIN_GO), fileUrl('docker-compose.yml')])
})

test('a public solution gates neither the file nor the bundle', () => {
  const r = run({ signedIn: false, accountHidden: false, download: 'public' })
  assert.equal(r.controls().length, 3, 'the control is there for an anonymous reader')

  r.control(MAIN_GO).dispatch('click')
  assert.deepEqual(r.calls.assign, [fileUrl(MAIN_GO)], 'straight to the endpoint, no sign-in')
  assert.equal(r.signinEvents().length, 0, 'no modal')
  assert.equal(r.session.data[PENDING_KEY], undefined, 'nothing pending: there is nothing to come back for')
  const events = r.downloads()
  assert.equal(events.length, 1)
  assert.equal(events[0].props.kind, 'file')

  // The same reader, the same page: the bundle is ungated too, which is the
  // incoherence this alignment removes.
  const ev = r.els.download.dispatch('click')
  assert.equal(ev.defaultPrevented, false, 'the bundle link navigates on its own href')
  assert.equal(r.signinEvents().length, 0)
  assert.equal(r.downloads().length, 2)
  assert.equal(r.downloads()[1].props.kind, 'bundle')
})

test('a public solution still serves files to a signed-in reader', () => {
  const r = run({ signedIn: true, download: 'public' })
  r.control(MAIN_GO).dispatch('click')
  assert.deepEqual(r.calls.assign, [fileUrl(MAIN_GO)])
  assert.equal(r.signinEvents().length, 0)
})

test('download: none means no control at all, as it means no bundle CTA', () => {
  for (const signedIn of [false, true]) {
    const r = run({ signedIn, accountHidden: false, download: 'none' })
    assert.equal(r.controls().length, 0, 'signedIn=' + signedIn + ': nothing to click')
    assert.equal(r.els.download, undefined, 'and no bundle CTA either')
  }
})

test('no control where the reader could not complete it: an authenticated solution with no account backend', () => {
  const r = run({ signedIn: false, accountHidden: true })
  assert.equal(r.controls().length, 0, 'signing in is impossible here, so the affordance is absent')
  assert.equal(r.els.download.hidden, true, 'exactly as the bundle CTA is hidden')

  // The backend becoming available later (26-docs-account.js learns after us)
  // brings both back.
  r.window.listeners['kapa-session'].forEach((fn) => fn({ detail: { authoritative: true } }))
  assert.equal(r.controls().length, 0, 'still nothing while the account element stays hidden')

  const withBackend = run({ signedIn: false, accountHidden: false })
  assert.equal(withBackend.controls().length, 3)
  assert.equal(withBackend.els.download.hidden, false)
})

test('a block whose toolbox does not exist yet gets one, so no annotated block is left without a control', () => {
  const r = run({ signedIn: true })
  const toolbox = r.els.fileBlockNoToolbox.querySelector('.source-toolbox')
  assert.ok(toolbox, 'created rather than skipped')
  assert.equal(toolbox.parentNode.className, 'content', 'in the block content, where 06-copy-to-clipboard puts it')
  assert.ok(toolbox.querySelector('[data-sol-file-download]'))
})

test('running twice never doubles a control', () => {
  const r = run({ signedIn: true })
  r.api.decorateFileBlocks()
  r.api.decorateFileBlocks()
  assert.equal(r.controls().length, 3)
})

test('a plain docs page with the same blocks gets no controls', () => {
  const r = run({ page: 'article', signedIn: true })
  assert.equal(r.controls().length, 0, 'the module does nothing outside a solution')
})

test('anonymous: the click opens the modal naming the file and returns with the path', () => {
  const r = run({ signedIn: false, accountHidden: false })
  const ev = r.control(MAIN_GO).dispatch('click')
  assert.equal(ev.defaultPrevented, true, 'the click does not also navigate')
  assert.equal(r.calls.assign.length, 0, 'no download starts anonymously')

  const detail = r.signinEvents()[0].detail
  assert.equal(detail.title, 'Sign in to download ' + MAIN_GO, 'the copy names the file')
  assert.equal(detail.cta, 'Sign in and download')
  assert.ok(detail.lead.length > 20)
  assert.equal(detail.returnTo, '/solutions/demo/s1/?intent=download&step=s1&version=v1.0.0&path=services%2Fleaderboard%2Fmain.go')

  const pending = JSON.parse(r.session.data[PENDING_KEY])
  assert.equal(pending.intent, 'download')
  assert.equal(pending.solution, 'demo')
  assert.equal(pending.path, MAIN_GO, 'the pending record is what authorises the download on return')
  assert.ok(r.calls.heap.some((e) => e.name === 'solution_login_cta_click' && e.props.path === MAIN_GO))
})

test('signed in: the click goes straight to the endpoint, with no modal', () => {
  const r = run({ signedIn: true })
  r.control(MAIN_GO).dispatch('click')
  assert.deepEqual(r.calls.assign, [fileUrl(MAIN_GO)])
  assert.equal(r.signinEvents().length, 0)
  assert.equal(r.session.data[PENDING_KEY], undefined, 'nothing to replay: the download already started')

  const events = r.downloads()
  assert.equal(events.length, 1)
  assert.equal(events[0].props.kind, 'file')
  assert.equal(events[0].props.path, MAIN_GO)
  assert.equal(events[0].props.source, 'click')
})

test('on return, the download starts once and the intent params are stripped', () => {
  const r = run({
    signedIn: true,
    search: '?intent=download&step=s1&version=v1.0.0&path=services%2Fleaderboard%2Fmain.go',
    pending: { intent: 'download', solution: 'demo', step: 's1', version: 'v1.0.0', path: MAIN_GO, at: 1700000000000 },
  })
  assert.deepEqual(r.calls.assign, [fileUrl(MAIN_GO)], 'exactly one download')
  assert.deepEqual(r.calls.replaceState, ['/solutions/demo/s1/'], 'the params are gone from the URL')
  assert.equal(r.session.data[PENDING_KEY], undefined, 'the pending record is spent')

  const events = r.downloads()
  assert.equal(events.length, 1)
  assert.equal(events[0].props.kind, 'file')
  assert.equal(events[0].props.path, MAIN_GO)
  assert.equal(events[0].props.source, 'intent')
})

test('a bookmarked return URL starts nothing, and still strips the params', () => {
  const search = '?intent=download&step=s1&version=v1.0.0&path=services%2Fleaderboard%2Fmain.go'
  for (const pending of [
    undefined,
    { intent: 'download', solution: 'demo', step: 's1', version: 'v1.0.0', path: MAIN_GO, at: 1700000000000 - 16 * 60 * 1000 },
    { intent: 'download', solution: 'other', path: MAIN_GO, at: 1700000000000 },
    { intent: 'save', solution: 'demo', path: MAIN_GO, at: 1700000000000 },
  ]) {
    const r = run({ signedIn: true, search, pending })
    assert.equal(r.calls.assign.length, 0, JSON.stringify(pending) + ': no download')
    assert.equal(r.downloads().length, 0, 'and nothing reported to analytics')
    assert.deepEqual(r.calls.replaceState, ['/solutions/demo/s1/'])
  }
})

test('a pending record for one file does not authorise another, or the bundle', () => {
  const fresh = { intent: 'download', solution: 'demo', step: 's1', version: 'v1.0.0', at: 1700000000000 }
  const other = run({
    signedIn: true,
    search: '?intent=download&step=s1&version=v1.0.0&path=docker-compose.yml',
    pending: Object.assign({}, fresh, { path: MAIN_GO }),
  })
  assert.equal(other.calls.assign.length, 0, 'the URL asks for a file the reader never clicked')

  const bundle = run({
    signedIn: true,
    search: '?intent=download&step=s1&version=v1.0.0',
    pending: Object.assign({}, fresh, { path: MAIN_GO }),
  })
  assert.equal(bundle.calls.assign.length, 0, 'a file intent is not a bundle intent')
})

test('an anonymous return starts nothing even with a fresh pending record', () => {
  const r = run({
    signedIn: false,
    search: '?intent=download&step=s1&version=v1.0.0&path=services%2Fleaderboard%2Fmain.go',
    pending: { intent: 'download', solution: 'demo', step: 's1', version: 'v1.0.0', path: MAIN_GO, at: 1700000000000 },
  })
  assert.equal(r.calls.assign.length, 0, 'sign-in did not happen, so there is nothing to download')
  assert.deepEqual(r.calls.replaceState, ['/solutions/demo/s1/'])
})

test('the bundle flow is unchanged, and is now separable in analytics', () => {
  const onReturn = run({
    signedIn: true,
    search: '?intent=download&step=s1&version=v1.0.0',
    pending: { intent: 'download', solution: 'demo', step: 's1', version: 'v1.0.0', at: 1700000000000 },
  })
  assert.deepEqual(
    onReturn.calls.assign,
    ['/solutions/download?solution=demo&version=v1.0.0&return=/solutions/demo/'],
    'still the bundle href from the page'
  )
  assert.deepEqual(onReturn.calls.replaceState, ['/solutions/demo/s1/'])
  const returned = onReturn.downloads()
  assert.equal(returned.length, 1)
  assert.equal(returned[0].props.kind, 'bundle')
  assert.equal(returned[0].props.path, undefined, 'a bundle has no path')

  const anon = run({ signedIn: false, accountHidden: false })
  anon.els.download.dispatch('click')
  const detail = anon.signinEvents()[0].detail
  assert.equal(detail.title, 'Sign in to download the complete example', 'the bundle copy is untouched')
  assert.equal(detail.returnTo, '/solutions/demo/s1/?intent=download&step=s1&version=v1.0.0', 'and carries no path')
  assert.equal(JSON.parse(anon.session.data[PENDING_KEY]).path, undefined)

  const click = run({ signedIn: true })
  click.els.download.dispatch('click')
  const clicked = click.downloads()
  assert.equal(clicked.length, 1)
  assert.equal(clicked[0].props.kind, 'bundle')
  assert.equal(clicked[0].props.source, 'click')
})

test('the version in the return URL wins over the pending record, as it does for the bundle', () => {
  const r = run({
    signedIn: true,
    search: '?intent=download&step=s1&version=v2.0.0&path=services%2Fleaderboard%2Fmain.go',
    pending: { intent: 'download', solution: 'demo', step: 's1', version: 'v1.0.0', path: MAIN_GO, at: 1700000000000 },
  })
  assert.deepEqual(r.calls.assign, [fileUrl(MAIN_GO, { version: 'v2.0.0' })])
})

test('the overview page serves files too, returning to the overview', () => {
  const r = run({ page: 'overview', stepId: null, signedIn: true })
  r.control(MAIN_GO).dispatch('click')
  assert.deepEqual(r.calls.assign, [fileUrl(MAIN_GO, { return: '/solutions/demo/' })])
})
