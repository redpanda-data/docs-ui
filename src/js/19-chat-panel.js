/* global localStorage */
;(function () {
  'use strict'

  // DOM elements
  var chatPanel = document.querySelector('[data-chat-panel]')
  var main = document.querySelector('main.article')

  if (!chatPanel) return

  // Storage key for persisting panel state
  var STORAGE_KEY = 'redpanda-chat-panel-open'

  // State
  var isOpen = false

  // Event listeners
  chatPanel.querySelectorAll('[data-chat-action="close"]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      closePanel()
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
  function openPanel () {
    isOpen = true
    chatPanel.classList.add('is-open')
    chatPanel.setAttribute('aria-hidden', 'false')
    if (main) main.classList.add('chat-push')

    // Hide Ask AI button if it exists
    var askAiBtn = document.querySelector('[data-action="open-chat"]')
    if (askAiBtn) askAiBtn.style.display = 'none'

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
    chatPanel.setAttribute('aria-hidden', 'true')
    if (main) main.classList.remove('chat-push')

    // Show Ask AI button if it exists
    var askAiBtn = document.querySelector('[data-action="open-chat"]')
    if (askAiBtn) askAiBtn.style.display = ''

    // Remove from localStorage (panel explicitly closed)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch (e) {
      // localStorage not available, ignore
    }
  }

  // Restore panel state from localStorage on page load
  function restoreState () {
    try {
      var savedState = localStorage.getItem(STORAGE_KEY)
      if (savedState === 'true') {
        openPanel()
      }
    } catch (e) {
      // localStorage not available, ignore
    }
  }

  // Restore state on page load
  restoreState()
})()
