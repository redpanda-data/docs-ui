/**
 * Nav Bucket interactions for unified navigation
 * Handles bucket expand/collapse and per-bucket version selectors
 */
;(function () {
  'use strict'

  // Initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', init)

  function init () {
    // Initialize bucket toggles
    initBucketToggles()

    // Initialize per-bucket version selectors
    initBucketVersionSelectors()

    // Initialize version toggle buttons
    initVersionToggles()

    // Global escape handler
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeAllVersionMenus()
      }
    })

    // Click outside to close version menus
    document.addEventListener('click', function (e) {
      if (!e.target.closest('[data-bucket-version]')) {
        closeAllVersionMenus()
      }
    })
  }

  /**
   * Initialize bucket expand/collapse toggles
   */
  function initBucketToggles () {
    // Handle clicks on the caret button to toggle bucket
    var caretBtns = document.querySelectorAll('.nav-bucket-caret-btn')
    caretBtns.forEach(function (caretBtn) {
      caretBtn.addEventListener('click', function (e) {
        e.preventDefault()
        toggleBucket(caretBtn)
      })
    })
  }

  /**
   * Toggle a bucket's expanded/collapsed state
   */
  function toggleBucket (caretBtn) {
    var bucket = caretBtn.closest('.nav-bucket')
    // Use direct child selector to avoid selecting nested bucket content
    var content = bucket.querySelector(':scope > .nav-bucket-content')
    var isExpanded = !content.classList.contains('is-collapsed')

    // Toggle expanded state
    if (content) {
      content.classList.toggle('is-collapsed', isExpanded)
    }
  }

  /**
   * Initialize per-bucket version selector dropdowns
   */
  function initBucketVersionSelectors () {
    var versionSelectors = document.querySelectorAll('[data-bucket-version]')

    versionSelectors.forEach(function (selector) {
      var btn = selector.querySelector('.nav-bucket-version-btn')
      var menu = selector.querySelector('.nav-bucket-version-menu')

      if (!btn || !menu) return

      btn.addEventListener('click', function (e) {
        e.preventDefault()
        e.stopPropagation()

        var isOpen = btn.getAttribute('aria-expanded') === 'true'
        var bucket = selector.closest('.nav-bucket')

        // Close all other menus first
        closeAllVersionMenus()

        if (!isOpen) {
          btn.setAttribute('aria-expanded', 'true')
          menu.style.display = 'block'
          // Add class to bucket for z-index elevation (fallback for :has())
          if (bucket) bucket.classList.add('is-dropdown-open')
        }
      })

      // Close on option click (navigation will happen via href)
      var options = menu.querySelectorAll('.nav-bucket-version-opt')
      options.forEach(function (opt) {
        opt.addEventListener('click', function () {
          closeAllVersionMenus()
        })
      })
    })
  }

  /**
   * Close all version selector menus
   */
  function closeAllVersionMenus () {
    var versionSelectors = document.querySelectorAll('[data-bucket-version]')

    versionSelectors.forEach(function (selector) {
      var btn = selector.querySelector('.nav-bucket-version-btn')
      var menu = selector.querySelector('.nav-bucket-version-menu')
      var bucket = selector.closest('.nav-bucket')

      if (btn) btn.setAttribute('aria-expanded', 'false')
      if (menu) menu.style.display = 'none'
      // Remove z-index elevation class
      if (bucket) bucket.classList.remove('is-dropdown-open')
    })
  }

  /**
   * Initialize version toggle buttons (show/hide older versions)
   */
  function initVersionToggles () {
    var toggleButtons = document.querySelectorAll('[data-version-toggle]')

    toggleButtons.forEach(function (toggleBtn) {
      toggleBtn.addEventListener('click', function (e) {
        e.preventDefault()
        e.stopPropagation()

        var menu = toggleBtn.closest('.nav-bucket-version-menu')
        if (!menu) return

        var olderVersions = menu.querySelector('.nav-bucket-version-older')
        var showText = toggleBtn.querySelector('.version-toggle-show')
        var hideText = toggleBtn.querySelector('.version-toggle-hide')
        var chevron = toggleBtn.querySelector('svg')

        if (!olderVersions) return

        var isExpanded = olderVersions.style.display !== 'none'

        if (isExpanded) {
          // Collapse
          olderVersions.style.display = 'none'
          showText.style.display = ''
          hideText.style.display = 'none'
          if (chevron) chevron.style.transform = ''
        } else {
          // Expand
          olderVersions.style.display = 'block'
          showText.style.display = 'none'
          hideText.style.display = ''
          if (chevron) chevron.style.transform = 'rotate(180deg)'
        }
      })
    })
  }
})()
