/**
 * Move connector metadata (Type dropdown, availability info) to sticky bar
 */
;(function () {
  'use strict'

  function moveConnectorMetadataToSticky () {
    const stickyBar = document.querySelector('.component-indicator-sticky')
    const metadataBlock = document.querySelector('.metadata-block')
    const metadataContent = metadataBlock?.querySelector('.metadata-content')

    if (!stickyBar || !metadataBlock || !metadataContent) return

    // Check if we already moved it
    if (stickyBar.querySelector('.metadata-inline')) return

    // Create metadata-inline container
    const metadataInline = document.createElement('div')
    metadataInline.className = 'metadata-inline'

    // Move the Type dropdown if it exists
    const typeDropdownWrapper = metadataContent.querySelector('.dropdown-wrapper')
    if (typeDropdownWrapper) {
      // Create context-switcher wrapper
      const contextSwitcher = document.createElement('div')
      contextSwitcher.className = 'context-switcher'

      const contextDropdown = document.createElement('div')
      contextDropdown.className = 'context-dropdown'

      // Get the original toggle and menu
      const originalToggle = typeDropdownWrapper.querySelector('.dropdown-toggle')
      const originalMenu = typeDropdownWrapper.querySelector('.dropdown-menu')

      if (originalToggle && originalMenu) {
        // Create compact toggle with "Type:" prefix (CSS adds this via ::before)
        const compactToggle = document.createElement('button')
        compactToggle.type = 'button'
        compactToggle.className = 'context-dropdown-toggle'
        compactToggle.setAttribute('aria-expanded', 'false')
        compactToggle.setAttribute('aria-haspopup', 'true')

        const dropdownText = originalToggle.querySelector('.dropdown-text')
        if (dropdownText) {
          compactToggle.textContent = dropdownText.textContent
        }

        // Add arrow
        const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        arrow.setAttribute('class', 'context-dropdown-arrow')
        arrow.setAttribute('viewBox', '0 0 24 24')
        arrow.setAttribute('width', '16')
        arrow.setAttribute('height', '16')
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        path.setAttribute('fill', 'currentColor')
        path.setAttribute('d', 'M7 10l5 5 5-5z')
        arrow.appendChild(path)
        compactToggle.appendChild(arrow)

        // Create compact menu
        const compactMenu = document.createElement('div')
        compactMenu.className = 'context-dropdown-menu'
        compactMenu.setAttribute('role', 'menu')

        // Copy menu items
        const originalItems = originalMenu.querySelectorAll('.dropdown-option')
        originalItems.forEach((item) => {
          const compactItem = document.createElement('a')
          compactItem.href = item.href
          compactItem.className = 'context-dropdown-item'
          compactItem.setAttribute('role', 'menuitem')
          compactItem.textContent = item.textContent

          // Mark current page as active
          if (window.location.pathname.includes(new URL(item.href).pathname)) {
            compactItem.classList.add('active')
          }

          compactMenu.appendChild(compactItem)
        })

        // Set up toggle functionality
        compactToggle.addEventListener('click', function (e) {
          e.preventDefault()
          e.stopPropagation()

          const isOpen = compactToggle.getAttribute('aria-expanded') === 'true'

          if (isOpen) {
            compactToggle.setAttribute('aria-expanded', 'false')
            compactMenu.classList.remove('show')
          } else {
            compactToggle.setAttribute('aria-expanded', 'true')
            compactMenu.classList.add('show')
          }
        })

        // Close on outside click
        document.addEventListener('click', function (e) {
          if (!contextDropdown.contains(e.target)) {
            compactToggle.setAttribute('aria-expanded', 'false')
            compactMenu.classList.remove('show')
          }
        })

        // Close on Escape
        document.addEventListener('keydown', function (e) {
          if (e.key === 'Escape' && compactToggle.getAttribute('aria-expanded') === 'true') {
            compactToggle.setAttribute('aria-expanded', 'false')
            compactMenu.classList.remove('show')
            compactToggle.focus()
          }
        })

        contextDropdown.appendChild(compactToggle)
        contextDropdown.appendChild(compactMenu)
        contextSwitcher.appendChild(contextDropdown)
        metadataInline.appendChild(contextSwitcher)
      }
    }

    // Create availability dropdown (check "Available in:" text)
    const availabilityPara = Array.from(metadataContent.querySelectorAll('p')).find((p) =>
      p.textContent.includes('Available in:')
    )

    if (availabilityPara) {
      const links = availabilityPara.querySelectorAll('a')
      const currentVersionSpan = availabilityPara.querySelector('.current-version')

      if (currentVersionSpan) {
        const currentText = currentVersionSpan.textContent.trim()

        // Extract version from URL (e.g., /connect/... or /streaming/26.1/...)
        const versionMatch = window.location.pathname.match(/\/(streaming|connect)\/(\d+\.\d+)/)
        const currentVersion = versionMatch ? versionMatch[2] : null

        // Create availability dropdown container
        const availabilityDropdown = document.createElement('div')
        availabilityDropdown.className = 'availability-selector'

        // Create dropdown button
        const dropdownButton = document.createElement('button')
        dropdownButton.className = 'availability-selector-toggle'
        dropdownButton.setAttribute('aria-expanded', 'false')
        dropdownButton.setAttribute('aria-haspopup', 'true')

        // Button text based on context - Cloud doesn't show version
        if (currentText === 'Cloud') {
          dropdownButton.innerHTML = `
            <span class="availability-label">Availability:</span>
            <span class="availability-value">Cloud</span>
            <svg class="availability-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          `
        } else {
          // Self-Managed shows version
          dropdownButton.innerHTML = `
            <span class="availability-label">Availability:</span>
            <span class="availability-value">Self-Managed${currentVersion ? ' v' + currentVersion : ''}</span>
            <svg class="availability-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          `
        }

        // Create dropdown menu
        const dropdownMenu = document.createElement('div')
        dropdownMenu.className = 'availability-selector-menu'
        dropdownMenu.setAttribute('role', 'menu')

        // Add menu items based on availability
        let hasAlternatives = false
        links.forEach((link) => {
          const linkText = link.textContent.trim()

          if (linkText === 'Cloud' && currentText !== 'Cloud') {
            // Viewing Self-Managed, link to Cloud (no version)
            const menuItem = document.createElement('a')
            menuItem.href = link.href
            menuItem.className = 'availability-selector-item'
            menuItem.setAttribute('role', 'menuitem')
            menuItem.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>
              </svg>
              <span>Also in Cloud</span>
            `
            dropdownMenu.appendChild(menuItem)
            hasAlternatives = true
          } else if (linkText === 'Self-Managed' && currentText !== 'Self-Managed') {
            // Viewing Cloud, link to Self-Managed (with version)
            // Extract version from the link URL
            const linkVersionMatch = link.href.match(/\/(streaming|connect)\/(\d+\.\d+)/)
            const linkVersion = linkVersionMatch ? linkVersionMatch[2] : null

            const menuItem = document.createElement('a')
            menuItem.href = link.href
            menuItem.className = 'availability-selector-item'
            menuItem.setAttribute('role', 'menuitem')
            menuItem.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              <span>Also in Self-Managed${linkVersion ? ' v' + linkVersion : ''}</span>
            `
            dropdownMenu.appendChild(menuItem)
            hasAlternatives = true
          }
        })

        // If no alternatives, show "only available" message
        if (!hasAlternatives) {
          const menuItem = document.createElement('div')
          menuItem.className = 'availability-selector-item availability-selector-item--disabled'
          menuItem.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
            </svg>
            <span>Only available in ${currentText}</span>
          `
          dropdownMenu.appendChild(menuItem)
          dropdownButton.classList.add('availability-selector-toggle--disabled')
        }

        // Set up toggle functionality
        dropdownButton.addEventListener('click', function (e) {
          e.preventDefault()
          e.stopPropagation()

          if (dropdownButton.classList.contains('availability-selector-toggle--disabled')) {
            return
          }

          const isOpen = dropdownButton.getAttribute('aria-expanded') === 'true'

          if (isOpen) {
            dropdownButton.setAttribute('aria-expanded', 'false')
            dropdownMenu.classList.remove('show')
          } else {
            dropdownButton.setAttribute('aria-expanded', 'true')
            dropdownMenu.classList.add('show')
          }
        })

        // Close on outside click
        document.addEventListener('click', function (e) {
          if (!availabilityDropdown.contains(e.target)) {
            dropdownButton.setAttribute('aria-expanded', 'false')
            dropdownMenu.classList.remove('show')
          }
        })

        // Close on Escape
        document.addEventListener('keydown', function (e) {
          if (e.key === 'Escape' && dropdownButton.getAttribute('aria-expanded') === 'true') {
            dropdownButton.setAttribute('aria-expanded', 'false')
            dropdownMenu.classList.remove('show')
            dropdownButton.focus()
          }
        })

        availabilityDropdown.appendChild(dropdownButton)
        availabilityDropdown.appendChild(dropdownMenu)
        metadataInline.appendChild(availabilityDropdown)
      }
    }

    // Only add metadata-inline if it has content
    if (metadataInline.children.length > 0) {
      // Insert before the page options dropdown (markdown-dropdown)
      const pageOptions = stickyBar.querySelector('.markdown-dropdown')
      if (pageOptions) {
        stickyBar.insertBefore(metadataInline, pageOptions)
      } else {
        stickyBar.appendChild(metadataInline)
      }

      // Hide the original metadata block
      metadataBlock.style.display = 'none'
    }
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', moveConnectorMetadataToSticky)
  } else {
    moveConnectorMetadataToSticky()
  }
})()
