/* global tippy */
;(function () {
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
      delay: [200, 0], // Instant show/hide for faster tooltips
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

    // Initialize tippy for enterprise feature terms (enterprise inline macro)
    document.querySelectorAll('[data-enterprise-tooltip]').forEach((el) => {
      tippy(el, {
        ...tooltipConfig,
        content: el.getAttribute('data-enterprise-tooltip'),
      })
    })

    // The enterprise macro's default is a plain title attribute, which the
    // browser renders as an unstyled native tooltip -- visibly different from
    // the styled popovers every other term on the page gets, including
    // property references. Promote it to tippy and drop the attribute, so the
    // default rendering matches without every playbook having to set
    // enterprise-tooltip=true. The attribute is still the no-JS fallback.
    document.querySelectorAll('.enterprise-feature[title]').forEach((el) => {
      const titleContent = el.getAttribute('title')
      if (!titleContent) return
      el.removeAttribute('title')
      // allowHTML: false, overriding the shared config. The browser renders a
      // title attribute as plain text, so promoting one to a tippy that parses
      // HTML would turn inert content into markup -- a feature name or registry
      // tooltip containing <img src=x onerror=...> becomes executable purely by
      // being moved. Nothing in a licence tooltip needs markup.
      tippy(el, { ...tooltipConfig, allowHTML: false, content: titleContent })
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
        })
      }
    })
  })
})()
