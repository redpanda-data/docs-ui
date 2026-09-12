/* global Prism */
/**
 * Code highlighting on demand.
 *
 * Prism highlights every code block on the page at DOMContentLoaded, and
 * 11-editable-placeholders.js then calls highlightAll() again once it has made
 * the placeholders editable, so a tutorial with 41 code blocks tokenised all of
 * them twice before the reader could interact: ~350 ms of main-thread work on a
 * slow machine and ~3,000 extra DOM nodes, most of it for blocks far below the
 * fold.
 *
 * Prism's own pass is turned off (Prism.manual) and this module owns it: blocks
 * in or near the viewport are highlighted right away, the rest when they scroll
 * within 400px of it. 11-editable-placeholders.js calls window.highlightCodeBlocks
 * once the placeholders are in place, so the ordering it relies on is kept.
 * Everything that hooks Prism's per-element lifecycle (line numbers, line
 * highlight, the Bloblang-in-YAML pass, tab re-highlighting) keeps working
 * because each block still goes through Prism.highlightElement.
 */
;(function () {
  'use strict'

  if (typeof Prism === 'undefined' || !Prism.highlightElement) return

  // Keep our own reference. The stock Kapa widget (widget.kapa.ai) assigns its
  // bundled syntax highlighter to window.Prism when it loads, an object with
  // no highlightElement, so anything that reaches for the global after that
  // point breaks. Everything in this module goes through `prism`.
  var prism = Prism

  // Prism re-checks this inside its own DOMContentLoaded callback, so setting
  // it here (site.js is deferred and runs before that event) is enough.
  prism.manual = true

  // Prism's default selector, so the same elements are highlighted as before.
  var SELECTOR = 'code[class*="language-"], [class*="language-"] code, code[class*="lang-"], [class*="lang-"] code'
  var NEAR = 400 // px beyond the viewport that still counts as "visible soon"

  function highlight (el) {
    if (el.dataset.highlighted) return
    el.dataset.highlighted = 'true'
    prism.highlightElement(el)
  }

  function isNear (el) {
    var rect = el.getBoundingClientRect()
    return rect.bottom >= -NEAR && rect.top <= window.innerHeight + NEAR
  }

  var observer = 'IntersectionObserver' in window
    ? new window.IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return
        observer.unobserve(entry.target)
        highlight(entry.target)
      })
    }, { rootMargin: NEAR + 'px 0px' })
    : null

  // Highlight the blocks under `root` (default: the whole document): visible
  // ones now, the rest as they approach. Safe to call more than once.
  function highlightCodeBlocks (root) {
    var blocks = (root || document).querySelectorAll(SELECTOR)
    for (var i = 0; i < blocks.length; i++) {
      var el = blocks[i]
      if (el.dataset.highlighted) continue
      if (!observer || isNear(el)) {
        highlight(el)
      } else {
        observer.observe(el)
      }
    }
  }
  window.highlightCodeBlocks = highlightCodeBlocks

  // Re-highlight one element on demand (tab switches re-run it on blocks that
  // were hidden when first tokenised). Same captured Prism, same plugins.
  window.highlightCodeElement = function (el, async) {
    el.dataset.highlighted = 'true'
    prism.highlightElement(el, async)
  }
  window.prismLineNumbersResize = function (el) {
    if (prism.plugins && prism.plugins.lineNumbers) prism.plugins.lineNumbers.resize(el)
  }

  // Safety net for the observer: Chrome delivers IntersectionObserver entries
  // as part of rendering, which a hidden tab does not do, and some readers
  // scroll a page they opened in the background before switching to it. A
  // debounced sweep on scroll, resize and visibility change catches up with
  // whatever is near the viewport by then. Cheap: it only measures blocks that
  // are still unhighlighted, and that set only shrinks.
  var sweepTimer = null
  function scheduleSweep () {
    if (sweepTimer) return
    sweepTimer = setTimeout(function () {
      sweepTimer = null
      var pending = document.querySelectorAll(SELECTOR)
      for (var i = 0; i < pending.length; i++) {
        if (!pending[i].dataset.highlighted && isNear(pending[i])) highlight(pending[i])
      }
    }, 150)
  }
  window.addEventListener('scroll', scheduleSweep, { passive: true })
  window.addEventListener('resize', scheduleSweep, { passive: true })
  document.addEventListener('visibilitychange', scheduleSweep)

  // Fragment links into a block below the fold (line-highlight anchors, "#L12"
  // style ids from 09-linkable-line-numbers.js) need that block tokenised before
  // the browser scrolls to it, otherwise the target is not there yet.
  function highlightHashTarget () {
    if (!window.location.hash) return
    var id = window.location.hash.slice(1)
    var target = document.getElementById(id) || document.getElementById(decodeURIComponent(id))
    if (!target) return
    var pre = target.closest('pre') || target
    var code = pre.querySelector && pre.querySelector(SELECTOR)
    if (code) highlight(code)
  }
  document.addEventListener('DOMContentLoaded', highlightHashTarget)
  window.addEventListener('hashchange', highlightHashTarget)
})()
