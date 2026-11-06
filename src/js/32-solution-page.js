/**
 * Solution pages: small reading aids on the rendered article.
 *
 * - A code block whose lines run past the column gets .has-overflow, and
 *   .is-scrolled-end once it is scrolled to its right edge, so solutions.css
 *   can fade the edge that hides more. macOS draws no scrollbar until you
 *   scroll, so a cut line otherwise reads as a broken command.
 * - A listing titled "Expected output" gets .sol-expected, so solutions.css
 *   can drop the language label and Ask AI from it.
 * - A localhost URL inside inline code is not a link. Asciidoctor links every
 *   URL, so `curl -s http://localhost:3000/api/status` rendered as a command
 *   with a clickable external link in the middle of it.
 */
;(function () {
  'use strict'

  var doc = document.querySelector('.sol-doc')
  if (!doc) return

  var EXPECTED = /^expected output$/i
  var LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)([:/]|$)/i

  Array.prototype.forEach.call(doc.querySelectorAll('.listingblock'), function (block) {
    var title = block.querySelector(':scope > .title')
    if (title && EXPECTED.test((title.firstChild && title.firstChild.nodeType === 3 ? title.firstChild.nodeValue : title.textContent).trim())) {
      block.classList.add('sol-expected')
    }
  })

  Array.prototype.forEach.call(doc.querySelectorAll('code a[href]'), function (a) {
    if (!LOCAL.test(a.getAttribute('href'))) return
    a.replaceWith(document.createTextNode(a.textContent))
  })

  // The scroller is the <code> inside <pre> (it is the box with overflow-x),
  // or the <pre> itself for a literal block without one.
  var scrollers = Array.prototype.map.call(doc.querySelectorAll('.listingblock > .content > pre'), function (pre) {
    return { block: pre.parentNode.parentNode, box: pre.querySelector(':scope > code') || pre }
  })
  function atEnd (box) { return box.scrollLeft + box.clientWidth >= box.scrollWidth - 1 }
  function mark (s) {
    var over = s.box.scrollWidth > s.box.clientWidth + 1
    s.block.classList.toggle('has-overflow', over)
    s.block.classList.toggle('is-scrolled-end', over && atEnd(s.box))
  }
  function measure () { scrollers.forEach(mark) }
  scrollers.forEach(function (s) {
    s.box.addEventListener('scroll', function () { mark(s) }, { passive: true })
  })
  measure()
  window.addEventListener('resize', measure)
  // Folded blocks (30-solution-code-fold.js) change width when they open.
  doc.addEventListener('toggle', measure, true)
  doc.addEventListener('click', function () { window.setTimeout(measure, 50) })
})()
