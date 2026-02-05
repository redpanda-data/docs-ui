;(function () {
  'use strict'

  /*
   * Component Tools FAB (Floating Action Button)
   * =============================================
   * A FAB is a circular button that floats above the UI, typically in the
   * bottom-right corner. It provides quick access to primary actions.
   *
   * This script handles:
   * - FAB menu expand/collapse on click
   * - First-time visitor tooltip (pulsing animation, auto-dismiss)
   * - Keyboard navigation (Escape to close, arrow keys in menu)
   * - Click-outside-to-close behavior
   *
   * The FAB visibility is controlled by Handlebars templates using
   * page.componentVersion.asciidoc.attributes.toc-tools-title.
   * This JS only handles interactive behavior once the FAB is rendered.
   */

  // Configuration
  var STORAGE_KEY = 'componentToolsFabSeen'
  var TOOLTIP_AUTO_DISMISS_MS = 5000

  // Add class to parent sidebar for styling (avoids expensive :has() selector)
  var tocTools = document.getElementById('toc-tools')
  if (tocTools) {
    var tocSidebar = tocTools.closest('.toc.sidebar')
    if (tocSidebar) {
      tocSidebar.classList.add('has-toc-tools')
    }
  }

  // FAB elements - only shown on mobile (CSS hides on desktop where TOC section is visible)
  var fab = document.getElementById('component-tools-fab')
  var trigger = document.getElementById('component-tools-fab-trigger')
  var menu = document.getElementById('component-tools-menu')
  var tooltip = document.getElementById('component-tools-fab-tooltip')
  var tooltipDismiss = tooltip ? tooltip.querySelector('.tooltip-dismiss') : null

  if (!fab || !trigger || !menu) return

  // Show FAB (CSS handles mobile-only visibility via media queries)
  fab.classList.add('is-visible')

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
      var firstItem = menu.querySelector('.component-tools-menu-item')
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
    var items = menu.querySelectorAll('.component-tools-menu-item')
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
