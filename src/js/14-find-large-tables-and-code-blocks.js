(function () {
  'use strict'
  document.addEventListener('DOMContentLoaded', function () {
    const tables = document.querySelectorAll('table.tableblock:not(.no-clip)')
    const codeBlocks = document.querySelectorAll('pre')

    const processElement = (element, contentType) => {
      // If the element is a table and has the "no-clip" class, return early without processing
      if (contentType === 'table' && element.classList.contains('no-clip')) {
        return
      }

      const height = element.getBoundingClientRect().height
      if (height > 1000) {
        const wrapper = document.createElement('div')
        wrapper.className = 'clippedcontainer'
        element.parentNode.insertBefore(wrapper, element)
        wrapper.appendChild(element)
        wrapper.style.overflow = 'scroll'
        wrapper.style.maxHeight = '400px'
        wrapper.style.transition = 'max-height 0.5s ease'

        // Create a new container for the button with flex styling
        const buttonContainer = document.createElement('div')
        buttonContainer.style.display = 'flex'
        buttonContainer.style.justifyContent = 'flex-end'
        buttonContainer.style.marginTop = '-10px'

        const readMoreBtn = document.createElement('button')
        readMoreBtn.innerText = contentType === 'table' ? 'Show full table' : 'View more code'
        readMoreBtn.className = 'badge-button'
        readMoreBtn.setAttribute('aria-expanded', 'false')
        readMoreBtn.setAttribute('role', 'button')
        readMoreBtn.setAttribute('tabindex', '0')

        // Append the button to the new container
        buttonContainer.appendChild(readMoreBtn)

        // Insert the button container after the wrapper
        wrapper.parentNode.insertBefore(buttonContainer, wrapper.nextSibling)

        const key = `expand-state-${contentType}-${Array.from(wrapper.parentNode.children).indexOf(wrapper)}`
        const storedState = window.localStorage.getItem(key)
        if (storedState === 'true') {
          wrapper.style.maxHeight = `${element.scrollHeight}px`
          readMoreBtn.innerText = contentType === 'table' ? 'Hide full table' : 'View less code'
          readMoreBtn.setAttribute('aria-expanded', 'true')
        }

        readMoreBtn.addEventListener('click', function () {
          const isExpanded = readMoreBtn.getAttribute('aria-expanded') === 'true'
          wrapper.style.maxHeight = isExpanded ? '400px' : `${element.scrollHeight}px`
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
