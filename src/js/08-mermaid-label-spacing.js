;(function () {
  'use strict'

  // Mermaid (v10 and v11) never reserves vertical space between a subgraph
  // label and nested subgraphs: the label overlaps the inner boxes' top
  // borders, and neither flowchart.subGraphTitleMargin nor flowchart.padding
  // moves the children. Fix the rendered SVG instead: shift the label up and
  // grow the cluster rect (and the viewBox for top-level clusters) to match.

  const MIN_GAP = 12

  if (!document.querySelector('.mermaid')) return

  function fixSvg (svg) {
    // Hidden diagrams (e.g. in an inactive context-switcher tab) have no
    // layout: getBBox() throws in Firefox and returns zero-height boxes in
    // Chrome. Leave them unstamped so a later pass can fix them once revealed.
    if (svg.getClientRects().length === 0) return

    const clusters = Array.from(svg.querySelectorAll('g.cluster'))

    function contains (outer, inner) {
      const ox = parseFloat(outer.getAttribute('x'))
      const oy = parseFloat(outer.getAttribute('y'))
      const ow = parseFloat(outer.getAttribute('width'))
      const oh = parseFloat(outer.getAttribute('height'))
      const ix = parseFloat(inner.getAttribute('x'))
      const iy = parseFloat(inner.getAttribute('y'))
      const iw = parseFloat(inner.getAttribute('width'))
      const ih = parseFloat(inner.getAttribute('height'))
      return ix >= ox - 1 && ix + iw <= ox + ow + 1 && iy > oy && iy + ih <= oy + oh + 1
    }

    // Clusters are processed in document order and measured live, so a
    // cluster shifted early feeds its new position to clusters measured
    // later. The one-directional (upward) shifts keep that stable enough
    // in practice; don't rely on exact pixel positions across siblings.
    let viewBoxGrow = 0
    clusters.forEach(function (cluster) {
      const rect = cluster.querySelector('rect')
      const label = cluster.querySelector('.cluster-label')
      if (!rect || !label) return
      const ry = parseFloat(rect.getAttribute('y'))
      const rh = parseFloat(rect.getAttribute('height'))
      const m = (label.getAttribute('transform') || '').match(/translate\(\s*([-\d.]+)[ ,]\s*([-\d.]+)\s*\)/)
      if (!m) return
      const lx = parseFloat(m[1])
      const ly = parseFloat(m[2])
      let lh
      try {
        lh = label.getBBox().height
      } catch (e) {
        return // not rendered (display: none); leave untouched
      }
      // Find the highest cluster rect fully contained in this one
      let minChildTop = Infinity
      clusters.forEach(function (other) {
        if (other === cluster) return
        const or = other.querySelector('rect')
        if (!or) return
        const oy = parseFloat(or.getAttribute('y'))
        if (contains(rect, or) && oy < minChildTop) minChildTop = oy
      })
      if (minChildTop === Infinity) return
      const gap = minChildTop - (ly + lh)
      if (gap >= MIN_GAP) return
      const delta = Math.ceil(MIN_GAP - gap)
      // Only top-level clusters push against the viewBox; a shift on a
      // nested cluster is absorbed inside its parent. Decide before the
      // shift moves this rect relative to its parent.
      const isNested = clusters.some(function (other) {
        if (other === cluster) return false
        const or = other.querySelector('rect')
        return or && contains(or, rect)
      })
      label.setAttribute('transform', 'translate(' + lx + ', ' + (ly - delta) + ')')
      rect.setAttribute('y', ry - delta)
      rect.setAttribute('height', rh + delta)
      if (!isNested) viewBoxGrow = Math.max(viewBoxGrow, delta)
    })
    if (viewBoxGrow > 0) {
      const vb = (svg.getAttribute('viewBox') || '').split(/[ ,]+/).map(Number)
      if (vb.length === 4 && vb.every(function (n) { return !isNaN(n) })) {
        vb[1] -= viewBoxGrow
        vb[3] += viewBoxGrow
        svg.setAttribute('viewBox', vb.join(' '))
      }
    }
    svg.setAttribute('data-label-spacing', 'fixed')
  }

  function fixPending () {
    document.querySelectorAll('.mermaid svg:not([data-label-spacing])').forEach(fixSvg)
  }

  // Mermaid renders asynchronously after its module loads; poll briefly.
  let attempts = 0
  const timer = setInterval(function () {
    attempts++
    fixPending()
    const remaining = document.querySelectorAll('.mermaid:not([data-processed])').length
    if (remaining === 0 || attempts > 100) {
      clearInterval(timer)
      // Diagrams hidden while the poll ran (e.g. in inactive tabs) are left
      // unstamped; retry after clicks, which is how tabs get revealed. The
      // selector is empty once everything is fixed, so this stays cheap.
      if (document.querySelector('.mermaid svg:not([data-label-spacing])')) {
        document.addEventListener('click', function () { setTimeout(fixPending, 50) })
      }
    }
  }, 200)
})()
