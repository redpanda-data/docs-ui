;(function () {
  'use strict'
  window.addEventListener('DOMContentLoaded', function (event) {
    var announcementBar = document.querySelector('.announcement-bar')
    if (!announcementBar) return
    var closeButton = document.getElementById('close-announcement')
    // Hide the announcement bar if the session cookie is set
    if (window.sessionStorage.getItem('announcementClosed')) {
      announcementBar.style.display = 'none'
    }
    closeButton.addEventListener('click', function () {
      announcementBar.style.display = 'none'
      window.sessionStorage.setItem('announcementClosed', 'true')
    })
  })
})()
