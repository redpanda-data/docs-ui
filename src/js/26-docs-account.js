/* global sessionStorage, fetch */
/**
 * Docs account control in the header (sign in / user menu).
 *
 * Signed-in state comes from the JS-readable rp_docs_auth hint cookie, which
 * the docs login flow sets/clears alongside the HttpOnly session cookie. The
 * email shown in the menu comes from GET /auth/me (verified server-side,
 * cached in sessionStorage against the hint state). Dropdown open/close is
 * handled generically by 25-topbar-dropdown.js.
 */
;(function () {
  'use strict'

  var container = document.querySelector('[data-docs-account]')
  if (!container) return

  var signinLink = container.querySelector('[data-account-signin]')
  var menu = container.querySelector('[data-account-menu]')
  var avatar = container.querySelector('[data-account-avatar]')
  var emailEl = container.querySelector('[data-account-email]')
  var signoutLink = container.querySelector('[data-account-signout]')
  var modal = container.querySelector('[data-signin-modal]')
  var modalCta = container.querySelector('[data-signin-modal-continue]')

  var CACHE_KEY = 'docs-account-me'

  function hasAuthHint () {
    return /(?:^|;\s*)rp_docs_auth=1(?:;|$)/.test(document.cookie)
  }

  function returnTo () {
    return encodeURIComponent(window.location.pathname + window.location.search)
  }

  // Feature modal shown before sending the user to /login
  function openModal () {
    if (!modal) return
    modal.hidden = false
    document.addEventListener('keydown', onModalKey)
  }
  function closeModal () {
    if (!modal) return
    modal.hidden = true
    document.removeEventListener('keydown', onModalKey)
  }
  function onModalKey (e) {
    if (e.key === 'Escape') closeModal()
  }
  if (modal) {
    modal.querySelectorAll('[data-signin-modal-close]').forEach(function (el) {
      el.addEventListener('click', closeModal)
    })
  }
  if (modalCta) {
    // /login can cold-start (~6s). Show progress and block re-clicks so it
    // doesn't feel stuck or fire duplicate sign-in navigations.
    modalCta.addEventListener('click', function () {
      modalCta.classList.add('is-loading')
      modalCta.textContent = 'Signing in…'
    })
  }
  signinLink.addEventListener('click', function (e) {
    if (!modal) return // no modal markup — let the link navigate to /login
    e.preventDefault()
    openModal()
  })

  function showUser (user) {
    var email = user && user.email
    if (email) {
      emailEl.textContent = email
      avatar.textContent = email.charAt(0).toUpperCase()
    } else {
      emailEl.textContent = 'Signed in'
      avatar.textContent = '●'
    }
  }

  function render () {
    var signedIn = hasAuthHint()
    signinLink.hidden = signedIn
    menu.hidden = !signedIn
    container.hidden = false
    signinLink.href = '/login?return_to=' + returnTo()
    signoutLink.href = '/logout?return_to=' + returnTo()
    if (modalCta) modalCta.href = '/login?return_to=' + returnTo()

    // Signed in: the console link lives in the account dropdown, so hide the
    // standalone toolbar/overflow Cloud Console links (avoid two paths)
    document.querySelectorAll('[data-cloud-link]').forEach(function (el) {
      el.hidden = signedIn
    })

    if (!signedIn) return

    // Cached identity (revalidated when the hint state changes)
    try {
      var cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null')
      if (cached && cached.email !== undefined) {
        showUser(cached)
        return
      }
    } catch (e) { /* fall through */ }

    showUser(null)
    fetch('/auth/me', { credentials: 'include' })
      .then(function (res) { return res.ok ? res.json() : null })
      .then(function (me) {
        if (!me) return
        showUser(me)
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify({ email: me.email || null }))
        } catch (e) { /* private browsing */ }
      })
      .catch(function () { /* header still shows generic signed-in state */ })
  }

  // Drop the cached identity whenever the login state flips (login/logout)
  try {
    var cachedState = sessionStorage.getItem(CACHE_KEY + '-hint')
    var hint = String(hasAuthHint())
    if (cachedState !== hint) {
      sessionStorage.removeItem(CACHE_KEY)
      sessionStorage.setItem(CACHE_KEY + '-hint', hint)
    }
  } catch (e) { /* private browsing */ }

  render()

  // The Ask AI panel's session probe may learn the identity first — reuse it
  window.addEventListener('kapa-session', function (e) {
    if (e.detail && e.detail.authenticated && e.detail.user) {
      showUser(e.detail.user)
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ email: e.detail.user.email || null }))
      } catch (err) { /* private browsing */ }
    }
  })
})()
