/* global tippy */
;(function () {
  'use strict'

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof tippy !== 'function') return

    // Touch readers have no hover, so a term's tooltip used to need a long
    // press, and a plain tap on a glossary term (an <a> to the glossary page)
    // navigated away before the reader saw the definition. Fixing that needs
    // two different signals, one per question.
    //
    // Can the tooltip open without a long press? That is a tippy prop, fixed
    // when the instance is created: touch: true replaces tippy's 'hold'
    // behaviour, and a tap fires an emulated mouseenter, which is enough to
    // trigger a hover tooltip. A mouse user loses nothing by it.
    //
    // Should a tap swallow the term's own navigation? Decided at click time
    // from tippy.currentInput.isTouch, never from a capability sniff.
    // 'ontouchstart' in window is true on touch-capable laptops (Surface,
    // most Windows laptops, Chromebooks, an iPad with a trackpad), so
    // swallowing clicks there would break the link for every reader on one of
    // those machines who is using a mouse. tippy sets currentInput.isTouch on
    // touchstart and clears it again after two mousemoves within 20 ms, so it
    // reports the input in use rather than the input available.
    //
    // The capability sniff survives for one thing: the aria-haspopup hint,
    // which has to be on the element before anyone activates it.
    const canTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0

    // Shared tooltip configuration
    const tooltipConfig = {
      animation: 'scale',
      theme: 'redpanda-term',
      // See the note above: touch: true on every device, so a tap opens the
      // tooltip through the emulated mouseenter instead of needing a hold.
      touch: true,
      trigger: 'mouseenter focus',
      // Always true, never 'toggle'. tippy compares this with === true before
      // hiding on a press outside the tooltip, so 'toggle' left a reader on a
      // touch device with no way to dismiss a tooltip at all: not by tapping
      // the page, and not by tapping the term again (the tap re-triggers it).
      // Verified in a browser with real touch events, before and after. true
      // keeps the opening tap from dismissing what it just opened, because
      // tippy ignores a press on the reference itself while the input is
      // touch, and interactive keeps a tap on the tooltip's own footer link
      // from closing it before it can be followed.
      hideOnClick: true,
      interactive: true,
      allowHTML: true,
      delay: [200, 0], // Instant show/hide for faster tooltips
      // aria-describedby links the element to its tooltip while it is shown,
      // including the interactive ones, where tippy's 'auto' would leave it
      // off. The element's own text carries the meaning; the tooltip adds
      // detail, so a description (not a label) is the right relationship.
      // expanded: false because these tooltips open nothing a reader
      // operates: tippy's 'auto' put aria-expanded on every interactive
      // reference, which is not allowed on a generic <span> (axe flags it as
      // critical) and made screen readers call every badge and copy button
      // "expandable".
      aria: { content: 'describedby', expanded: false },
      // Append to body to prevent overflow/clipping issues
      appendTo: () => document.body,
      // Only one tooltip open at a time, across every tooltip on the page.
      // tippy does not do this on its own, and on touch it is not cosmetic:
      // a touch reader never hovers out, so each term they tap opens another
      // popover and the previous one stays on screen. hideAll reaches every
      // mounted instance, so property and Bloblang tooltips close too, not
      // just the ones created here.
      onShow (instance) {
        tippy.hideAll({ exclude: instance })
      },
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

    // Keyboard readers reach a tooltip through focus, so an element that
    // cannot take focus (a badge is a plain <span>) gets tabindex="0". One
    // that wraps a link, or sits inside a link or button (a badge after a nav
    // title), is left alone: a nested tab stop would only repeat the link's,
    // and the link gets a focus tooltip of its own instead (describeControl).
    const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]'
    // A long listing that repeats the same badges on every row (the property
    // catalog has about 900) opts out with data-tooltip-nofocus on a container:
    // a tab stop per badge would bury the controls that do something. The
    // listing carries the detail as text for assistive technology instead,
    // and the tooltip still opens on hover and tap.
    function makeFocusable (el) {
      if (el.closest && el.closest('[data-tooltip-nofocus]')) return
      if (el.matches(FOCUSABLE) || linkedAnchor(el)) return
      if (parentControl(el)) return
      el.setAttribute('tabindex', '0')
    }

    // The link or button an element sits inside, if any.
    function parentControl (el) {
      return el.parentElement ? el.parentElement.closest('a[href], button') : null
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

    // A tap on a tooltipped link opens the tooltip rather than navigating, but
    // only while touch is the input in use: the same reader on a touch-capable
    // laptop can pick up the mouse, and then a click has to follow the link
    // the way it always has. While the tooltip is open the footer link is the
    // way through, and tapping anywhere off the tooltip dismisses it
    // (hideOnClick). Tapping the term a second time does NOT close it: the tap
    // re-triggers the tooltip, which is why dismissal hangs on the outside
    // press rather than on a toggle.
    function interceptTap (el) {
      const anchor = linkedAnchor(el)
      if (!anchor) return
      if (canTouch) el.setAttribute('aria-haspopup', 'dialog')
      el.addEventListener('click', function (e) {
        // currentInput is tippy 6 public API. If a future bundle drops it,
        // let the click through rather than trapping the reader on the page.
        if (!(tippy.currentInput && tippy.currentInput.isTouch)) return
        e.preventDefault()
      })
    }

    // Escape dismisses an open tooltip without moving focus (WCAG 1.4.13).
    // tippy has no Escape handling of its own.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') tippy.hideAll({ duration: 0 })
    })

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

    // Initialize tippy for custom data-tooltip elements. This is the one path
    // for meaning badges and notices (.rp-badge, .rp-notice): macros and
    // templates emit data-tooltip, never title or their own tippy() call.
    // allowHTML: false on the data-tooltip paths too. These carry the same
    // registry-authored strings as the promoted title above -- badge tooltips and
    // enterprise tooltips both land here -- and the DOM decodes the escaping the
    // macro applied, so with allowHTML: true tippy re-parsed the result as
    // markup. Tooltip text needs no markup on any of these paths.
    function activateTooltips (root) {
      const controls = new Map()
      root.querySelectorAll('[data-tooltip]').forEach((el) => {
        if (!el.getAttribute('data-tooltip') || el._tippy) return
        makeFocusable(el)
        interceptTap(el)
        tippy(el, {
          ...tooltipConfig,
          allowHTML: false,
          content: buildContent(el, el.getAttribute('data-tooltip'), false),
        })
        if (el.closest && el.closest('[data-tooltip-nofocus]')) return
        const control = parentControl(el)
        if (control) controls.set(control, (controls.get(control) || []).concat(el))
      })
      controls.forEach(describeControl)
    }

    // A badge inside a link or button has no tab stop, and focus on the
    // control never reaches the badge's own tooltip: tippy listens for focus,
    // which does not bubble. So the control gets one tooltip of its own. It
    // opens on keyboard focus only, sits at the first badge, and carries the
    // text of every badge in the control, and tippy puts aria-describedby on
    // the control while it is open. Hover stays with each badge, so pointing
    // at the rest of a card or nav link opens nothing.
    function describeControl (badges, control) {
      if (control._tippy) return
      const box = document.createElement('div')
      badges.forEach((badge) => box.appendChild(buildContent(badge, badge.getAttribute('data-tooltip'), false)))
      tippy(control, {
        ...tooltipConfig,
        trigger: 'focus',
        allowHTML: false,
        content: box,
        getReferenceClientRect: () => badges[0].getBoundingClientRect(),
        onShow (instance) {
          // A click focuses the control too. Only keyboard focus opens this.
          if (!control.matches(':focus-visible')) return false
          tippy.hideAll({ exclude: instance })
        },
      })
    }
    activateTooltips(document)

    // Collapsed nav branches and buckets keep their items in an inert
    // <template> until first expand (01-nav.js, 23-nav-bucket.js), so their
    // badges are not in the document for the pass above. Both announce the
    // new subtree with nav:hydrated.
    document.addEventListener('nav:hydrated', function (e) {
      activateTooltips(e.target)
    })

    // Initialize tippy for enterprise feature terms (enterprise inline macro)
    document.querySelectorAll('[data-enterprise-tooltip]').forEach((el) => {
      makeFocusable(el)
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
      makeFocusable(el)
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
