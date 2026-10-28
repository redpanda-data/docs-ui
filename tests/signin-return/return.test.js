/**
 * Where the header Sign in and Sign out links send the reader back to.
 *
 * The return address keeps the page's hash, so signing in from a section such
 * as a Solutions page's #take-to-production lands back on that section, not at
 * the top of the page. docs-login stores return_to whole and /auth/return
 * redirects to it, fragment included.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const SCRIPT = path.join(__dirname, '../../src/js/26-docs-account.js')

// Same stub DOM as tests/signin-nudge, with the location made configurable.
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
function run ({ signedIn, loginUrlKnown, nudgeSeen, storageThrows, uiPreview, store: sharedStore, location }) {
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

  const store = sharedStore || (nudgeSeen ? { 'docs-account-signin-nudge-seen': '1' } : {})
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
      location: location || { pathname: '/home/', search: '', hash: '' },
      history: { replaceState () {} },
      addEventListener: (t, fn) => { listeners[t] = fn },
      CustomEvent: class { constructor (type) { this.type = type } },
    },
  }
  vm.runInNewContext(fs.readFileSync(SCRIPT, 'utf8'), context)
  return { els, store, listeners }
}


const PAGE = { pathname: '/solutions/multiplayer-gaming/verify-end-to-end/', search: '', hash: '#take-to-production' }

test('header Sign in returns to the section the reader was on', () => {
  const { els } = run({ signedIn: false, loginUrlKnown: true, nudgeSeen: true, location: PAGE })
  assert.equal(els.signin.href, '/login?return_to=' + encodeURIComponent('/solutions/multiplayer-gaming/verify-end-to-end/#take-to-production'))
})

test('the query string and the hash are both kept, in order', () => {
  const { els } = run({ signedIn: false, loginUrlKnown: true, nudgeSeen: true, location: { pathname: '/streaming/current/get-started/', search: '?tab=cloud', hash: '#install' } })
  assert.equal(decodeURIComponent(els.signin.href.split('return_to=')[1]), '/streaming/current/get-started/?tab=cloud#install')
})

test('a page with no hash returns to the page alone', () => {
  const { els } = run({ signedIn: false, loginUrlKnown: true, nudgeSeen: true, location: { pathname: '/home/', search: '', hash: '' } })
  assert.equal(els.signin.href, '/login?return_to=' + encodeURIComponent('/home/'))
})

test('header Sign out keeps the hash too', () => {
  const { els } = run({ signedIn: true, loginUrlKnown: true, nudgeSeen: true, location: PAGE })
  assert.equal(els.signout.href, '/logout?return_to=' + encodeURIComponent('/solutions/multiplayer-gaming/verify-end-to-end/#take-to-production'))
})
