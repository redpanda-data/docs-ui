/**
 * Topbar dropdown toggle
 * Handles click/tap interactions for dropdown menus in the topbar
 */
;(function () {
  'use strict'

  // Handle dropdown toggle on click (for mobile/touch)
  document.addEventListener('click', function (e) {
    const trigger = e.target.closest('.tb-dropdown-trigger')

    if (trigger) {
      e.preventDefault()
      const isExpanded = trigger.getAttribute('aria-expanded') === 'true'

      // Close all other dropdowns
      document.querySelectorAll('.tb-dropdown-trigger[aria-expanded="true"]').forEach(function (otherTrigger) {
        if (otherTrigger !== trigger) {
          otherTrigger.setAttribute('aria-expanded', 'false')
        }
      })

      // Toggle this dropdown
      trigger.setAttribute('aria-expanded', isExpanded ? 'false' : 'true')
    } else {
      // Click outside - close all dropdowns
      const clickedInsideDropdown = e.target.closest('.tb-dropdown')
      if (!clickedInsideDropdown) {
        document.querySelectorAll('.tb-dropdown-trigger[aria-expanded="true"]').forEach(function (trigger) {
          trigger.setAttribute('aria-expanded', 'false')
        })
      }
    }
  })

  // Close dropdown on escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.tb-dropdown-trigger[aria-expanded="true"]').forEach(function (trigger) {
        trigger.setAttribute('aria-expanded', 'false')
        trigger.focus()
      })
    }
  })
})()
