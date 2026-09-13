/**
 * Long code blocks on solution pages (body.solution, body.solution-step).
 *
 *  - A listing whose rendered <pre> is taller than about 16 line-heights is
 *    folded to about 14 lines with a bottom fade and a "Show all N lines"
 *    button (N is the source line count) that toggles to "Show less". The
 *    decision is made from pre.scrollHeight, not from source lines, so a
 *    block that wraps into many rendered lines folds too. Folding only clips
 *    the block (max-height + overflow on .content); it never removes or hides
 *    lines, so the copy button from 06-copy-to-clipboard.js (which reads
 *    code.innerText) still gets the full text, and so does find-in-page.
 *  - Blocks are measured on load, again on window load (fonts) and on window
 *    resize (debounced), because wrapping changes height: an undecided block
 *    can fold later and a folded block that now fits unfolds.
 *  - A block inside a <details> that is not open is left alone (it cannot be
 *    measured and is already collapsed once). When that details opens
 *    (toggle event) the block is measured and folded if it is long.
 *  - A listing title (.listingblock > .title, used for file paths such as
 *    services/leaderboard/main.go) becomes a file header bar on the block and
 *    the block's toolbox (copy / Ask AI) moves into it, aligned right.
 *  - Asciidoctor renders [%collapsible] example blocks as
 *    <details><summary class="title">...</summary><div class="content">, with
 *    no extra class. Every such details in the article gets the sol-details
 *    class for styling and, when it hides exactly one listing, a line-count
 *    badge in its summary.
 *  - prefers-reduced-motion: no smooth scrolling back to the block on
 *    collapse (the CSS also drops its transitions under the same query).
 *
 * Runs after 06-copy-to-clipboard.js (numbered order), which is what creates
 * the .source-toolbox this module relocates.
 */
;(function () {
  'use strict'

  var VISIBLE_LINES = 14
  // Fold only when at least a couple of lines would be hidden.
  var FOLD_AT_LINES = 16
  var DEFAULT_LINE_HEIGHT = 24
  var DEFAULT_PADDING = 16
  var RESIZE_DEBOUNCE_MS = 150

  var body = document.body
  if (!body || !body.classList) return
  var isSolutionPage = body.classList.contains('solution') || body.classList.contains('solution-step')
  if (!isSolutionPage) return

  var reduceMotion = false
  try {
    reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  } catch (e) { /* ignore */ }

  function toArray (list) {
    var out = []
    if (!list) return out
    for (var i = 0; i < list.length; i++) out.push(list[i])
    return out
  }

  function hasClass (el, name) {
    return !!(el && el.classList && el.classList.contains(name))
  }

  function childWithClass (el, name) {
    var children = (el && el.children) || []
    for (var i = 0; i < children.length; i++) if (hasClass(children[i], name)) return children[i]
    return null
  }

  function ancestor (el, predicate) {
    var node = el && el.parentNode
    while (node && node !== document) {
      if (predicate(node)) return node
      node = node.parentNode
    }
    return null
  }

  function isDetails (el) {
    return !!(el && el.tagName && String(el.tagName).toUpperCase() === 'DETAILS')
  }

  // Number of source lines in a code listing: the text split on newlines,
  // ignoring a single trailing newline that the converter adds.
  function countLines (text) {
    if (!text) return 0
    var trimmed = String(text).replace(/\n$/, '')
    if (!trimmed) return 0
    return trimmed.split('\n').length
  }

  function pxValue (value, fallback) {
    var n = parseFloat(value)
    return isFinite(n) && n > 0 ? n : fallback
  }

  function metrics (pre) {
    var lineHeight = DEFAULT_LINE_HEIGHT
    var padding = DEFAULT_PADDING * 2
    try {
      if (typeof window.getComputedStyle === 'function') {
        var cs = window.getComputedStyle(pre)
        lineHeight = pxValue(cs.lineHeight, DEFAULT_LINE_HEIGHT)
        padding = pxValue(cs.paddingTop, DEFAULT_PADDING) + pxValue(cs.paddingBottom, DEFAULT_PADDING)
      }
    } catch (e) { /* use defaults */ }
    return { lineHeight: lineHeight, padding: padding }
  }

  function foldedHeight (pre) {
    var m = metrics(pre)
    return Math.round(VISIBLE_LINES * m.lineHeight + m.padding)
  }

  // Rendered height of the code. 0 when the block is not rendered (display:
  // none, a closed details), which means "cannot decide yet".
  function renderedHeight (pre) {
    var h = pre.scrollHeight
    return typeof h === 'number' && isFinite(h) && h > 0 ? h : 0
  }

  function isTall (pre) {
    var h = renderedHeight(pre)
    if (!h) return null
    var m = metrics(pre)
    return h > FOLD_AT_LINES * m.lineHeight + m.padding
  }

  function insideClosedDetails (block) {
    return !!ancestor(block, function (node) { return isDetails(node) && !node.open })
  }

  function insideDoc (block) {
    return !!ancestor(block, function (node) { return hasClass(node, 'doc') })
  }

  function setLabel (button, folded, lines) {
    button.textContent = folded ? 'Show all ' + lines + ' lines' : 'Show less'
    button.setAttribute('aria-expanded', folded ? 'false' : 'true')
  }

  function fold (block, content, pre, lines) {
    block.classList.add('sol-code-fold', 'is-folded')
    content.style.maxHeight = foldedHeight(pre) + 'px'

    var button = document.createElement('button')
    button.type = 'button'
    button.className = 'sol-code-fold-btn'
    button.setAttribute('data-sol-code-fold', '')
    setLabel(button, true, lines)
    block.appendChild(button)

    button.addEventListener('click', function () {
      var folded = block.classList.contains('is-folded')
      if (folded) {
        block.classList.remove('is-folded')
        content.style.maxHeight = ''
        setLabel(button, false, lines)
      } else {
        block.classList.add('is-folded')
        content.style.maxHeight = foldedHeight(pre) + 'px'
        setLabel(button, true, lines)
        // Collapsing from the bottom of a long block leaves the reader far
        // below it; bring the block back into view.
        try {
          if (typeof block.getBoundingClientRect === 'function' && typeof block.scrollIntoView === 'function') {
            if (block.getBoundingClientRect().top < 0) {
              block.scrollIntoView(reduceMotion ? { block: 'start' } : { behavior: 'smooth', block: 'start' })
            }
          }
        } catch (e) { /* ignore */ }
      }
    })
    return button
  }

  // The block fits again (wider viewport, less wrapping): drop the fold.
  function unfold (block, content) {
    block.classList.remove('sol-code-fold', 'is-folded')
    content.style.maxHeight = ''
    var button = childWithClass(block, 'sol-code-fold-btn')
    if (button && button.parentNode) button.parentNode.removeChild(button)
  }

  function decorateTitle (block, title, content) {
    block.classList.add('sol-code-titled')
    title.classList.add('sol-code-title')
    var toolbox = childWithClass(content, 'source-toolbox')
    if (toolbox) title.appendChild(toolbox)
  }

  // Header treatment once; fold decision whenever the block can be measured.
  // Returns null for non-listings, else {block, lines, folded, deferred}.
  function processBlock (block) {
    if (!insideDoc(block)) return null
    var content = childWithClass(block, 'content')
    if (!content) return null
    var pre = content.querySelector('pre')
    if (!pre) return null
    var code = pre.querySelector('code') || pre
    var lines = countLines(code.textContent)
    var title = childWithClass(block, 'title')
    if (title && !hasClass(block, 'sol-code-titled')) decorateTitle(block, title, content)

    var result = { block: block, lines: lines, folded: hasClass(block, 'sol-code-fold'), deferred: false }
    if (insideClosedDetails(block)) {
      result.deferred = true
      return result
    }
    var tall = isTall(pre)
    if (tall === null) {
      result.deferred = true
      return result
    }
    if (tall && !result.folded) {
      fold(block, content, pre, lines)
      result.folded = true
    } else if (!tall && result.folded) {
      unfold(block, content)
      result.folded = false
    } else if (result.folded && hasClass(block, 'is-folded')) {
      // Line height may have changed with the viewport; keep the clip honest.
      content.style.maxHeight = foldedHeight(pre) + 'px'
    }
    return result
  }

  // <details> (Asciidoctor [%collapsible]): style hook, line-count badge when
  // it hides exactly one listing, and fold its listings once it opens.
  function decorateDetails (details) {
    if (!insideDoc(details) || hasClass(details, 'sol-details')) return
    var summary = details.querySelector('summary')
    if (!summary) return
    var listings = toArray(details.querySelectorAll('pre'))
    details.classList.add('sol-details')
    details.addEventListener('toggle', function () {
      if (!details.open) return
      toArray(details.querySelectorAll('.listingblock')).forEach(processBlock)
    })
    if (listings.length !== 1) return
    var code = listings[0].querySelector('code') || listings[0]
    var lines = countLines(code.textContent)
    if (!lines) return
    var badge = document.createElement('span')
    badge.className = 'sol-details-lines'
    badge.setAttribute('data-sol-details-lines', '')
    badge.textContent = lines + (lines === 1 ? ' line' : ' lines')
    summary.appendChild(badge)
  }

  function measureAll (root) {
    var scope = root || document
    return toArray(scope.querySelectorAll('.listingblock')).map(processBlock).filter(function (r) { return r })
  }

  function run (root) {
    var scope = root || document
    var results = measureAll(scope)
    toArray(scope.querySelectorAll('details')).forEach(decorateDetails)
    return results
  }

  var resizeTimer = null
  function onResize () {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(function () {
      resizeTimer = null
      measureAll(document)
    }, RESIZE_DEBOUNCE_MS)
  }

  window.docsSolutionsCodeFold = {
    countLines: countLines,
    run: run,
    measure: measureAll,
    VISIBLE_LINES: VISIBLE_LINES,
    FOLD_AT_LINES: FOLD_AT_LINES,
  }

  run(document)
  window.addEventListener('resize', onResize)
  // Web fonts and late stylesheets change line metrics.
  window.addEventListener('load', function () { measureAll(document) })
})()
