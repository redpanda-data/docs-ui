/**
 * First-view nudge on the header sign-in control.
 *
 * The gating is the part worth testing: the nudge must never appear when the
 * Sign in link itself is hidden (the whole account UI is gated on auth being
 * available on the deploy, and on the reader being signed out), and it must be
 * shown only once per browser.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SCRIPT = path.join(__dirname, '../../src/js/26-docs-account.js')
const PARTIAL = path.join(__dirname, '../../src/partials/header-content.hbs')

test('the nudge ships hidden so it cannot flash before the gate runs', () => {
  const hbs = fs.readFileSync(PARTIAL, 'utf8')
  const el = hbs.match(/<div class="tb-signin-nudge"[^>]*>/)
  assert.ok(el, 'nudge element is in the header partial')
  assert.match(el[0], /\bhidden\b/, 'rendered hidden; 26-docs-account.js decides')
})

function makeEl (attrs) {
  return {
    attrs: attrs || {},
    hidden: false,
    href: '',
    textContent: '',
    classList: { add () {}, remove () {}, contains: () => false, toggle: () => false },
    setAttribute (k, v) { this.attrs[k] = v },
    getAttribute (k) { return this.attrs[k] },
    addEventListener (t, fn) { (this.handlers = this.handlers || {})[t] = fn },
    querySelector: () => null,
    querySelectorAll: () => [],
    focus () {},
    appendChild () {},
  }
}

// Drive the IIFE against a stub DOM and hand back the pieces the assertions need.
function run ({ signedIn, loginUrlKnown, nudgeSeen, storageThrows, uiPreview }) {
  const els = {
    container: makeEl({}),
    signin: makeEl({}),
    menu: makeEl({}),
    avatar: makeEl({}),
    email: makeEl({}),
    signout: makeEl({}),
    modal: makeEl({}),
    modalCta: makeEl({}),
    modalSignup: makeEl({}),
    nudge: makeEl({}),
    dismiss: makeEl({}),
  }
  const bySelector = {
    '[data-account-signin]': els.signin,
    '[data-account-menu]': els.menu,
    '[data-account-avatar]': els.avatar,
    '[data-account-email]': els.email,
    '[data-account-signout]': els.signout,
    '[data-signin-modal]': els.modal,
    '[data-signin-modal-continue]': els.modalCta,
    '[data-signin-modal-signup]': els.modalSignup,
    '[data-signin-nudge]': els.nudge,
    '[data-signin-nudge-dismiss]': els.dismiss,
  }
  els.container.querySelector = (sel) => bySelector[sel] || null

  const store = nudgeSeen ? { 'docs-account-signin-nudge-seen': '1' } : {}
  const listeners = {}
  const context = {
    console,
    encodeURIComponent,
    JSON,
    RegExp,
    fetch: () => Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({}) }),
    localStorage: storageThrows
      ? {
        getItem () { throw new Error('SecurityError') },
        setItem () { throw new Error('SecurityError') },
        removeItem () { throw new Error('SecurityError') },
      }
      : {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v) },
        removeItem: (k) => { delete store[k] },
      },
    sessionStorage: { getItem: () => null, setItem () {}, removeItem () {} },
    document: {
      cookie: signedIn ? 'rp_docs_auth=1' : '',
      activeElement: null,
      body: { appendChild () {} },
      querySelector: (sel) => (sel === '[data-docs-account]' ? els.container : null),
      querySelectorAll: () => [],
      addEventListener () {},
      removeEventListener () {},
    },
    window: {
      isUiPreview: uiPreview === true,
      __KAPA_LOGIN_URL: loginUrlKnown ? '/login' : undefined,
      location: { pathname: '/home/', search: '', hash: '' },
      history: { replaceState () {} },
      addEventListener: (t, fn) => { listeners[t] = fn },
      CustomEvent: class { constructor (type) { this.type = type } },
    },
  }
  vm.runInNewContext(fs.readFileSync(SCRIPT, 'utf8'), context)
  return { els, store, listeners }
}

test('shows on first view for a signed-out reader when sign-in is available', () => {
  const { els } = run({ signedIn: false, loginUrlKnown: true, nudgeSeen: false })
  assert.equal(els.signin.hidden, false, 'sign-in link is visible')
  assert.equal(els.nudge.hidden, false, 'nudge is shown alongside it')
})

test('stays hidden when auth is unavailable, so it never points at a missing control', () => {
  const { els } = run({ signedIn: false, loginUrlKnown: false, nudgeSeen: false })
  assert.equal(els.signin.hidden, true, 'sign-in link is gated off')
  assert.equal(els.nudge.hidden, true, 'nudge must not appear without it')
})

test('stays hidden once seen', () => {
  const { els } = run({ signedIn: false, loginUrlKnown: true, nudgeSeen: true })
  assert.equal(els.nudge.hidden, true)
})

test('never shows to a signed-in reader, and is retired so it cannot return after sign-out', () => {
  const { els, store } = run({ signedIn: true, loginUrlKnown: true, nudgeSeen: false })
  assert.equal(els.nudge.hidden, true)
  assert.equal(store['docs-account-signin-nudge-seen'], '1')
})

test('dismissing it records that it was seen', () => {
  const { els, store } = run({ signedIn: false, loginUrlKnown: true, nudgeSeen: false })
  assert.equal(els.nudge.hidden, false)

  els.dismiss.handlers.click()

  assert.equal(els.nudge.hidden, true)
  assert.equal(store['docs-account-signin-nudge-seen'], '1')
})

test('engaging with sign-in retires it', () => {
  const { els, store } = run({ signedIn: false, loginUrlKnown: true, nudgeSeen: false })

  els.signin.handlers.click({ preventDefault () {} })

  assert.equal(els.nudge.hidden, true)
  assert.equal(store['docs-account-signin-nudge-seen'], '1')
})

// The Ask AI panel opens the same modal via this event rather than the header
// link, so it has to retire the nudge too.
test('opening the modal from the Ask AI panel retires it', () => {
  const { els, store, listeners } = run({ signedIn: false, loginUrlKnown: true, nudgeSeen: false })

  listeners['docs-account:open-signin']()

  assert.equal(els.nudge.hidden, true)
  assert.equal(store['docs-account-signin-nudge-seen'], '1')
})

// Private browsing / blocked site data: reading storage throws. Failing closed
// keeps a broken storage API from turning the nudge into a nag on every page
// view, and the throw must not take the rest of the account UI down with it.
test('fails closed when storage is unavailable', () => {
  const { els } = run({ signedIn: false, loginUrlKnown: true, nudgeSeen: false, storageThrows: true })

  assert.equal(els.nudge.hidden, true, 'no nudge when we cannot know if it was seen')
  assert.equal(els.signin.hidden, false, 'the sign-in link itself still renders')
})

test('a dismissal click still hides it when storage throws', () => {
  const { els } = run({ signedIn: false, loginUrlKnown: true, nudgeSeen: false, storageThrows: true })
  els.nudge.hidden = false // as if a working read had shown it

  els.dismiss.handlers.click()

  assert.equal(els.nudge.hidden, true)
})

// docs-ui's preview has no docs-site behind it, so the session probe never
// answers. Without this the account UI is invisible in the one place built for
// reviewing frontend changes.
test('shows in the docs-ui preview, which has no auth backend', () => {
  const { els } = run({ signedIn: false, loginUrlKnown: false, nudgeSeen: false, uiPreview: true })

  assert.equal(els.container.hidden, false, 'account control is revealed')
  assert.equal(els.signin.hidden, false, 'Sign in is visible')
  assert.equal(els.nudge.hidden, false, 'and so is the nudge under it')
})

test('the preview escape hatch is off on a real docs build', () => {
  const { els } = run({ signedIn: false, loginUrlKnown: false, nudgeSeen: false, uiPreview: false })

  assert.equal(els.container.hidden, true)
  assert.equal(els.signin.hidden, true)
})
