/**
 * Home Card Click Handling
 * Makes intent cards on the home page clickable while preserving nested links
 */

;(function () {
  'use strict'

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }

  function init () {
    const clickableCards = document.querySelectorAll('.home-intent-card--clickable[data-href]')

    clickableCards.forEach((card) => {
      const href = card.getAttribute('data-href')
      if (!href || href === '#') return

      // Make the card look clickable
      card.style.cursor = 'pointer'

      // Handle click on the card
      card.addEventListener('click', (e) => {
        // Check if the click was on a link or inside a link
        const target = e.target
        const clickedLink = target.closest('a')

        // If user clicked on a nested link, let it handle the navigation
        if (clickedLink && clickedLink !== card) {
          return
        }

        // Otherwise, navigate to the card's href
        window.location.href = href
      })
    })
  }
})()
