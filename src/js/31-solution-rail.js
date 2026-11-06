/**
 * Solution page rail: keep the sticky right column readable when it is taller
 * than the viewport, without making it a scroll container of its own.
 *
 * A sticky column with its own overflow only scrolls while the pointer is over
 * it, and a wheel or trackpad gesture that reaches its edge stays latched to
 * it instead of moving the page. Readers saw both: the files at the bottom of
 * the rail could not be reached by scrolling the article, and scrolling back
 * up stopped at the rail's top like a wall.
 *
 * Instead the rail moves with the page by exactly the amount it overflows,
 * then sticks: scrolling down shows its bottom, scrolling up shows its top
 * straight away. The offset is written to --sol-rail-shift (0 or negative),
 * which solutions.css adds to the rail's sticky top. A rail that fits gets 0
 * and behaves as before. Without this script the rail keeps its own scrollbar
 * (the :not(.is-tracked) rule in solutions.css), so nothing becomes
 * unreachable.
 */
;(function () {
  'use strict'

  var rail = document.querySelector('.sol-rail')
  if (!rail || typeof window.matchMedia !== 'function') return

  var MARGIN = 16 // px kept clear under the rail, matching the CSS gap
  var wide = window.matchMedia('(min-width: 1281px)')
  var shift = 0
  var lastY = window.pageYOffset || 0
  var queued = false

  // The smallest offset that still shows the rail's bottom edge. `base` is the
  // sticky top without any shift: the navbar, the announcement bar when it is
  // shown, and the 1rem gap, all resolved by the browser.
  function minShift (base) {
    var available = window.innerHeight - base - MARGIN
    return Math.min(0, available - rail.offsetHeight)
  }

  function apply (value) {
    if (value === shift) return
    shift = value
    rail.style.setProperty('--sol-rail-shift', shift + 'px')
  }

  function update () {
    queued = false
    var y = window.pageYOffset || 0
    var delta = y - lastY
    lastY = y
    if (!wide.matches) { apply(0); return }
    var base = (parseFloat(window.getComputedStyle(rail).top) || 0) - shift
    var floor = minShift(base)
    var next = shift - delta
    if (next < floor) next = floor
    if (next > 0) next = 0
    apply(Math.round(next))
  }

  function schedule () {
    if (queued) return
    queued = true
    window.requestAnimationFrame(update)
  }

  rail.classList.add('is-tracked')
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)
  // The rail changes height when a panel opens or closes (the files list,
  // the details that wraps the rail below 1281px) and when the announcement
  // bar is dismissed, which changes the sticky top.
  rail.addEventListener('toggle', schedule, true)
  if (typeof wide.addEventListener === 'function') wide.addEventListener('change', schedule)
  else if (typeof wide.addListener === 'function') wide.addListener(schedule)
  document.addEventListener('click', function () { window.setTimeout(schedule, 50) })
  schedule()
})()
