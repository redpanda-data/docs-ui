document.addEventListener('DOMContentLoaded', function () {
  const tabs = document.querySelectorAll('li.tab')
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      if (tab.classList.contains('is-selected')) {
        const id = tab.id
        console.log(id)
        if (!id) return
        const url = window.location.href.replace(window.location.hash, '') + '#' + encodeURIComponent(id)
        window.history.pushState(null, null, url)
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
      }
    })
  })
})
