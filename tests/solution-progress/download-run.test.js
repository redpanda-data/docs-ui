'use strict'
/**
 * Download and run in the Get the code card: signed in, a click mints a
 * signed link (/solutions/download-link) and shows the curl command for the
 * reader's platform, built with textContent only; signed out it asks for
 * sign-in like the download; a failure shows a short inline message.
 */
const test = require('node:test')
const assert = require('node:assert')
const { run } = require('./helpers/run')

// The shape docs-site mints: /solutions/get/<solution>/<version>/<expires>/<signature>
const URL_OK = 'https://docs.example.com/solutions/get/demo/v1.0.0/1763551800/q3Zx9Kd0P1mVtB7wYcRa2Q'

function linkRoute (reply) {
  return (url, init, defaults) => (url === '/solutions/download-link' ? reply(init) : defaults(url, init))
}
const ok = (url) => linkRoute(() => ({ status: 200, ok: true, json: () => Promise.resolve({ url: url || URL_OK, expiresAt: 'x' }) }))
const status = (code) => linkRoute(() => ({ status: code, ok: false, json: () => Promise.resolve({ error: 'x' }) }))

function commandText (r) {
  const pre = r.els.runOutput.querySelector('pre')
  return pre ? pre.children[0].textContent : null
}

test('signed in: posts the solution and version, then shows the make up command', async () => {
  const r = run({ downloadRun: true, signedIn: true, hint: 'true', fetch: ok() })
  r.els.runButton.dispatch('click')
  await r.flush()
  const post = r.calls.fetch.find((c) => c.url === '/solutions/download-link')
  assert.equal(post.method, 'POST')
  assert.deepEqual(post.body, { solution: 'demo', version: 'v1.0.0' })
  assert.equal(post.init.headers['Content-Type'], 'application/json')
  assert.equal(r.els.runOutput.hidden, false)
  assert.equal(commandText(r), 'curl -fsSL "' + URL_OK + '" -o demo.zip && unzip -q demo.zip && cd demo && make up')
  assert.equal(r.els.runOutput.innerHTML, '', 'nothing is parsed as markup')
  const note = r.els.runOutput.querySelector('.sol-download-run-note')
  assert.equal(note.children.map((c) => c.textContent).join(''), 'The link works for 10 minutes. You need Docker and unzip.')
  assert.equal(note.children[1].tagName, 'CODE')
  assert.ok(r.downloads().some((e) => e.props.kind === 'run' && e.props.platform === 'local'))
})

test('the Kubernetes tab ends the command with make k8s-up', async () => {
  const r = run({ downloadRun: true, signedIn: true, hint: 'true', fetch: ok(), localRaw: { 'preferred-tab-platform': 'Kubernetes' } })
  r.els.runButton.dispatch('click')
  await r.flush()
  assert.match(commandText(r), / && cd demo && make k8s-up$/)
  assert.match(r.els.runOutput.querySelector('.sol-download-run-note').children[0].textContent, /kubectl/)
})

test('the saved platform preference wins over the tab key', async () => {
  const localStore = { v: 2, updatedAt: 0, solutions: {}, prefs: { platform: { value: 'kubernetes', at: 1 } } }
  const r = run({ downloadRun: true, signedIn: true, hint: 'true', fetch: ok(), localStore, localRaw: { 'preferred-tab-platform': 'Docker Compose' } })
  r.els.runButton.dispatch('click')
  await r.flush()
  assert.match(commandText(r), /make k8s-up$/)
})

test('a URL that could break out of the quotes is refused', async () => {
  for (const bad of [
    'https://docs.example.com/solutions/get/demo/v1.0.0/1763551800/q3Zx9Kd0P1mVtB7wYcRa2Q"; rm -rf ~; "',
    'https://docs.example.com/solutions/get/demo/v1.0.0/$(id)/q3Zx9Kd0P1mVtB7wYcRa2Q',
    'https://docs.example.com/solutions/get/demo/v1.0.0`id`/1763551800/q3Zx9Kd0P1mVtB7wYcRa2Q',
    'https://docs.example.com/solutions/get/eyJhbGciOiJSUzI1NiJ9.eyJzb2wiOiJkZW1vIn0.c2ln',
    'javascript:alert(1)',
    'https://docs.example.com/solutions/download?x=1',
  ]) {
    const r = run({ downloadRun: true, signedIn: true, hint: 'true', fetch: ok(bad) })
    r.els.runButton.dispatch('click')
    await r.flush()
    assert.equal(commandText(r), null, bad)
    assert.match(r.els.runOutput.querySelector('.sol-download-run-error').textContent, /Could not get the command/)
  }
})

test('a failed request shows an inline message and leaves the download alone', async () => {
  const r = run({ downloadRun: true, signedIn: true, hint: 'true', fetch: status(503) })
  r.els.runButton.dispatch('click')
  await r.flush()
  const err = r.els.runOutput.querySelector('.sol-download-run-error')
  assert.match(err.textContent, /Download the complete example/)
  assert.equal(r.els.download.getAttribute('href').startsWith('/solutions/download?'), true)
  assert.equal(r.els.download.hidden, false)
  assert.ok(r.calls.heap.some((e) => e.name === 'solution_download_error' && e.props.kind === 'run'))
})

test('a network error and a rate limit say so', async () => {
  const net = run({ downloadRun: true, signedIn: true, hint: 'true', fetch: linkRoute(() => 'network-error') })
  net.els.runButton.dispatch('click')
  await net.flush()
  assert.match(net.els.runOutput.querySelector('.sol-download-run-error').textContent, /Try again/)
  const rl = run({ downloadRun: true, signedIn: true, hint: 'true', fetch: status(429) })
  rl.els.runButton.dispatch('click')
  await rl.flush()
  assert.match(rl.els.runOutput.querySelector('.sol-download-run-error').textContent, /Too many downloads/)
})

test('signed out: asks for sign-in with its own run intent, no request', async () => {
  const r = run({ downloadRun: true, signedIn: false, accountHidden: false })
  r.els.runButton.dispatch('click')
  await r.flush()
  const [signin] = r.signinEvents()
  assert.match(signin.detail.returnTo, /intent=run&step=s1&version=v1\.0\.0/)
  assert.equal(signin.detail.cta, 'Sign in and get the command')
  assert.equal(r.calls.fetch.some((c) => c.url === '/solutions/download-link'), false)
})

test('back from sign-in: shows the command and the browser downloads nothing', async () => {
  const r = run({
    downloadRun: true,
    signedIn: true,
    hint: 'true',
    fetch: ok(),
    search: '?intent=run&step=s1&version=v1.0.0',
    pending: { intent: 'run', solution: 'demo', step: 's1', version: 'v1.0.0', at: 1700000000000 },
  })
  await r.flush()
  assert.equal(commandText(r), 'curl -fsSL "' + URL_OK + '" -o demo.zip && unzip -q demo.zip && cd demo && make up')
  assert.deepEqual(r.calls.assign, [], 'no browser download: the command downloads the build')
  assert.deepEqual(r.calls.replaceState, ['/solutions/demo/s1/'], 'the params are gone from the URL')
})

test('a run intent with no pending record mints nothing and says what to do', async () => {
  const r = run({ downloadRun: true, signedIn: true, hint: 'true', fetch: ok(), search: '?intent=run&step=s1&version=v1.0.0' })
  await r.flush()
  assert.equal(r.calls.fetch.some((c) => c.url === '/solutions/download-link'), false)
  assert.deepEqual(r.calls.assign, [])
  assert.ok(r.toasts().some((t) => /Download and run/.test(t.textContent)))
})

test('a 401 (stale hint) asks for sign-in again', async () => {
  const r = run({ downloadRun: true, signedIn: true, hint: 'true', fetch: status(401) })
  r.els.runButton.dispatch('click')
  await r.flush()
  assert.equal(r.signinEvents().length, 1)
  assert.equal(commandText(r), null)
})

test('Copy writes the command to the clipboard', async () => {
  const copied = []
  const r = run({ downloadRun: true, signedIn: true, hint: 'true', fetch: ok(), clipboard: { writeText: (t) => { copied.push(t); return Promise.resolve() } } })
  r.els.runButton.dispatch('click')
  await r.flush()
  const copy = r.els.runOutput.querySelector('.sol-download-run-copy')
  copy.dispatch('click')
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(copied, [commandText(r)])
  assert.equal(copy.textContent, 'Copied')
})

test('hidden for a draft, and where sign-in is not possible', () => {
  const draft = run({ downloadRun: true, signedIn: true, hint: 'true', status: 'draft' })
  assert.equal(draft.els.run.hidden, true)
  const noAuth = run({ downloadRun: true, signedIn: false, accountHidden: true })
  assert.equal(noAuth.els.run.hidden, true)
  const shown = run({ downloadRun: true, signedIn: true, hint: 'true' })
  assert.equal(shown.els.run.hidden, false)
})

test('says it is getting the command while the request is in flight', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const r = run({
    downloadRun: true,
    signedIn: true,
    hint: 'true',
    fetch: linkRoute(() => gate.then(() => ({ status: 200, ok: true, json: () => Promise.resolve({ url: URL_OK, expiresAt: 'x' }) }))),
  })
  r.els.runButton.dispatch('click')
  assert.equal(r.els.runOutput.hidden, false)
  assert.match(r.els.runOutput.querySelector('.sol-download-run-note').textContent, /^Getting your command/)
  assert.equal(r.els.runButton.getAttribute('aria-busy'), 'true')
  release()
  await r.flush()
  assert.match(commandText(r), /^curl /)
  assert.equal(r.els.runButton.getAttribute('aria-busy'), null)
})

test('a second click hides the command, and a third shows it again without a new link', async () => {
  const r = run({ downloadRun: true, signedIn: true, hint: 'true', fetch: ok() })
  const posts = () => r.calls.fetch.filter((c) => c.url === '/solutions/download-link').length
  r.els.runButton.dispatch('click')
  await r.flush()
  assert.equal(r.els.runButton.getAttribute('aria-expanded'), 'true')
  r.els.runButton.dispatch('click')
  await r.flush()
  assert.equal(r.els.runOutput.hidden, true)
  assert.equal(r.els.runButton.getAttribute('aria-expanded'), 'false')
  r.els.runButton.dispatch('click')
  await r.flush()
  assert.equal(r.els.runOutput.hidden, false)
  assert.equal(commandText(r), 'curl -fsSL "' + URL_OK + '" -o demo.zip && unzip -q demo.zip && cd demo && make up')
  assert.equal(posts(), 1, 'the link still has time left, so no second request')
})

test('after a failure the next click tries again rather than hiding the message', async () => {
  let n = 0
  const r = run({
    downloadRun: true,
    signedIn: true,
    hint: 'true',
    fetch: linkRoute(() => (n++ === 0
      ? { status: 503, ok: false, json: () => Promise.resolve({}) }
      : { status: 200, ok: true, json: () => Promise.resolve({ url: URL_OK, expiresAt: 'x' }) })),
  })
  r.els.runButton.dispatch('click')
  await r.flush()
  assert.ok(r.els.runOutput.querySelector('.sol-download-run-error'))
  r.els.runButton.dispatch('click')
  await r.flush()
  assert.match(commandText(r), /^curl /)
})
