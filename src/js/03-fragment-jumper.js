;(function () {
  'use strict'

  var article = document.querySelector('article.doc')
  var toolbar = document.querySelector('.toolbar')

  if (!article || !toolbar) return

  function decodeFragment (hash) {
    return hash && (~hash.indexOf('%') ? decodeURIComponent(hash) : hash).slice(1)
  }

  function jumpToAnchor (e) {
    console.log('Do not hijack scroll behavior')
    // if (e) {
    //   if (e.altKey || e.ctrlKey) return
    //   window.location.hash = '#' + this.id
    //   e.preventDefault()
    // }
    // window.scrollTo(0, computePosition(this, 0))
  }

  window.addEventListener('load', function jumpOnLoad (e) {
    var fragment, target
    if ((fragment = decodeFragment(window.location.hash)) && (target = document.getElementById(fragment))) {
      jumpToAnchor.bind(target)()
      setTimeout(jumpToAnchor.bind(target), 0)
    }
    window.removeEventListener('load', jumpOnLoad)
  })

  document.addEventListener('DOMContentLoaded', () => {
    const article = document.querySelector('.doc')
    const eligibleElements = article.querySelectorAll('li:not(.tablist li)')

    eligibleElements.forEach((element) => {
      if (element.id) {
        const anchor = document.createElement('a')
        anchor.href = `#${element.id}`
        anchor.className = 'anchor visible-anchor'
        anchor.setAttribute('aria-label', 'Link to this section')
        element.appendChild(anchor)
      }
    })
    Array.prototype.slice.call(document.querySelectorAll('a[href^="#"]')).forEach(function (el) {
      var fragment, target
      if ((fragment = decodeFragment(el.hash)) && (target = document.getElementById(fragment))) {
        el.addEventListener('click', jumpToAnchor.bind(target))
      }
    })
  })
})()
