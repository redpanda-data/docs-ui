;(function () {
  'use strict'

  var container = document.querySelector('.topbar-crumbs')
  if (!container) return

  var breadcrumbsNav = container.querySelector('.breadcrumbs')
  if (!breadcrumbsNav) return

  var ul = breadcrumbsNav.querySelector('ul')
  if (!ul) return

  var items = Array.from(ul.querySelectorAll('li'))
  if (items.length <= 3) return // No need to collapse if 3 or fewer items

  // Create ellipsis button and dropdown container
  var ellipsisLi = document.createElement('li')
  ellipsisLi.className = 'bc-ellipsis-li'

  var ellipsisBtn = document.createElement('button')
  ellipsisBtn.className = 'bc-ellipsis'
  ellipsisBtn.type = 'button'
  ellipsisBtn.setAttribute('aria-label', 'Show all breadcrumbs')
  ellipsisBtn.setAttribute('aria-expanded', 'false')
  ellipsisBtn.innerHTML = '&hellip;'
  ellipsisLi.appendChild(ellipsisBtn)

  // Insert ellipsis after first item
  if (items.length > 1) {
    items[0].after(ellipsisLi)
  }

  // Track which items are hidden
  var hiddenItems = []
  var dropdown = null
  var isDropdownOpen = false

  // Measure true width of all items by temporarily removing constraints
  function measureTrueWidth () {
    // Save original styles
    var originalFlexShrink = []
    var originalMinWidth = []
    var originalOverflow = []

    items.forEach(function (item, i) {
      originalFlexShrink[i] = item.style.flexShrink
      originalMinWidth[i] = item.style.minWidth
      originalOverflow[i] = item.style.overflow
      // Remove constraints to get natural width
      item.style.flexShrink = '0'
      item.style.minWidth = 'auto'
      item.style.overflow = 'visible'
    })

    // Force reflow to get accurate measurements
    ul.offsetWidth // eslint-disable-line no-unused-expressions

    // Calculate total width of all visible items
    var totalWidth = 0
    items.forEach(function (item) {
      if (!item.classList.contains('bc-hidden')) {
        totalWidth += item.offsetWidth
      }
    })

    // Restore original styles
    items.forEach(function (item, i) {
      item.style.flexShrink = originalFlexShrink[i]
      item.style.minWidth = originalMinWidth[i]
      item.style.overflow = originalOverflow[i]
    })

    return totalWidth
  }

  // Check if breadcrumbs overflow and collapse if needed
  function checkOverflow () {
    // Close dropdown if open
    closeDropdown()

    // Reset to expanded state first
    container.classList.remove('is-collapsed')
    items.forEach(function (item) {
      item.classList.remove('bc-hidden')
    })
    hiddenItems = []

    // Get available width (container width)
    var availableWidth = container.clientWidth

    // Measure true total width of all items
    var totalWidth = measureTrueWidth()

    // If overflowing, collapse middle items
    if (totalWidth > availableWidth && items.length > 3) {
      container.classList.add('is-collapsed')
      // Hide middle items (keep first, ellipsis, and last two)
      for (var i = 1; i < items.length - 2; i++) {
        items[i].classList.add('bc-hidden')
        hiddenItems.push(items[i])
      }
    }
  }

  // Create and show dropdown with hidden items
  function showDropdown () {
    if (hiddenItems.length === 0) return

    isDropdownOpen = true
    ellipsisBtn.classList.add('is-open')
    ellipsisBtn.setAttribute('aria-expanded', 'true')

    dropdown = document.createElement('div')
    dropdown.className = 'bc-dropdown'

    hiddenItems.forEach(function (item) {
      var link = item.querySelector('a')
      if (link) {
        var dropdownLink = document.createElement('a')
        dropdownLink.href = link.href
        dropdownLink.textContent = link.textContent
        dropdown.appendChild(dropdownLink)
      } else {
        var span = item.querySelector('span')
        if (span) {
          var dropdownSpan = document.createElement('a')
          dropdownSpan.href = '#'
          dropdownSpan.textContent = span.textContent
          dropdown.appendChild(dropdownSpan)
        }
      }
    })

    ellipsisLi.appendChild(dropdown)
  }

  // Close dropdown
  function closeDropdown () {
    if (dropdown) {
      dropdown.remove()
      dropdown = null
    }
    isDropdownOpen = false
    ellipsisBtn.classList.remove('is-open')
    ellipsisBtn.setAttribute('aria-expanded', 'false')
  }

  // Toggle dropdown on ellipsis click
  ellipsisBtn.addEventListener('click', function (e) {
    e.preventDefault()
    e.stopPropagation()

    if (isDropdownOpen) {
      closeDropdown()
    } else {
      showDropdown()
    }
  })

  // Close dropdown when clicking outside
  document.addEventListener('click', function (e) {
    if (isDropdownOpen && !ellipsisLi.contains(e.target)) {
      closeDropdown()
    }
  })

  // Close dropdown on escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isDropdownOpen) {
      closeDropdown()
      ellipsisBtn.focus()
    }
  })

  // Initial check after a brief delay to ensure layout is complete
  setTimeout(checkOverflow, 50)

  // Re-check on resize
  var resizeTimeout
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimeout)
    resizeTimeout = setTimeout(checkOverflow, 100)
  })
})()
