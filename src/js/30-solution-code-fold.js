/**
 * Long code blocks on solution pages (body.solution, body.solution-step).
 *
 *  - A listing whose <pre> has more than 30 lines is folded to about 14 lines
 *    with a bottom fade and a "Show all N lines" button that toggles to
 *    "Show less". Folding only clips the block (max-height + overflow), it
 *    never removes or hides lines, so the copy button from
 *    06-copy-to-clipboard.js (which reads code.innerText) still gets the full
 *    text, and so does find-in-page.
 *  - A block inside a <details> that is not open is left alone: it is already
 *    collapsed once. When that details opens (toggle event) the block is
 *    processed then, and folded if it is long.
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

  var FOLD_THRESHOLD = 30
  var VISIBLE_LINES = 14
  var DEFAULT_LINE_HEIGHT = 24
  var DEFAULT_PADDING = 16

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

  // Number of lines in a code listing: the text split on newlines, ignoring a
  // single trailing newline that the converter adds.
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

  function foldedHeight (pre) {
    var lineHeight = DEFAULT_LINE_HEIGHT
    var padding = DEFAULT_PADDING * 2
    try {
      if (typeof window.getComputedStyle === 'function') {
        var cs = window.getComputedStyle(pre)
        lineHeight = pxValue(cs.lineHeight, DEFAULT_LINE_HEIGHT)
        padding = pxValue(cs.paddingTop, DEFAULT_PADDING) + pxValue(cs.paddingBottom, DEFAULT_PADDING)
      }
    } catch (e) { /* use defaults */ }
    return Math.round(VISIBLE_LINES * lineHeight + padding)
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

  function decorateTitle (block, title, content) {
    block.classList.add('sol-code-titled')
    title.classList.add('sol-code-title')
    var toolbox = childWithClass(content, 'source-toolbox')
    if (toolbox) title.appendChild(toolbox)
  }

  // A block is processed at most once for its fold decision, except that a
  // long block inside a closed details is deferred (not decided) until the
  // details opens; the title header is applied on the first pass regardless.
  function processBlock (block) {
    if (!insideDoc(block) || hasClass(block, 'sol-code-fold') || hasClass(block, 'sol-code-checked')) return null
    var content = childWithClass(block, 'content')
    if (!content) return null
    var pre = content.querySelector('pre')
    if (!pre) return null
    var code = pre.querySelector('code') || pre
    var lines = countLines(code.textContent)
    var title = childWithClass(block, 'title')
    if (title && !hasClass(block, 'sol-code-titled')) decorateTitle(block, title, content)
    var result = { block: block, lines: lines, folded: false, deferred: false }
    if (lines <= FOLD_THRESHOLD) {
      block.classList.add('sol-code-checked')
      return result
    }
    if (insideClosedDetails(block)) {
      result.deferred = true
      return result
    }
    fold(block, content, pre, lines)
    block.classList.add('sol-code-checked')
    result.folded = true
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

  function run (root) {
    var scope = root || document
    var results = toArray(scope.querySelectorAll('.listingblock')).map(processBlock).filter(function (r) { return r })
    toArray(scope.querySelectorAll('details')).forEach(decorateDetails)
    return results
  }

  window.docsSolutionsCodeFold = {
    countLines: countLines,
    run: run,
    FOLD_THRESHOLD: FOLD_THRESHOLD,
    VISIBLE_LINES: VISIBLE_LINES,
  }

  run(document)
})()
