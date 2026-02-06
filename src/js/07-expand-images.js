(function () {
  'use strict'

  const modalOverlay = document.createElement('div')
  modalOverlay.id = 'modal-overlay'
  modalOverlay.className = 'modal-overlay'
  // Create the inner HTML (close button and container for media)
  modalOverlay.innerHTML = `
    <button id="modal-close" class="modal-close">&times;</button>
    <div class="modal-scroll-container"></div>
  `
  document.body.appendChild(modalOverlay)

  const blocks = document.querySelectorAll('.imageblock')
  const modalContainer = document.querySelector('.modal-scroll-container')
  const modalClose = document.getElementById('modal-close')

  if (!blocks.length || !modalOverlay) return

  blocks.forEach((block) => {
    block.addEventListener('click', function (e) {
      const media = block.querySelector('img, svg')
      if (!media) return

      const clone = media.cloneNode(true)
      modalContainer.innerHTML = ''
      modalContainer.appendChild(clone)
      modalOverlay.classList.add('active')
    })
    // Note: Using passive: false is intentional here to prevent scrolling while expanding
    block.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false })
  })

  modalClose.addEventListener('click', () => {
    modalOverlay.classList.remove('active')
  })

  modalOverlay.addEventListener('click', function (e) {
    if (e.target === modalOverlay) {
      modalOverlay.classList.remove('active')
    }
  })
})()
