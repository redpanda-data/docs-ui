/* global tippy */
;(function () {
  'use strict'

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof tippy !== 'function') return

    // Touch devices have no hover, so a term's tooltip used to need a long
    // press, and a plain tap on a glossary term (an <a> to the glossary page)
    // navigated away before the reader saw the definition. On touch the first
    // tap now shows the tooltip and goes nowhere; the destination is offered
    // as a link inside the tooltip instead. Same detection as
    // 19-property-tooltips.js.
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0

    // Shared tooltip configuration
    const tooltipConfig = {
      animation: 'scale',
      theme: 'redpanda-term',
      touch: isTouch ? true : 'hold',
      trigger: isTouch ? 'click' : 'mouseenter focus',
      hideOnClick: isTouch ? 'toggle' : true,
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

    // The anchor a tooltipped element navigates to, if any: the element itself
    // (glossary terms are <a data-tippy-content>) or a child (enterprise terms
    // wrap a licensing link).
    function linkedAnchor (el) {
      if (el.tagName === 'A' && el.getAttribute('href')) return el
      return el.querySelector('a[href]')
    }

    // Tooltip content as a DOM node: the text or HTML the element carries,
    // plus a footer link to wherever the term would have taken the reader.
    // Glossary terms get it on every device: seeing the definition and then
    // choosing to read the full glossary entry is a better path than the
    // link alone, and on touch it is the only way to get there.
    function buildContent (el, raw, allowHTML) {
      const anchor = linkedAnchor(el)
      const box = document.createElement('div')
      if (allowHTML) box.innerHTML = raw
      else box.textContent = raw
      if (!anchor) return box
      const link = document.createElement('a')
      link.className = 'tippy-footer-link'
      link.href = anchor.getAttribute('href')
      if (anchor.getAttribute('target')) link.target = anchor.getAttribute('target')
      if (anchor.getAttribute('rel')) link.rel = anchor.getAttribute('rel')
      link.textContent = el.classList.contains('glossary-term') ? 'View in glossary' : 'Learn more'
      box.appendChild(link)
      return box
    }

    // On touch, a tap on a tooltipped link opens the tooltip rather than
    // navigating. Only the first tap: while the tooltip is open the footer link
    // is the way through, and a second tap on the term closes it (hideOnClick).
    function interceptTap (el) {
      if (!isTouch) return
      const anchor = linkedAnchor(el)
      if (!anchor) return
      el.setAttribute('aria-haspopup', 'dialog')
      el.addEventListener('click', function (e) {
        if (e.target.closest('.tippy-box')) return
        e.preventDefault()
      })
    }

    // Initialize tippy for elements with built-in data-tippy-content
    // ignoreAttributes: tippy otherwise reads data-tippy-content itself and
    // lets it override the content passed here, which would drop the footer
    // link. No template uses any other data-tippy-* attribute.
    document.querySelectorAll('[data-tippy-content]:not([data-tooltip])').forEach((el) => {
      const raw = el.getAttribute('data-tippy-content')
      if (!raw) return
      interceptTap(el)
      tippy(el, { ...tooltipConfig, ignoreAttributes: true, content: buildContent(el, raw, true) })
    })

    // Initialize tippy for custom data-tooltip elements
    // allowHTML: false on the data-tooltip paths too. These carry the same
    // registry-authored strings as the promoted title above -- badge tooltips and
    // enterprise tooltips both land here -- and the DOM decodes the escaping the
    // macro applied, so with allowHTML: true tippy re-parsed the result as
    // markup. Tooltip text needs no markup on any of these paths.
    document.querySelectorAll('[data-tooltip]').forEach((el) => {
      interceptTap(el)
      tippy(el, {
        ...tooltipConfig,
        allowHTML: false,
        content: buildContent(el, el.getAttribute('data-tooltip'), false),
      })
    })

    // Initialize tippy for enterprise feature terms (enterprise inline macro)
    document.querySelectorAll('[data-enterprise-tooltip]').forEach((el) => {
      interceptTap(el)
      tippy(el, {
        ...tooltipConfig,
        allowHTML: false,
        content: buildContent(el, el.getAttribute('data-enterprise-tooltip'), false),
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
      interceptTap(el)
      tippy(el, { ...tooltipConfig, allowHTML: false, content: buildContent(el, titleContent, false) })
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
