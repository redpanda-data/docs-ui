;(function () {
  'use strict'

  const switchButton = document.getElementById('switch-theme')
  if (!switchButton) return

  let theme = window.localStorage.getItem('theme')

  function setTheme (switchButton) {
    const img = switchButton.querySelector('img:first-child')
    if (theme === 'dark') {
      const newSrc = img.src.replace('view-sun', 'view-moon')
      img.src = newSrc
      // turn it white
      img.classList.add('moon')
      document.documentElement.setAttribute('data-theme', 'dark')
    } else {
      const newSrc = img.src.replace('view-moon', 'view-sun')
      img.src = newSrc
      img.classList.remove('moon')
      document.documentElement.removeAttribute('data-theme')
    }
  }

  switchButton.addEventListener('click', function () {
    theme = theme === 'light' ? 'dark' : 'light'
    window.localStorage.setItem('theme', theme)
    setTheme(this)
  })
})()
