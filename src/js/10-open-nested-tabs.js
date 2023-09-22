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
    const tabs = document.querySelectorAll('li.tab')
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function (event) {
        const currentTab = event.target
        let id = currentTab.id
        if (!id) {
          id = event.target.parentElement.id
        }
        setTimeout(() => {
          const tabContent = document.getElementById(id + '--panel')
          const url = new URL(window.location.href)
          url.searchParams.set('tab', encodeURIComponent(id))
          window.history.pushState(null, null, url)
          // Prism requires content to be visible
          // so that it can calculate dimensions for the lines.
          // Since tab content is hidden until clicked
          // we need to rerun Prism when the tab is clicked
          // so it can make the correct calculations.
          // Prism also rewrites the content, so we lose editable placeholders.
          // Rerun the script to make placeholders editable.
          // TODO: Find a way to store editable placeholder state and reapply.
          // If a user edits content in one tab and switches back and forth between another tab
          // the content no longer matches the regex in editable placeholders
          //so it is no longer editable
          const preElementWithDataLine = tabContent.querySelector('.content pre[data-line]')
          preElementWithDataLine && waitForVisibility(preElementWithDataLine, () => {
            if (Prism) {
              Prism.highlightAllUnder(tabContent)
              makePlaceholdersEditable(tabContent)
            }
          })
        })
      }, 0)
    })
  })
  function waitForVisibility (element, callback) {
    if (window.getComputedStyle(element, null).display !== 'none') {
      callback()
      return
    }

    const observer = new window.MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.target === element && window.getComputedStyle(element, null).display !== 'none') {
          observer.disconnect()
          callback()
        }
      })
    })

    observer.observe(element, {
      attributes: true,
      attributeFilter: ['style'],
    })
  }
})()
