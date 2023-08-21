;(function () {
  'use strict'
  window.addEventListener('DOMContentLoaded', function (event) {
    var announcementBar = document.querySelector('.announcement-bar')
    if (!announcementBar) return
    var navbarBrand = document.getElementById('brand')
    var closeButton = document.getElementById('close')
    // Hide the announcement bar if the session cookie is set
    if (window.sessionStorage.getItem('announcementClosed')) {
      announcementBar.style.display = 'none'
      navbarBrand.style.height = 'inherit'
    } else {
      // When the announcement bar is not closed, reset height
      navbarBrand.style.height = '70px'
    }
    closeButton.addEventListener('click', function () {
      announcementBar.style.display = 'none'
      navbarBrand.style.height = 'inherit'
      window.sessionStorage.setItem('announcementClosed', 'true')
    })
  })
})()
