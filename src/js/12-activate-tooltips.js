/* global tippy */
(function () {
  'use strict'

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof tippy !== 'function') return

    // Shared tooltip configuration
    const tooltipConfig = {
      animation: 'scale',
      theme: 'redpanda-term',
      touch: 'hold',
      interactive: true,
      allowHTML: true,
      delay: [0, 0], // Instant show/hide for faster tooltips
    }

    // Initialize tippy for elements with built-in data-tippy-content
    tippy('[data-tippy-content]:not([data-tooltip])', tooltipConfig)

    // Initialize tippy for custom data-tooltip elements
    document.querySelectorAll('[data-tooltip]').forEach((el) => {
      tippy(el, {
        ...tooltipConfig,
        content: el.getAttribute('data-tooltip'),
      })
    })

    // Convert title attributes to tippy tooltips for code block buttons
    document.querySelectorAll('.source-toolbox [title]').forEach((el) => {
      const titleContent = el.getAttribute('title')
      if (titleContent) {
        // Remove the title attribute to prevent native tooltip
        el.removeAttribute('title')
        // Initialize tippy with the title content
        tippy(el, {
          ...tooltipConfig,
          content: titleContent,
          // Append to body to prevent overflow/clipping issues
          appendTo: () => document.body,
          // Configure popper to handle boundary detection
          popperOptions: {
            modifiers: [
              {
                name: 'preventOverflow',
                options: {
                  boundary: 'viewport',
                },
              },
              {
                name: 'flip',
                options: {
                  fallbackPlacements: ['bottom', 'top', 'left', 'right'],
                },
              },
            ],
          },
        })
      }
    })
  })
})()
