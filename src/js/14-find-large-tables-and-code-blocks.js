(function () {
  'use strict'
  document.addEventListener('DOMContentLoaded', function () {
    const tables = document.querySelectorAll('table.tableblock')
    const codeBlocks = document.querySelectorAll('pre')

    const processElement = (element, contentType) => {
      const height = element.getBoundingClientRect().height
      if (height > 1000) {
        const wrapper = document.createElement('div')
        wrapper.className = 'clippedcontainer'
        element.parentNode.insertBefore(wrapper, element)
        wrapper.appendChild(element)
        wrapper.style.overflow = 'scroll'
        wrapper.style.maxHeight = '500px'
        wrapper.style.transition = 'max-height 0.5s ease'

        const readMoreBtn = document.createElement('button')
        readMoreBtn.innerText = contentType === 'table' ? 'Show full table' : 'View more code'
        readMoreBtn.className = 'badge-button'
        readMoreBtn.setAttribute('aria-expanded', 'false')
        readMoreBtn.setAttribute('role', 'button')
        readMoreBtn.setAttribute('tabindex', '0')

        wrapper.parentNode.insertBefore(readMoreBtn, wrapper.nextSibling)

        const key = `expand-state-${contentType}-${Array.from(wrapper.parentNode.children).indexOf(wrapper)}`
        const storedState = window.localStorage.getItem(key)
        if (storedState === 'true') {
          wrapper.style.maxHeight = `${element.scrollHeight}px`
          readMoreBtn.innerText = contentType === 'table' ? 'Hide full table' : 'View less code'
          readMoreBtn.setAttribute('aria-expanded', 'true')
        }

        readMoreBtn.addEventListener('click', function () {
          const isExpanded = readMoreBtn.getAttribute('aria-expanded') === 'true'
          wrapper.style.maxHeight = isExpanded ? '500px' : 'none'
          wrapper.style.overflow = isExpanded ? 'scroll' : 'unset'
          readMoreBtn.innerText = isExpanded
            ? (contentType === 'table'
              ? 'Show full table' : 'View more code') : (contentType === 'table'
              ? 'Hide full table' : 'View less code')
          readMoreBtn.setAttribute('aria-expanded', !isExpanded)

          window.localStorage.setItem(key, !isExpanded)

          if (isExpanded) {
            const headerHeight = document.querySelector('#brand').offsetHeight
            const topPos = wrapper.getBoundingClientRect().top + window.scrollY - headerHeight
            window.scrollTo({
              top: topPos,
              behavior: 'smooth',
            })
          }
        })
      }
    }

    tables.forEach((table) => processElement(table, 'table'))
    codeBlocks.forEach((codeBlock) => processElement(codeBlock, 'code'))
  })
})()
