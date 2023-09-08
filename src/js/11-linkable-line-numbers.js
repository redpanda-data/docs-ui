(function () {
  'use strict'

  window.addEventListener('DOMContentLoaded', function (event) {
    function generateUniqueId () {
      return 'code-' + Math.random().toString(36).substring(2, 9)
    }

    var preElements = document.querySelectorAll('div > div > pre')

    preElements.forEach(function (preElem) {
      if (preElem.firstElementChild && preElem.firstElementChild.tagName === 'CODE') {
        preElem.id = generateUniqueId()
      }

      var grandparent = preElem.parentElement.parentElement

      // Check if the grandparent has a class that starts with 'lines'
      Array.from(grandparent.classList).forEach(function (className) {
        if (className.startsWith('lines')) {
          var matches = className.match(/(\d+(-\d+)?)/g)
          if (matches) {
            var attributeValue = matches.join(',')
            preElem.setAttribute('data-line', attributeValue)
          }
        }
        /* For future use (linkable line numbers)
        if (className.startsWith('line-numbers')) {
          preElem.classList.add('linkable-line-numbers')
        }
        */
      })
    })
  })
})()
