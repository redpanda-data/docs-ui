/**
 * The rail's All build-along files panel: record.files rendered as download
 * links that go through the same gate, URL builder and sign-in round trip as
 * the Download control on a code block. No entry is ever a public link to a
 * file.
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const { run, PENDING_KEY, RAIL_FILES } = require('./helpers/run')

const VERIFY = 'scripts/verify-lib.sh'
const fileUrl = (path, o) => {
  o = o || {}
  return '/solutions/download?solution=demo&version=v1.0.0&path=' + encodeURIComponent(path) +
    '&return=' + encodeURIComponent(o.return || '/solutions/demo/s1/')
}

test('every entry points at the download endpoint with its path, never at _attachments', () => {
  const r = run({ signedIn: false, accountHidden: false })
  assert.equal(r.els.fileLinks.length, RAIL_FILES.length)
  r.els.fileLinks.forEach((a) => {
    const file = a.getAttribute('data-sol-file-link')
    assert.equal(a.getAttribute('href'), fileUrl(file), 'rebuilt with the code-block URL builder')
    assert.doesNotMatch(a.getAttribute('href'), /_attachments/)
  })
  assert.equal(r.els.filesPanel.hidden, false)
})

test('signed out: the click opens sign-in with intent=download and the path', () => {
  const r = run({ signedIn: false, accountHidden: false })
  const ev = r.fileLink(VERIFY).dispatch('click')
  assert.equal(ev.defaultPrevented, true, 'the link does not navigate on its own')
  assert.equal(r.calls.assign.length, 0, 'no download starts anonymously')

  const detail = r.signinEvents()[0].detail
  assert.equal(detail.title, 'Sign in to download ' + VERIFY)
  assert.equal(detail.returnTo, '/solutions/demo/s1/?intent=download&step=s1&version=v1.0.0&path=scripts%2Fverify-lib.sh')
  const pending = JSON.parse(r.session.data[PENDING_KEY])
  assert.equal(pending.intent, 'download')
  assert.equal(pending.path, VERIFY, 'the same replay guard as a code-block click')
})

test('and the return from sign-in starts that one file', () => {
  const r = run({
    signedIn: true,
    search: '?intent=download&step=s1&version=v1.0.0&path=scripts%2Fverify-lib.sh',
    pending: { intent: 'download', solution: 'demo', step: 's1', version: 'v1.0.0', path: VERIFY, at: 1700000000000 },
  })
  assert.deepEqual(r.calls.assign, [fileUrl(VERIFY)])
})

test('signed in: the click goes to /solutions/download with the path', () => {
  const r = run({ signedIn: true })
  r.fileLink(VERIFY).dispatch('click')
  assert.deepEqual(r.calls.assign, [fileUrl(VERIFY)])
  assert.equal(r.signinEvents().length, 0)
  const events = r.downloads()
  assert.equal(events.length, 1)
  assert.equal(events[0].props.kind, 'file')
  assert.equal(events[0].props.path, VERIFY)
  assert.equal(events[0].props.placement, 'rail')
})

test('the overview returns to the overview', () => {
  const r = run({ page: 'overview', signedIn: true })
  r.fileLink(VERIFY).dispatch('click')
  assert.deepEqual(r.calls.assign, [fileUrl(VERIFY, { return: '/solutions/demo/' })])
})

test('a public solution downloads without sign-in', () => {
  const r = run({ signedIn: false, accountHidden: false, download: 'public' })
  r.fileLink(VERIFY).dispatch('click')
  assert.deepEqual(r.calls.assign, [fileUrl(VERIFY)])
  assert.equal(r.signinEvents().length, 0)
})

test('a draft lists the files with no link and does nothing on click', () => {
  for (const signedIn of [false, true]) {
    const r = run({ page: 'overview', status: 'draft', signedIn, accountHidden: false })
    r.els.fileLinks.forEach((a) => {
      assert.equal(a.getAttribute('href'), null, 'no link at all, public or gated')
      assert.equal(a.getAttribute('aria-disabled'), 'true')
      assert.ok(a.classes.has('is-disabled'))
      assert.match(a.getAttribute('title'), /Download available at release$/)
    })
    const ev = r.fileLink(VERIFY).dispatch('click')
    assert.equal(ev.defaultPrevented, true)
    assert.equal(r.calls.assign.length, 0)
    assert.equal(r.signinEvents().length, 0, 'signedIn=' + signedIn + ': nothing to sign in for')
  }
})

test('a draft whose markup still carried an href loses it', () => {
  const r = run({ page: 'overview', status: 'draft', draftHref: true, signedIn: true })
  r.els.fileLinks.forEach((a) => {
    assert.equal(a.getAttribute('href'), null)
    assert.equal(a.getAttribute('aria-disabled'), 'true')
  })
  r.fileLink(VERIFY).dispatch('click')
  assert.equal(r.calls.assign.length, 0)
})

test('the panel is hidden where signing in is impossible, exactly like the bundle panel', () => {
  const r = run({ signedIn: false, accountHidden: true })
  assert.equal(r.els.filesPanel.hidden, true)
  assert.equal(r.els.downloadPanel.hidden, true)
  const pub = run({ signedIn: false, accountHidden: true, download: 'public' })
  assert.equal(pub.els.filesPanel.hidden, false, 'nothing to sign in for')
})

test('download: none renders no file panel', () => {
  const r = run({ download: 'none', signedIn: true })
  assert.equal(r.els.filesPanel, undefined)
})
