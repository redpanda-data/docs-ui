;(function () {
  'use strict'
  window.addEventListener('DOMContentLoaded', function (event) {
    const url = new URL(window.location.href)
    const tabId = url.searchParams.get('tab')
    if (tabId) {
      const decodedTabId = decodeURIComponent(tabId)
      this.location.hash = `#${tabId}`
      const panel = document.querySelector(`div#${decodedTabId}--panel`)
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
  const tabs = document.querySelectorAll('li.tab > p')
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function (event) {
      event.preventDefault()
      const currentTab = event.target.parentElement
      const id = currentTab.id
      if (!id) return
      const url = new URL(window.location.href)
      url.searchParams.set('tab', encodeURIComponent(id))
      window.history.pushState(null, null, url)
    })
  })
})()
