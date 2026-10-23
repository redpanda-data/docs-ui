/**
 * == Files for this step: the article's own file list. A bullet whose path is
 * in the download allowlist (the rail's entries) becomes the same gated
 * download link as the rail entry and the code-block control: same URL
 * builder, same sign-in round trip, inert for a draft, absent where the
 * bundle CTA is absent. A generated file stays plain text.
 */
const assert = require('node:assert/strict')
const test = require('node:test')
const { run, PENDING_KEY } = require('./helpers/run')

const FILE = 'docker-compose.yml'
const SUFFIXED = 'services/leaderboard/main.go'
const fileUrl = (path) => '/solutions/download?solution=demo&version=v1.0.0&path=' + encodeURIComponent(path) +
  '&return=' + encodeURIComponent('/solutions/demo/s1/')

test('a listed file in the allowlist becomes the gated download link, with the path as its text', () => {
  const r = run({ filesSection: true, signedIn: false, accountHidden: false })
  const a = r.stepFileLink(FILE)
  assert.ok(a, 'the bullet is wrapped')
  assert.equal(a.getAttribute('href'), fileUrl(FILE), 'the code-block URL builder')
  assert.ok(a.hasAttribute('data-requires-auth'), 'gated like the bundle')
  assert.equal(a.children[0].tagName, 'CODE')
  assert.equal(a.children[0].textContent, FILE)
  assert.ok(a.children[1].classes.has('sol-step-file-icon'))
  assert.equal(a.getAttribute('aria-label'), 'Download ' + FILE)
})

test('a generated file is not served, so its bullet stays plain', () => {
  const r = run({ filesSection: true, accountHidden: false })
  assert.equal(r.stepFileLink('services/go.sum'), null)
  assert.equal(r.els.stepFileItems[1].querySelectorAll('a').length, 0)
})

test('a bullet with a suffix keeps the suffix outside the link', () => {
  const r = run({ filesSection: true, accountHidden: false })
  const a = r.stepFileLink(SUFFIXED)
  assert.ok(a)
  const p = a.parentNode
  assert.equal(p.children[0], a)
  assert.equal(p.children[1].textContent, ': shown in full under Complete source.')
})

test('signed out: the click opens sign-in for that one file', () => {
  const r = run({ filesSection: true, signedIn: false, accountHidden: false })
  const ev = r.stepFileLink(FILE).dispatch('click')
  assert.equal(ev.defaultPrevented, true)
  assert.equal(r.calls.assign.length, 0)
  assert.equal(r.signinEvents()[0].detail.title, 'Sign in to download ' + FILE)
  assert.equal(JSON.parse(r.session.data[PENDING_KEY]).path, FILE)
})

test('signed in: the click downloads, and analytics names the step list as the placement', () => {
  const r = run({ filesSection: true, signedIn: true })
  r.stepFileLink(FILE).dispatch('click')
  assert.deepEqual(r.calls.assign, [fileUrl(FILE)])
  const events = r.downloads()
  assert.equal(events.length, 1)
  assert.equal(events[0].props.kind, 'file')
  assert.equal(events[0].props.path, FILE)
  assert.equal(events[0].props.placement, 'step')
})

test('a public solution downloads without sign-in', () => {
  const r = run({ filesSection: true, signedIn: false, accountHidden: true, download: 'public' })
  const a = r.stepFileLink(FILE)
  assert.ok(a, 'nothing to sign in for')
  assert.equal(a.hasAttribute('data-requires-auth'), false)
  a.dispatch('click')
  assert.deepEqual(r.calls.assign, [fileUrl(FILE)])
})

test('a draft keeps the name and loses the link', () => {
  const r = run({ filesSection: true, status: 'draft', signedIn: true, accountHidden: false })
  const a = r.stepFileLink(FILE)
  assert.ok(a)
  assert.equal(a.getAttribute('href'), null)
  assert.equal(a.getAttribute('aria-disabled'), 'true')
  assert.ok(a.classes.has('is-disabled'))
  assert.match(a.getAttribute('title'), /Download available at release$/)
  const ev = a.dispatch('click')
  assert.equal(ev.defaultPrevented, true)
  assert.equal(r.calls.assign.length, 0)
  assert.equal(r.signinEvents().length, 0)
})

test('a draft marked draftDownloads keeps its link (preview only)', () => {
  const r = run({ filesSection: true, status: 'draft', draftDownloads: true, signedIn: true, accountHidden: false })
  const a = r.stepFileLink(FILE)
  assert.ok(a)
  assert.match(a.getAttribute('href') || '', /\/solutions\/download\?solution=demo&version=v1\.0\.0&path=/)
  assert.equal(a.getAttribute('aria-disabled'), null)
})

test('no links where the bundle CTA is absent', () => {
  assert.equal(run({ filesSection: true, download: 'none' }).stepFileLink(FILE), null, 'download: none')
  const gated = run({ filesSection: true, signedIn: false, accountHidden: true })
  assert.equal(gated.stepFileLink(FILE), null, 'gated, and no way to sign in')
})
