;(function () {
  'use strict'
  const anchors = document.querySelectorAll('a.anchor')
  anchors.length && anchors.forEach((a) => {
    const heading = a.closest('h1, h2, h3, h4, h5, h6')
    if (heading) {
      heading.appendChild(a)
    }
  })
})()
