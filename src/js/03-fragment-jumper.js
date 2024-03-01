;(function () {
  'use strict'

  var article = document.querySelector('article.doc')
  var toolbar = document.querySelector('.toolbar')

  if (!article || !toolbar) return

  function decodeFragment (hash) {
    return hash && (~hash.indexOf('%') ? decodeURIComponent(hash) : hash).slice(1)
  }

  function computePosition (el, sum) {
    return article.contains(el) ? computePosition(el.offsetParent, el.offsetTop + sum) : sum
  }

  function jumpToAnchor (e) {
    if (e) {
      if (e.altKey || e.ctrlKey) return
      window.location.hash = '#' + this.id
      e.preventDefault()
    }
    window.scrollTo(0, computePosition(this, 0) - toolbar.getBoundingClientRect().bottom)
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
    const childElementsWithId = article.querySelectorAll('*:not(h1):not(h2):not(h3):not(h4):not(h5):not(h6)[id]')
    childElementsWithId.forEach((element) => {
      const anchor = document.createElement('a')
      anchor.className = 'anchor'
      anchor.href = `#${element.id}`
      anchor.setAttribute('aria-label', 'Link to this section')
      element.parentNode.append(anchor)
    })
    Array.prototype.slice.call(document.querySelectorAll('a[href^="#"]')).forEach(function (el) {
      var fragment, target
      if ((fragment = decodeFragment(el.hash)) && (target = document.getElementById(fragment))) {
        el.addEventListener('click', jumpToAnchor.bind(target))
      }
    })
  })
})()
