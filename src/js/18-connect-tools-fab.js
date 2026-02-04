;(function () {
  'use strict'

  // Configuration
  var CONNECT_COMPONENT = 'redpanda-connect'
  var STORAGE_KEY = 'connectToolsFabSeen'
  var TOOLTIP_AUTO_DISMISS_MS = 5000

  // Check if we're on a Connect page or in preview mode
  var navContainer = document.querySelector('.nav-container')
  var component = navContainer && navContainer.dataset.component
  var isPreview = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  var isConnectPage = component === CONNECT_COMPONENT || isPreview

  if (!isConnectPage) return

  // Show TOC Connect Tools section (desktop only)
  var tocConnectTools = document.getElementById('toc-connect-tools')
  if (tocConnectTools) {
    tocConnectTools.classList.add('is-visible')
    // Add class to parent sidebar for styling (avoids expensive :has() selector)
    var tocSidebar = tocConnectTools.closest('.toc.sidebar')
    if (tocSidebar) {
      tocSidebar.classList.add('has-connect-tools')
    }
  }

  // FAB is disabled - Connect Tools only shown in TOC on desktop
  // Mobile users can access tools via the main navigation
  var fab = document.getElementById('connect-tools-fab')
  var trigger = document.getElementById('connect-tools-fab-trigger')
  var menu = document.getElementById('connect-tools-menu')
  var tooltip = document.getElementById('connect-tools-fab-tooltip')
  var tooltipDismiss = tooltip ? tooltip.querySelector('.tooltip-dismiss') : null

  if (!fab || !trigger) return

  // Don't show FAB - desktop TOC only
  // fab.classList.add('is-visible')

  // Check first-time experience
  var hasSeenFab = false
  var autoDismissTimer
  try {
    hasSeenFab = window.localStorage.getItem(STORAGE_KEY) === 'true'
  } catch (e) {
    // localStorage not available
  }

  if (!hasSeenFab) {
    fab.classList.add('is-first-time')

    // Auto-dismiss tooltip after delay
    autoDismissTimer = setTimeout(function () {
      dismissTooltip()
    }, TOOLTIP_AUTO_DISMISS_MS)
  }

  // Toggle menu
  trigger.addEventListener('click', function (e) {
    e.stopPropagation()

    var isExpanded = fab.classList.toggle('is-expanded')
    trigger.setAttribute('aria-expanded', isExpanded ? 'true' : 'false')
    menu.setAttribute('aria-hidden', isExpanded ? 'false' : 'true')

    // Dismiss first-time experience on interaction
    if (fab.classList.contains('is-first-time')) {
      dismissTooltip()
    }

    // Focus first menu item when opened
    if (isExpanded) {
      var firstItem = menu.querySelector('.connect-tools-menu-item')
      if (firstItem) {
        setTimeout(function () {
          firstItem.focus()
        }, 100)
      }
    }
  })

  // Dismiss tooltip button
  if (tooltipDismiss) {
    tooltipDismiss.addEventListener('click', function (e) {
      e.stopPropagation()
      dismissTooltip()
    })
  }

  function dismissTooltip () {
    if (autoDismissTimer) {
      clearTimeout(autoDismissTimer)
    }
    fab.classList.remove('is-first-time')
    try {
      window.localStorage.setItem(STORAGE_KEY, 'true')
    } catch (e) {
      // localStorage not available
    }
  }

  // Close menu when clicking outside
  document.addEventListener('click', function (e) {
    if (fab.classList.contains('is-expanded') && !fab.contains(e.target)) {
      closeMenu()
    }
  })

  // Close menu on Escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && fab.classList.contains('is-expanded')) {
      closeMenu()
      trigger.focus()
    }
  })

  function closeMenu () {
    fab.classList.remove('is-expanded')
    trigger.setAttribute('aria-expanded', 'false')
    menu.setAttribute('aria-hidden', 'true')
  }

  // Keyboard navigation within menu
  menu.addEventListener('keydown', function (e) {
    var items = menu.querySelectorAll('.connect-tools-menu-item')
    var currentIndex = Array.prototype.indexOf.call(items, document.activeElement)

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      var nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0
      items[nextIndex].focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      var prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1
      items[prevIndex].focus()
    }
  })
})()
