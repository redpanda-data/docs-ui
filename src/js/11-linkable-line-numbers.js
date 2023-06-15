;(function () {
  'use strict'

  window.addEventListener('DOMContentLoaded', function (event) {
    function generateUniqueId () {
      return 'code-' + Math.random().toString(36).substring(2, 9)
    }

    var preElements = document.getElementsByTagName('pre')

    if (!preElements.length) return

    for (var i = 0; i < preElements.length; i++) {
      if (preElements[i].firstElementChild && preElements[i].firstElementChild.tagName === 'CODE') {
        preElements[i].id = generateUniqueId()
      }
      var parent = preElements[i].parentElement
      var grandparent = parent ? parent.parentElement : null
      if (parent && parent.tagName === 'DIV' && grandparent && grandparent.tagName === 'DIV') {
        if (grandparent.classList.contains('line-numbers')) {
          preElements[i].classList.add('linkable-line-numbers')
        }
      }
    }
  })
})()
