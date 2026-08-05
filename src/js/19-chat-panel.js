/* global localStorage */
;(function () {
  'use strict'

  // DOM elements
  var chatPanel = document.querySelector('[data-chat-panel]')
  var main = document.querySelector('main.article')

  if (!chatPanel) return

  // Storage keys for persisting panel state
  var STORAGE_KEY = 'redpanda-chat-panel-open'
  var FULLSCREEN_KEY = 'redpanda-chat-panel-fullscreen'

  // State
  var isOpen = false

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
    // Wait for panel animation and React to be ready, then submit query
    setTimeout(function () {
      if (typeof window.submitChatQuery === 'function') {
        window.submitChatQuery(query, autoSubmit !== false)
      }
    }, 100)
  }

  // Functions
  function openPanel (restored) {
    isOpen = true
    chatPanel.classList.add('is-open')
    chatPanel.setAttribute('aria-hidden', 'false')
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

  // Restore state on page load
  restoreState()
})()
