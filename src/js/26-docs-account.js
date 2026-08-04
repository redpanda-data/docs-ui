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

  // Sign-in/out land on cold Netlify functions (docs-login.mjs, plus the
  // mcp-oauth.mjs callback leg) and a scale-to-zero Neon database — a cold
  // click can stall for seconds. Warm both functions and resume the database
  // as soon as the user shows intent (opens the sign-in modal or the account
  // menu), so the real click lands warm. Throttled; failures don't matter.
  var lastWarm = 0
  function warm () {
    var now = Date.now()
    if (now - lastWarm < 60000) return
    lastWarm = now
    fetch('/auth/warm').catch(function () {})
    fetch('/.well-known/jwks.json').catch(function () {})
  }

  function hasAuthHint () {
    return /(?:^|;\s*)rp_docs_auth=1(?:;|$)/.test(document.cookie)
  }

  function returnTo () {
    return encodeURIComponent(window.location.pathname + window.location.search)
  }

  // Feature modal shown before sending the user to /login.
  // It is an aria-modal dialog, so manage focus: move focus in on open, trap
  // Tab within it, and restore focus to the opener on close (WCAG 2.4.3).
  var lastFocused = null
  var modalCard = modal && modal.querySelector('.tb-signin-modal-card')

  function modalFocusables () {
    if (!modal) return []
    return Array.prototype.slice
      .call(modal.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter(function (el) { return el.offsetParent !== null }) // visible only
  }

  function openModal () {
    if (!modal) return
    warm()
    lastFocused = document.activeElement
    modal.hidden = false
    document.addEventListener('keydown', onModalKey)
    // Move focus into the dialog: the card itself (so the label is announced),
    // falling back to its first focusable control.
    if (modalCard) {
      modalCard.setAttribute('tabindex', '-1')
      modalCard.focus()
    } else {
      var f = modalFocusables()
      if (f.length) f[0].focus()
    }
  }
  function closeModal () {
    if (!modal) return
    modal.hidden = true
    document.removeEventListener('keydown', onModalKey)
    // Restore focus to whatever opened the modal (the Sign in trigger).
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus()
    lastFocused = null
  }
  function onModalKey (e) {
    if (e.key === 'Escape') { closeModal(); return }
    if (e.key !== 'Tab') return
    // Trap Tab within the dialog so focus can't reach the page behind it.
    var f = modalFocusables()
    if (!f.length) return
    var first = f[0]
    var last = f[f.length - 1]
    var active = document.activeElement
    if (e.shiftKey) {
      if (active === first || active === modalCard || !modal.contains(active)) {
        e.preventDefault()
        last.focus()
      }
    } else if (active === last || !modal.contains(active)) {
      e.preventDefault()
      first.focus()
    }
  }
  if (modal) {
    // The navbar is its own low stacking context (z-index 5) and the Ask AI
    // drawer sits at 120, so inside the navbar the modal would render UNDER an
    // open chat panel despite its own huge z-index. Re-parent it to <body> so
    // it competes at the root (all .tb-signin-modal* CSS is unscoped).
    document.body.appendChild(modal)
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

  // Other surfaces (the Ask AI panel's sign-in upsell) defer to this modal so
  // the feature pitch + privacy note live in one place, and can request a
  // warm-up when they show their own sign-in prompt (19-chat-panel.js).
  window.addEventListener('docs-account:open-signin', openModal)
  window.addEventListener('docs-account:warm', warm)

  // Opening the account menu signals sign-out (or console) intent — warm now
  // so the /logout navigation doesn't hit a cold function.
  var accountTrigger = container.querySelector('.tb-account-trigger')
  if (accountTrigger) accountTrigger.addEventListener('click', warm)

  // Same progress treatment as sign-in: the dropdown stays open during the
  // /logout navigation, so show state there and block double clicks.
  signoutLink.addEventListener('click', function (e) {
    if (signoutLink.classList.contains('is-loading')) {
      e.preventDefault()
      return
    }
    signoutLink.classList.add('is-loading')
    signoutLink.textContent = 'Signing out…'
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
    // disclosed=1: the modal shows the privacy/data-collection note itself, so
    // /login can skip the server interstitial (which exists to show that note)
    // and go straight to Auth0. The bare signinLink href (middle-click, or no
    // modal markup) stays undisclosed and gets the interstitial.
    if (modalCta) modalCta.href = '/login?disclosed=1&return_to=' + returnTo()

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

  // Surface a login failure bounced back by the OAuth callback (docs-login.mjs /
  // mcp-oauth.mjs redirect to ?login_error=<code>), then strip the param so a
  // refresh or a re-click of sign-in doesn't repeat the message.
  function showLoginError () {
    var params
    try { params = new URLSearchParams(window.location.search) } catch (e) { return }
    var code = params.get('login_error')
    if (!code) return
    var MESSAGES = {
      upstream_failed: 'Sorry, sign-in couldn’t be completed. Please try again.',
      work_email_required: 'Please sign in with your work Redpanda Cloud account.',
      state_mismatch: 'Your sign-in link expired. Please try again.',
    }
    var bar = document.createElement('div')
    bar.setAttribute('role', 'alert')
    bar.style.cssText = [
      'position:fixed;top:0;left:0;right:0;z-index:1000',
      'display:flex;align-items:center;justify-content:center;gap:12px',
      'padding:10px 16px;background:#fdecea;color:#611a15',
      'border-bottom:1px solid #f5c6cb',
      'font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    ].join(';')
    var text = document.createElement('span')
    text.textContent = MESSAGES[code] || 'Sorry, sign-in couldn’t be completed. Please try again.'
    var close = document.createElement('button')
    close.type = 'button'
    close.setAttribute('aria-label', 'Dismiss')
    close.textContent = '×'
    close.style.cssText = 'background:none;border:0;font-size:18px;line-height:1;cursor:pointer;color:inherit'
    close.addEventListener('click', function () { bar.remove() })
    bar.appendChild(text)
    bar.appendChild(close)
    document.body.appendChild(bar)

    params.delete('login_error')
    var qs = params.toString()
    try {
      window.history.replaceState({}, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash)
    } catch (e) { /* ignore */ }
  }
  showLoginError()

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
