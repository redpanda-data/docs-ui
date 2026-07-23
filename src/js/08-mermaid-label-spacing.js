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
    const clusters = Array.from(svg.querySelectorAll('g.cluster'))
    let viewBoxGrow = 0
    clusters.forEach(function (cluster) {
      const rect = cluster.querySelector('rect')
      const label = cluster.querySelector('.cluster-label')
      if (!rect || !label) return
      const rx = parseFloat(rect.getAttribute('x'))
      const ry = parseFloat(rect.getAttribute('y'))
      const rw = parseFloat(rect.getAttribute('width'))
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
        const ox = parseFloat(or.getAttribute('x'))
        const oy = parseFloat(or.getAttribute('y'))
        const ow = parseFloat(or.getAttribute('width'))
        const oh = parseFloat(or.getAttribute('height'))
        const contained = ox >= rx - 1 && ox + ow <= rx + rw + 1 && oy > ry && oy + oh <= ry + rh + 1
        if (contained && oy < minChildTop) minChildTop = oy
      })
      if (minChildTop === Infinity) return
      const gap = minChildTop - (ly + lh)
      if (gap >= MIN_GAP) return
      const delta = Math.ceil(MIN_GAP - gap)
      label.setAttribute('transform', 'translate(' + lx + ', ' + (ly - delta) + ')')
      rect.setAttribute('y', ry - delta)
      rect.setAttribute('height', rh + delta)
      viewBoxGrow = Math.max(viewBoxGrow, delta)
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

  // Mermaid renders asynchronously after its module loads; poll briefly.
  let attempts = 0
  const timer = setInterval(function () {
    attempts++
    const pending = document.querySelectorAll('.mermaid svg:not([data-label-spacing])')
    pending.forEach(fixSvg)
    const remaining = document.querySelectorAll('.mermaid:not([data-processed])').length
    if (remaining === 0 || attempts > 100) clearInterval(timer)
  }, 200)
})()
