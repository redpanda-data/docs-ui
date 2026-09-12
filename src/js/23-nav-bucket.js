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
    initBucketVersionSelectors(document)

    // Initialize version toggle buttons
    initVersionToggles(document)

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
    // Delegated: child buckets inside a collapsed parent arrive later via
    // hydrate(), so per-button listeners bound at load would miss them.
    // Capture phase, because 01-nav.js stops click propagation at
    // .nav-container and a bubbling listener on document would never fire.
    document.addEventListener('click', function (e) {
      var caretBtn = e.target.closest && e.target.closest('.nav-bucket-caret-btn')
      if (!caretBtn) return
      e.preventDefault()
      toggleBucket(caretBtn)
    }, true)
  }

  /**
   * Collapsed buckets ship their nav tree inside an inert <template> (see
   * nav-bucket-recursive.hbs) so the hidden trees never enter the document.
   * Move the fragment into place the first time the bucket is expanded, then
   * tell 01-nav.js (item click handling) and this file (nested bucket version
   * selectors) about the new subtree.
   */
  function hydrate (content) {
    var tpl = content.querySelector(':scope > template[data-nav-lazy]')
    if (!tpl) return
    var fragment = tpl.content.cloneNode(true)
    content.replaceChild(fragment, tpl)
    initBucketVersionSelectors(content)
    initVersionToggles(content)
    content.dispatchEvent(new window.CustomEvent('nav:hydrated', { bubbles: true }))
  }
  window.hydrateNavBucket = hydrate

  /**
   * Toggle a bucket's expanded/collapsed state
   */
  function toggleBucket (caretBtn) {
    var bucket = caretBtn.closest('.nav-bucket')
    // Use direct child selector to avoid selecting nested bucket content
    var content = bucket.querySelector(':scope > .nav-bucket-content')
    if (!content) return
    var isExpanded = !content.classList.contains('is-collapsed')

    if (!isExpanded) hydrate(content)

    // Toggle expanded state
    content.classList.toggle('is-collapsed', isExpanded)
  }

  /**
   * Initialize per-bucket version selector dropdowns
   */
  function initBucketVersionSelectors (root) {
    var versionSelectors = root.querySelectorAll('[data-bucket-version]')

    versionSelectors.forEach(function (selector) {
      var btn = selector.querySelector('.nav-bucket-version-btn')
      var menu = selector.querySelector('.nav-bucket-version-menu')

      if (!btn || !menu || selector.dataset.bound) return
      selector.dataset.bound = 'true'

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
  function initVersionToggles (root) {
    var toggleButtons = root.querySelectorAll('[data-version-toggle]')

    toggleButtons.forEach(function (toggleBtn) {
      if (toggleBtn.dataset.bound) return
      toggleBtn.dataset.bound = 'true'
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
