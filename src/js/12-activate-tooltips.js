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
  })
})()
