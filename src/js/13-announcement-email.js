(function () {
  'use strict'

  document.addEventListener('DOMContentLoaded', function () {
    const footer = document.querySelector('.announcement-email')
    const closeButton = document.querySelector('.close-announcement-email-footer')
    const submitButton = document.querySelector('.submit-announcement-button-email')
    const inputContainer = document.querySelector('.input-container')
    const successfulSentEmail = document.querySelector('.successful-sent-email')
    const backToTopButton = document.querySelector('#back-to-top-button')
    let footerDisplayed = false
    let lastScrollTop = 0

    if (typeof window !== 'undefined') {
      if (window.localStorage.getItem('announcement-email-footer-closed') === 'true') {
        footer.classList.add('hidden-announcement-email-footer')
        return
      }
    }

    window.addEventListener('scroll', function () {
      const scrollTop = window.scrollY
      const scrolledToBottom = (window.innerHeight + scrollTop) >= (document.body.offsetHeight)

      if (scrollTop > 50 && !footerDisplayed) {
        if (successfulSentEmail.style.display !== 'block' &&
          window.localStorage.getItem('announcement-email-footer-closed') !== 'true') {
          footer.classList.add('show-announcement-email-footer')
          footerDisplayed = true
        }
      }

      if (scrolledToBottom) {
        footer.style.display = 'none' // Hide the footer when scrolled too far
      } else if (scrollTop < lastScrollTop) {
        footer.style.display = 'flex' // Show the footer when scrolling up
      }

      lastScrollTop = scrollTop
    })

    if (closeButton) {
      closeButton.addEventListener('click', function () {
        footer.classList.remove('show-announcement-email-footer')
        footer.classList.add('hidden-announcement-email-footer')
        footerDisplayed = false
        window.localStorage.setItem('announcement-email-footer-closed', 'true')
      })
    }

    if (submitButton) {
      submitButton.addEventListener('click', function () {
        inputContainer.style.display = 'none'
        successfulSentEmail.style.display = 'flex'
        window.localStorage.setItem('announcement-email-footer-closed', 'true')

        setTimeout(function () {
          footer.classList.remove('show-announcement-email-footer')
          footer.classList.add('hidden-announcement-email-footer')
          footerDisplayed = false
        }, 3000)
      })
    }
    if (backToTopButton) {
      backToTopButton.addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      })
    }
  })
})()
