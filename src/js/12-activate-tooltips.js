/* global tippy */
(function () {
  'use strict'

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof tippy !== 'function') return

    // Initialize tippy for elements with built-in data-tippy-content
    tippy('[data-tippy-content]', {
      animation: 'scale',
      theme: 'redpanda-term',
      touch: 'hold',
      interactive: true,
      allowHTML: true,
    })

    // Initialize tippy for custom data-tooltip elements
    document.querySelectorAll('[data-tooltip]').forEach((el) => {
      tippy(el, {
        content: el.getAttribute('data-tooltip'),
        animation: 'scale',
        theme: 'redpanda-term',
        touch: 'hold',
        interactive: true,
        allowHTML: true,
      })
    })
  })
})()
