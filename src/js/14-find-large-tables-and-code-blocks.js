(function () {
  'use strict'
  document.addEventListener('DOMContentLoaded', function () {
    const tables = document.querySelectorAll('table.tableblock:not(.no-clip)')
    const codeBlocks = document.querySelectorAll('listingblock:not(.no-clip) pre')
    const allElements = [...tables, ...codeBlocks]

    allElements.forEach((element, index) => {
      if (element.getBoundingClientRect().height > 1000) {
        const wrapper = document.createElement('div')
        wrapper.className = 'clippedcontainer'
        wrapper.id = `content-wrapper-${index}`
        element.parentNode.insertBefore(wrapper, element)
        wrapper.appendChild(element)
        wrapper.style.overflow = 'scroll'
        wrapper.style.transition = 'max-height 0.5s ease'
        wrapper.style.maxHeight = '400px'

        const buttonContainer = document.createElement('div')
        buttonContainer.style.display = 'flex'
        buttonContainer.style.justifyContent = 'flex-end'
        buttonContainer.style.marginTop = '-10px'

        const expandBtn = document.createElement('button')
        expandBtn.innerText = 'Expand'
        expandBtn.className = 'badge-button'
        expandBtn.setAttribute('aria-expanded', 'false')
        expandBtn.setAttribute('aria-controls', wrapper.id)
        expandBtn.setAttribute('role', 'button')
        expandBtn.setAttribute('tabindex', '0')

        buttonContainer.appendChild(expandBtn)
        wrapper.parentNode.insertBefore(buttonContainer, wrapper.nextSibling)

        expandBtn.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            expandBtn.click()
          }
        })
      }
    })

    allElements.forEach((element) => {
      const wrapper = element.closest('.clippedcontainer')
      if (wrapper) {
        const button = wrapper.nextSibling.querySelector('button')
        adjustElement(wrapper, button, true)
      }
    })

    document.querySelectorAll('.badge-button').forEach((button) => {
      button.addEventListener('click', () => {
        const newState = button.getAttribute('aria-expanded') === 'false'
        const wrapper = button.closest('div').previousSibling // Find the associated wrapper
        adjustElement(wrapper, button, newState)
        // Scroll to keep the wrapper visible
        scrollToTopOfWrapper(wrapper)
      })
    })

    function adjustElement (wrapper, button, expand) {
      const element = wrapper.firstChild
      wrapper.style.maxHeight = expand ? `${element.scrollHeight}px` : '400px'
      button.innerText = expand ? 'Reduce' : 'Expand'
      button.setAttribute('aria-expanded', expand)
      wrapper.style.overflow = expand ? 'unset' : 'scroll'
    }

    function scrollToTopOfWrapper (wrapper) {
      // Obtain the height of the toolbar and navbar, defaulting to 0 if they are not found
      const toolbarHeight = document.querySelector('.toolbar') ? document.querySelector('.toolbar').offsetHeight : 0
      const navbarHeight = document.querySelector('.navbar') ? document.querySelector('.navbar').offsetHeight : 0
      // Calculate the total offset height including both the toolbar and navbar
      const totalOffsetHeight = toolbarHeight + navbarHeight
      // Calculate the top position by considering the total offset height
      const topPosition = wrapper.getBoundingClientRect().top + window.scrollY - totalOffsetHeight
      // Scroll to the calculated position smoothly
      window.scrollTo({
        top: topPosition,
        behavior: 'smooth',
      })
    }
  })
})()
