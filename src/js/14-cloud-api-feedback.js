(function () {
  'use strict'

  document.addEventListener('DOMContentLoaded', function () {
    const footer = document.querySelector('.announcement-email')
    const closeButton = document.querySelector('.close-announcement-email-footer')
    const submitButton = document.querySelector('.submit-announcement-button-email')
    const inputContainer = document.querySelector('.input-container')
    const successfulSentEmail = document.querySelector('.successful-sent-email')
    if (typeof window !== 'undefined') {
      if (window.localStorage.getItem('announcement-email-footer-closed') === 'true' && footer) {
        footer.classList.add('hidden-announcement-email-footer')
        return
      }
    }
    if (closeButton) {
      closeButton.addEventListener('click', function () {
        footer.classList.remove('show-announcement-email-footer')
        footer.classList.add('hidden-announcement-email-footer')
        footer.style.position = 'fixed'

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
          footer.style.position = 'fixed'
        }, 3000)
      })
    }
  })
})()
