;(function () {
  'use strict'
  const images = document.querySelectorAll('.imageblock img')

  if (!images) return

  images.forEach((image) => {
    image.addEventListener('click', (e) => {
      image.classList.toggle('active')
    })

    image.addEventListener('touchmove', function (e) {
      e.preventDefault()
    })

    image.addEventListener('touchend', function (e) {
      if (!e.target.classList.contains('active')) {
        e.preventDefault()
      }
    })
  })
})()
