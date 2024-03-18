;(function () {
  'use strict'

  const switchButton = document.getElementById('switch-theme')
  if (!switchButton) return
  const rapidocEl = document.getElementById('api')

  let theme = window.localStorage.getItem('theme') ||
  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

  function setTheme (switchButton) {
    const img = switchButton.querySelector('img:first-child')
    if (theme === 'dark') {
      const newSrc = img.src.replace('view-sun', 'view-moon')
      img.src = newSrc
      // turn it white
      img.classList.add('moon')
      document.documentElement.setAttribute('data-theme', 'dark')
      document.body.setAttribute('data-theme', 'dark')
      if (rapidocEl) {
        rapidocEl.setAttribute('theme', 'dark')
        rapidocEl.setAttribute('nav-bg-color', '#212121')
        rapidocEl.setAttribute('bg-color', '#212121')
      }
    } else {
      const newSrc = img.src.replace('view-moon', 'view-sun')
      img.src = newSrc
      img.classList.remove('moon')
      document.documentElement.removeAttribute('data-theme')
      document.body.removeAttribute('data-theme')
      if (rapidocEl) {
        rapidocEl.setAttribute('theme', 'light')
        rapidocEl.setAttribute('nav-bg-color', '#fff')
        rapidocEl.setAttribute('bg-color', '#fff')
      }
    }
  }

  switchButton.addEventListener('click', function () {
    theme = theme === 'light' ? 'dark' : 'light'
    window.localStorage.setItem('theme', theme)
    setTheme(this)
  })
})()
