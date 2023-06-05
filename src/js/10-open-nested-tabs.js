document.addEventListener('DOMContentLoaded', function () {
  const tabs = document.querySelectorAll('li.tab > p')
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function (event) {
      const currentTab = event.target.parentElement
      const id = currentTab.id
      if (!id) return
      window.location.hash = '#' + encodeURIComponent(id)
      const panel = document.querySelector(`div#${id}--panel`)
      if (panel) {
        const hiddenElement = panel.querySelector('.is-hidden[hidden]')
        if (hiddenElement) {
          hiddenElement.classList.remove('is-hidden')
          hiddenElement.removeAttribute('hidden')
          hiddenElement.classList.add('is-selected')
        }
        const tablist = panel.querySelector('.tablist')
        if (tablist) {
          const firstTab = tablist.querySelector('li')
          if (firstTab) {
            firstTab.classList.add('is-selected')
          }
        }
      }
    })
  })
})
