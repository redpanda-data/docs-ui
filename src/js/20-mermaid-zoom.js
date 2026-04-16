;(function () {
  'use strict'

  // Only initialize if there are Mermaid diagrams on the page
  const mermaidBlocks = document.querySelectorAll('.mermaid')
  if (!mermaidBlocks.length) return

  // Create modal overlay (reused for all diagrams)
  const modalOverlay = document.createElement('div')
  modalOverlay.className = 'mermaid-modal-overlay'
  modalOverlay.setAttribute('role', 'dialog')
  modalOverlay.setAttribute('aria-modal', 'true')
  modalOverlay.setAttribute('aria-label', 'Mermaid diagram zoom view')
  modalOverlay.innerHTML = `
    <button class="mermaid-modal-close" aria-label="Close diagram">&times;</button>
    <div class="mermaid-modal-container"></div>
    <div class="mermaid-modal-hint">Drag or scroll to pan around the diagram</div>
  `
  document.body.appendChild(modalOverlay)

  const modalContainer = modalOverlay.querySelector('.mermaid-modal-container')
  const modalClose = modalOverlay.querySelector('.mermaid-modal-close')
  const modalHint = modalOverlay.querySelector('.mermaid-modal-hint')

  // Drag-to-scroll variables
  var isDragging = false
  var startX, startY, scrollLeft, scrollTop

  // Focus management for accessibility
  var lastFocusedElement = null

  function openModal (svg) {
    // Save the currently focused element to restore later
    lastFocusedElement = document.activeElement
    const clone = svg.cloneNode(true)

    // Get the original SVG dimensions
    var rect = svg.getBoundingClientRect()
    var origWidth = rect.width || 400
    var origHeight = rect.height || 300
    var aspectRatio = origWidth / origHeight

    // Calculate target dimensions to fill viewport
    var maxWidth = window.innerWidth * 0.92
    var maxHeight = window.innerHeight * 0.85

    var targetWidth, targetHeight

    // For wide diagrams (aspect ratio > 2), prioritize filling width
    // and allow scrolling if needed
    if (aspectRatio > 2) {
      targetWidth = maxWidth
      targetHeight = targetWidth / aspectRatio
      // If still too short to read, make it taller
      if (targetHeight < maxHeight * 0.5) {
        targetHeight = maxHeight * 0.7
        targetWidth = targetHeight * aspectRatio
      }
    } else {
      // For normal diagrams, fit within viewport
      if (aspectRatio > maxWidth / maxHeight) {
        targetWidth = maxWidth
        targetHeight = targetWidth / aspectRatio
      } else {
        targetHeight = maxHeight
        targetWidth = targetHeight * aspectRatio
      }
    }

    // Ensure minimum size for readability (at least 2x original or fill viewport)
    var minScale = 2
    if (targetWidth < origWidth * minScale && targetHeight < origHeight * minScale) {
      targetWidth = Math.min(origWidth * minScale, maxWidth * 1.5)
      targetHeight = targetWidth / aspectRatio
    }

    // Apply dimensions directly to SVG (not transform)
    clone.style.width = targetWidth + 'px'
    clone.style.height = targetHeight + 'px'
    clone.style.minWidth = targetWidth + 'px'
    clone.style.minHeight = targetHeight + 'px'
    clone.style.maxWidth = 'none'
    clone.style.maxHeight = 'none'
    clone.removeAttribute('width')
    clone.removeAttribute('height')

    modalContainer.innerHTML = ''
    modalContainer.appendChild(clone)
    modalOverlay.classList.add('active')
    document.body.style.overflow = 'hidden'

    // Check if scrolling is needed and show hint
    setTimeout(function () {
      var needsScroll = modalContainer.scrollWidth > modalContainer.clientWidth ||
                        modalContainer.scrollHeight > modalContainer.clientHeight
      if (needsScroll) {
        modalHint.classList.remove('hidden')
        // Auto-hide hint after 3 seconds
        setTimeout(function () {
          modalHint.classList.add('hidden')
        }, 3000)
      } else {
        modalHint.classList.add('hidden')
      }
    }, 100)

    modalClose.focus()
  }

  function closeModal () {
    modalOverlay.classList.remove('active')
    document.body.style.overflow = ''
    modalHint.classList.add('hidden')

    // Restore focus to the element that opened the modal
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus()
      lastFocusedElement = null
    }
  }

  // Drag-to-scroll functionality
  modalContainer.addEventListener('mousedown', function (e) {
    // Don't start drag if clicking close button
    if (e.target === modalClose) return
    isDragging = true
    modalContainer.style.cursor = 'grabbing'
    startX = e.pageX - modalContainer.offsetLeft
    startY = e.pageY - modalContainer.offsetTop
    scrollLeft = modalContainer.scrollLeft
    scrollTop = modalContainer.scrollTop
    e.preventDefault()
  })

  modalContainer.addEventListener('mouseleave', function () {
    isDragging = false
    modalContainer.style.cursor = 'grab'
  })

  modalContainer.addEventListener('mouseup', function () {
    isDragging = false
    modalContainer.style.cursor = 'grab'
  })

  modalContainer.addEventListener('mousemove', function (e) {
    if (!isDragging) return
    e.preventDefault()
    var x = e.pageX - modalContainer.offsetLeft
    var y = e.pageY - modalContainer.offsetTop
    var walkX = (x - startX) * 1.5
    var walkY = (y - startY) * 1.5
    modalContainer.scrollLeft = scrollLeft - walkX
    modalContainer.scrollTop = scrollTop - walkY
  })

  // Attach click handlers to all Mermaid diagrams
  mermaidBlocks.forEach(function (block) {
    block.style.cursor = 'zoom-in'
    block.setAttribute('role', 'button')
    block.setAttribute('tabindex', '0')
    block.setAttribute('aria-label', 'Click to zoom diagram')

    block.addEventListener('click', function (e) {
      // Don't zoom if clicking on a link inside the diagram
      if (e.target.closest('a')) return

      const svg = block.querySelector('svg')
      if (svg) openModal(svg)
    })

    // Keyboard support
    block.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        const svg = block.querySelector('svg')
        if (svg) openModal(svg)
      }
    })
  })

  // Close button click
  modalClose.addEventListener('click', closeModal)

  // Click outside to close (but not when dragging)
  modalOverlay.addEventListener('click', function (e) {
    if (e.target === modalOverlay && !isDragging) {
      closeModal()
    }
  })

  // Escape key to close
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modalOverlay.classList.contains('active')) {
      closeModal()
    }
  })
})()
