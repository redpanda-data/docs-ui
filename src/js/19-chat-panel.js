/* global localStorage */
;(function () {
  'use strict'

  // DOM elements
  var chatPanel = document.querySelector('[data-chat-panel]')
  var main = document.querySelector('main.article')

  if (!chatPanel) return

  // The panel is closed at load. `aria-hidden`+`transform:translateX(100%)` hide
  // it visually and from AT, but its controls (Close/Full-screen and, once React
  // mounts, the textarea/Submit/sign-in) stay in the keyboard tab order off-screen
  // — a keyboard user Tabs into invisible controls on every docs page (WCAG
  // 2.4.3/4.1.2). `inert` removes the whole subtree from focus AND the a11y tree;
  // openPanel/closePanel toggle it in lockstep with `is-open`.
  if ('inert' in chatPanel) chatPanel.inert = true

  // Storage keys for persisting panel state
  var STORAGE_KEY = 'redpanda-chat-panel-open'
  var FULLSCREEN_KEY = 'redpanda-chat-panel-fullscreen'

  // State
  var isOpen = false

  // The React drawer (AskAI.bundle.js + AskAI.bundle.css) is not in the page
  // markup. It is React plus both Kapa SDKs, and the anonymous-tier SDK pulls
  // in reCAPTCHA on mount, so shipping it on every pageview cost ~400 ms of
  // main-thread blocking on pages where nobody opens the drawer. Fetch it the
  // first time the drawer opens, or earlier on intent (hover/focus on an Ask AI
  // control) so the open itself feels instant. chat-panel.hbs leaves a spinner
  // in the mount node until React replaces it. kapaSession.bundle.js still
  // runs the session probe on every page, so the header's Sign in state does
  // not wait on this.
  var bundleSrc = chatPanel.getAttribute('data-askai-bundle')
  var bundleRequested = false
  var INTENT_SELECTOR = '[data-action="open-chat"], .custom-class-kapa, [data-kapa-trigger], ' +
    '#home-ask-form, .home-hero-chip, #dp-ask-form, .dp-hero-ask-chip, .ch3-hero-ask-input, .ch3-hero-ask-chip, ' +
    '[data-ask-ai], .ask-ai-btn'
  // Landing pages put an Ask AI input in the hero: asking is the primary action
  // there, so waiting for a hover would leave a fast typer racing the SDK's
  // browser check. Warm on the first interaction of any kind instead.
  var ASK_FORM_SELECTOR = '#home-ask-form, #dp-ask-form, .ch3-hero-ask-input'

  function loadAskAI () {
    if (bundleRequested || !bundleSrc) return
    bundleRequested = true
    var link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = bundleSrc.replace(/\.js$/, '.css')
    document.head.appendChild(link)
    var script = document.createElement('script')
    script.src = bundleSrc
    script.defer = true
    script.onerror = function () {
      bundleRequested = false // allow a retry on the next open
      var root = chatPanel.querySelector('#chat-panel-kapa-root')
      if (root && !root.dataset.mounted) {
        root.innerHTML = '<div class="chat-container"><div class="error-boundary">' +
          'Ask AI could not be loaded. Check your connection and try again.</div></div>'
      }
    }
    document.head.appendChild(script)
  }
  window.loadAskAI = loadAskAI

  // Warm the bundle on intent: pointer over or focus on any Ask AI trigger.
  // Passive listeners on the document, so no per-button wiring is needed for
  // triggers added by other partials (home hero, component homes, code blocks).
  function onIntent (e) {
    if (e.target && e.target.closest && e.target.closest(INTENT_SELECTOR)) loadAskAI()
  }
  document.addEventListener('pointerover', onIntent, { passive: true })
  document.addEventListener('focusin', onIntent, { passive: true })
  document.addEventListener('touchstart', onIntent, { passive: true })
  if (document.querySelector(ASK_FORM_SELECTOR)) {
    ;['pointermove', 'keydown', 'touchstart', 'scroll'].forEach(function (type) {
      document.addEventListener(type, loadAskAI, { once: true, passive: true })
    })
  }

  // Event listeners
  chatPanel.querySelectorAll('[data-chat-action="close"]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      closePanel()
    })
  })

  chatPanel.querySelectorAll('[data-chat-action="expand"]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var fullscreen = chatPanel.classList.toggle('is-fullscreen')
      try {
        localStorage.setItem(FULLSCREEN_KEY, String(fullscreen))
      } catch (e) {
        // localStorage not available, ignore
      }
    })
  })

  // Ask AI button in header (opens chat panel)
  document.querySelectorAll('[data-action="open-chat"]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      openPanel()
    })
  })

  // Keyboard shortcut: Cmd/Ctrl + K
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault()
      if (isOpen) {
        closePanel()
      } else {
        openPanel()
      }
    }
  })

  // Global trigger for opening chat from other components
  window.openChatPanel = function () {
    openPanel()
  }

  // Global trigger for opening chat with a pre-filled query
  // Used by playground error buttons and code block Ask AI buttons
  window.openChatWithQuery = function (query, autoSubmit) {
    openPanel()
    // submitChatQuery is registered only once a chat interface component mounts.
    // During the initial session probe App renders a spinner and mounts neither
    // interface, so a fixed 100ms timer can fire before it exists and silently
    // drop the query. Poll on a short interval up to a bounded deadline instead.
    var waited = 0
    var step = 100
    // Covers the session-probe abort budget (8 s) plus the bundle download,
    // which only starts on open now, so a slow connection needs the headroom.
    var deadline = 20000
    var timer = setInterval(function () {
      if (typeof window.submitChatQuery === 'function') {
        clearInterval(timer)
        window.submitChatQuery(query, autoSubmit !== false)
      } else if ((waited += step) >= deadline) {
        clearInterval(timer)
      }
    }, step)
  }

  // Functions
  function openPanel (restored) {
    isOpen = true
    loadAskAI()
    chatPanel.classList.add('is-open')
    chatPanel.setAttribute('aria-hidden', 'false')
    if ('inert' in chatPanel) chatPanel.inert = false
    if (main) main.classList.add('chat-push')

    // Signed-out panels show a sign-in prompt — pre-warm the login backend
    // (handled by 26-docs-account.js) so a sign-in click lands warm. Only on
    // explicit opens: the page-load restore path would otherwise fire warm-up
    // requests on every pageview for users who keep the panel open.
    if (!restored && !/(?:^|;\s*)rp_docs_auth=1(?:;|$)/.test(document.cookie)) {
      window.dispatchEvent(new window.CustomEvent('docs-account:warm'))
    }

    // Hide all Ask AI buttons if they exist
    var askAiBtns = document.querySelectorAll('[data-action="open-chat"]')
    askAiBtns.forEach(function (btn) {
      btn.style.display = 'none'
    })

    // Move focus into the panel so keyboard/AT users land inside it on open
    // (pairs with the focus-restore on close). The close control is part of the
    // static panel chrome, present before the React drawer mounts.
    if (!restored) {
      var closeBtn = chatPanel.querySelector('[data-chat-action="close"]')
      if (closeBtn && typeof closeBtn.focus === 'function') { try { closeBtn.focus() } catch (e) { /* ignore */ } }
    }

    // Persist state to localStorage
    try {
      localStorage.setItem(STORAGE_KEY, 'true')
    } catch (e) {
      // localStorage not available, ignore
    }
  }

  function closePanel () {
    isOpen = false
    chatPanel.classList.remove('is-open')
    if (main) main.classList.remove('chat-push')

    // Show all Ask AI buttons if they exist
    var askAiBtns = document.querySelectorAll('[data-action="open-chat"]')
    askAiBtns.forEach(function (btn) {
      btn.style.display = ''
    })

    // Move focus to the (now-visible) opener BEFORE hiding the panel, so a
    // keyboard/AT user who activated the in-panel Close control isn't stranded
    // inside an aria-hidden subtree (WCAG 2.4.3 / 4.1.2). Then hide the panel.
    var opener = document.querySelector('[data-action="open-chat"]')
    if (opener && typeof opener.focus === 'function') { try { opener.focus() } catch (e) { /* ignore */ } }
    chatPanel.setAttribute('aria-hidden', 'true')
    // Focus is now on the opener (outside the panel), so making the subtree inert
    // won't strand the active element. Pulls all panel controls back out of the
    // tab order until the next open.
    if ('inert' in chatPanel) chatPanel.inert = true

    // Remove from localStorage (panel explicitly closed)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch (e) {
      // localStorage not available, ignore
    }
  }

  // Restore panel state from localStorage on page load
  // Only restore on desktop to avoid drawer filling mobile screen
  // 520px matches the CSS breakpoint where chat-panel becomes full-width
  function restoreState () {
    try {
      var savedState = localStorage.getItem(STORAGE_KEY)
      var isMobile = window.innerWidth <= 520
      if (localStorage.getItem(FULLSCREEN_KEY) === 'true') {
        chatPanel.classList.add('is-fullscreen')
      }
      if (savedState === 'true' && !isMobile) {
        openPanel(true)
      }
    } catch (e) {
      // localStorage not available, ignore
    }
  }

  // The Ask AI agent can navigate the reader in the same tab (navigate_to_page
  // and switch_product in react/agentTools.js). It fires this first so the
  // persisted open flag doesn't reopen the drawer on top of the page it was
  // just asked to show. Storage is cleared even when the panel isn't currently
  // open (mobile skips the restore, so a stale flag would otherwise reopen it
  // on the reader's next desktop visit).
  window.addEventListener('docs-chat:close', function () {
    if (isOpen) {
      closePanel()
      return
    }
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch (e) {
      // localStorage not available, ignore
    }
  })

  // Restore state on page load
  restoreState()
})()
