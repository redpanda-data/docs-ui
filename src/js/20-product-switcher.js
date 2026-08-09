/**
 * Product Switcher
 * Dropdown menu for switching between Redpanda products (ADP, Data Platform, etc.)
 */
;(function () {
  'use strict'

  var switcher = document.querySelector('[data-product-switcher]')
  if (!switcher) return

  var toggle = switcher.querySelector('[data-product-toggle]')
  var menu = switcher.querySelector('[data-product-menu]')
  var caret = switcher.querySelector('.sb-product-caret')
  var isOpen = false

  // Toggle menu open/close
  function openMenu () {
    isOpen = true
    menu.style.display = 'block'
    toggle.classList.add('is-open')
    toggle.setAttribute('aria-expanded', 'true')
    if (caret) caret.classList.add('rot')
  }

  function closeMenu () {
    isOpen = false
    menu.style.display = 'none'
    toggle.classList.remove('is-open')
    toggle.setAttribute('aria-expanded', 'false')
    if (caret) caret.classList.remove('rot')
  }

  function toggleMenu () {
    if (isOpen) {
      closeMenu()
    } else {
      openMenu()
    }
  }

  // Toggle on button click
  toggle.addEventListener('click', function (e) {
    e.stopPropagation()
    toggleMenu()
  })

  // Close on click outside
  document.addEventListener('mousedown', function (e) {
    if (!switcher.contains(e.target) && isOpen) {
      closeMenu()
    }
  })

  // Close on Escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen) {
      closeMenu()
    }
  })

  // Navigate to selected product
  menu.querySelectorAll('.sb-product-opt').forEach(function (opt) {
    opt.addEventListener('click', function () {
      var url = this.getAttribute('data-product-url')
      if (url) {
        window.location.href = url
      }
    })
  })
})()
