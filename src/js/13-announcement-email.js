(function () {
  'use strict'

  document.addEventListener('DOMContentLoaded', function () {
    const footer = document.querySelector('.announcement-email')
    const closeButton = document.querySelector('.close-footer')
    const submitButton = document.querySelector('.submitButtonEmail')
    const inputContainer = document.querySelector('.inputContainer')
    const successfulSentEmail = document.querySelector('.successfulSentEmail')
    let footerDisplayed = false
    let footerIsStatic = false
    let lastScrollTop = 0
    if (typeof window !== 'undefined') {
      if (window.localStorage.getItem('footerClosed') === 'true') {
        footer.classList.add('hidden-footer')
        return
      }
    }
    window.addEventListener('scroll', function () {
      const scrollTop = window.scrollY

      if (scrollTop > 50 && !footerDisplayed) {
        footer.classList.add('show-footer')
        footerDisplayed = true
      }

      const scrolledToBottom = (window.innerHeight + scrollTop) >= (document.body.offsetHeight - 50)

      if (scrolledToBottom && !footerIsStatic) {
        footer.style.position = 'static'
        footerIsStatic = true
      } else if (scrollTop < lastScrollTop && footerIsStatic) {
        footer.style.position = 'fixed'
        footerIsStatic = false
      }

      lastScrollTop = scrollTop
    })

    if (closeButton) {
      closeButton.addEventListener('click', function () {
        footer.classList.remove('show-footer')
        footer.classList.add('hidden-footer')
        footerDisplayed = false
        footer.style.position = 'fixed'
        footerIsStatic = false

        window.localStorage.setItem('footerClosed', 'true')
      })
    }

    if (submitButton) {
      submitButton.addEventListener('click', function () {
        inputContainer.style.display = 'none'
        successfulSentEmail.style.display = 'block'
        window.localStorage.setItem('footerClosed', 'true')

        setTimeout(function () {
          footer.classList.remove('show-footer')
          footer.classList.add('hidden-footer')
          footerDisplayed = false
          footer.style.position = 'fixed'
          footerIsStatic = false
        }, 3000)
      })
    }
  })
})()
