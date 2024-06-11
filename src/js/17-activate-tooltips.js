/* global tippy */
(function () {
  'use strict'

  document.addEventListener('DOMContentLoaded', function () {
    tippy && tippy('[data-tippy-content]', {
      animation: 'scale',
      theme: 'redpanda-term',
      touch: 'hold',
      interactive: true,
      allowHTML: true,
    })
  })
})()
