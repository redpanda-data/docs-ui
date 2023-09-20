/* global Prism */
/* global makePlaceholdersEditable */

;(function () {
  'use strict'
  window.addEventListener('DOMContentLoaded', function (event) {
    const url = new URL(window.location.href)
    const tabId = url.searchParams.get('tab')
    if (tabId) {
      this.location.hash = `#${tabId}`
    }
  })
  const tabs = document.querySelectorAll('li.tab')
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function (event) {
      const currentTab = event.target.parentElement
      const id = currentTab.id
      if (!id) return
      const url = new URL(window.location.href)
      url.searchParams.set('tab', encodeURIComponent(id))
      window.history.pushState(null, null, url)
      // Rerun the line highlighter and editable placeholders scripts on the new tab content
      Prism && Prism.highlightAll()
      makePlaceholdersEditable && makePlaceholdersEditable()
    })
  })
})()
