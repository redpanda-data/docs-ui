(function () {
  'use strict'

  document.addEventListener('DOMContentLoaded', function () {
    const footer = document.querySelector('.announcement-email')
    const closeButton = document.querySelector('.close-announcement-email-footer')
    const submitButton = document.querySelector('.submit-announcement-button-email')
    const inputContainer = document.querySelector('.input-container')
    const successfulSentEmail = document.querySelector('.successful-sent-email')
    let footerDisplayed = false
    let footerIsStatic = false
    let lastScrollTop = 0
    if (typeof window !== 'undefined') {
      if (window.localStorage.getItem('announcement-email-footer-closed') === 'true') {
        footer.classList.add('hidden-announcement-email-footer')
        return
      }
    }
    window.addEventListener('scroll', function () {
      const scrollTop = window.scrollY

      if (scrollTop > 50 && !footerDisplayed) {
        footer.classList.add('show-announcement-email-footer')
        footerDisplayed = true
      }

      const scrolledToBottom = (window.innerHeight + scrollTop) >= (document.body.offsetHeight)

      if (scrolledToBottom && !footerIsStatic) {
        footer.style.position = 'static'
        footerIsStatic = true
        window.scrollTo(0,document.body.scrollHeight)
      } else if (scrollTop < lastScrollTop && footerIsStatic) {
        footer.style.position = 'fixed'
        footerIsStatic = false
      }

      lastScrollTop = scrollTop
    })

    if (closeButton) {
      closeButton.addEventListener('click', function () {
        footer.classList.remove('show-announcement-email-footer')
        footer.classList.add('hidden-announcement-email-footer')
        footerDisplayed = false
        footer.style.position = 'fixed'
        footerIsStatic = false

        window.localStorage.setItem('announcement-email-footer-closed', 'true')
      })
    }

    if (submitButton) {
      submitButton.addEventListener('click', function () {
        inputContainer.style.display = 'none'
        successfulSentEmail.style.display = 'block'
        window.localStorage.setItem('announcement-email-footer-closed', 'true')

        setTimeout(function () {
          footer.classList.remove('show-announcement-email-footer')
          footer.classList.add('hidden-announcement-email-footer')
          footerDisplayed = false
          footer.style.position = 'fixed'
          footerIsStatic = false
        }, 3000)
      })
    }
  })
})()
