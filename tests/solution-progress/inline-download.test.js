'use strict'
/**
 * [.solution-download]#...# in running text becomes the same gated bundle
 * download as the rail, in place: sign in when needed, inert for a draft,
 * plain text when the solution has no download.
 */
const test = require('node:test')
const assert = require('node:assert')
const { run } = require('./helpers/run')

const link = (r) => r.els.inlineSentence.children[1]

test('the words become a download link for a signed-in reader', () => {
  const r = run({ inlineDownload: true, signedIn: true, hint: 'true' })
  const a = link(r)
  assert.equal(a.tagName.toLowerCase(), 'a')
  assert.equal(a.textContent, 'download the complete example', 'the author keeps their words')
  assert.equal(a.getAttribute('href'), '/solutions/download?solution=demo&version=v1.0.0&return=%2Fsolutions%2Fdemo%2Fs1%2F')
  const ev = a.dispatch('click')
  assert.equal(ev.defaultPrevented, false, 'navigates to the download')
  assert.ok(r.calls.heap.some((e) => e.name === 'solution_download' && e.props.placement === 'inline'))
})

test('a signed-out reader is asked to sign in, with the download intent', () => {
  const r = run({ inlineDownload: true, signedIn: false, accountHidden: false })
  const ev = link(r).dispatch('click')
  assert.equal(ev.defaultPrevented, true)
  const [signin] = r.signinEvents()
  assert.equal(signin.detail.title, 'Download the tested build')
  assert.match(signin.detail.returnTo, /intent=download/)
})

test('a draft keeps the words but has no link', () => {
  const r = run({ inlineDownload: true, signedIn: true, hint: 'true', status: 'draft' })
  const a = link(r)
  assert.equal(a.getAttribute('href'), null)
  assert.equal(a.getAttribute('aria-disabled'), 'true')
  assert.equal(a.textContent, 'download the complete example', 'the sentence still reads')
})

test('a draft the preview marks downloadable gets the live link', () => {
  const r = run({ inlineDownload: true, signedIn: true, hint: 'true', status: 'draft', draftDownloads: true })
  assert.match(link(r).getAttribute('href') || '', /^\/solutions\/download\?solution=demo/)
})

test('with no download at all the words stay plain text', () => {
  const r = run({ inlineDownload: true, signedIn: true, hint: 'true', download: 'none' })
  assert.equal(link(r).tagName.toLowerCase(), 'span')
  assert.equal(link(r).getAttribute('href'), null)
})
