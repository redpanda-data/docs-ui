/* global Prism */
/* global makePlaceholdersEditable */

/**
 * This script supports deep linking to specific tabs and anchor links.
 * It allows users to directly link to a specific tab using query parameters or hash fragments in the URL.
 * When a tab is clicked, it updates the URL to reflect the selected tab.
 * Additionally, it ensures that related tabs are synchronized and that content is properly displayed and highlighted.
 *
 * Main functionalities:
 * - Support linking directly to a specific tab using the 'tab' query parameter or hash fragment.
 * - Update the URL when a tab is clicked to maintain the state of the selected tab.
 * - Synchronize related tabs across the page.
 * - Re-run Prism for syntax highlighting when tab content becomes visible.
 * - Scroll to the selected tab or anchor smoothly.
 */

(function () {
  'use strict'

  window.addEventListener('DOMContentLoaded', function (event) {
    // Get the current URL and extract the 'tab' query parameter or hash value
    const url = new URL(window.location.href)
    const tabId = url.searchParams.get('tab') || url.hash.replace('#', '')
    const anchor = url.hash ? url.hash.split('#')[1] : null

    // If a tabId is present, simulate a click on the corresponding tab
    if (tabId) {
      setTimeout(() => {
        const tabToClick = document.getElementById(tabId)
        if (tabToClick) {
          tabToClick.click() // Simulate the click event
          if (anchor) {
            scrollToAnchor(anchor) // Scroll to the specified anchor if present
          } else {
            scrollToTab(tabId) // Scroll to the tab if no anchor is specified
          }
        }
      }, 0)
    }

    // Add click event listeners to all tabs
    const tabs = document.querySelectorAll('li.tab')
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function (event) {
        const currentTab = event.target.closest('li.tab')
        const id = currentTab.id

        // Update the hash fragment and the query parameter
        const url = new URL(window.location.href)
        url.hash = id
        url.searchParams.set('tab', id)
        window.history.pushState(null, null, url)

        // Remove the 'tabs-' prefix and any number to get the base tab value
        const baseTabValue = id.replace(/tabs-\d+-/i, '')

        // Get all related (synced) tabs based on the base tab value
        const relatedTabs = document.querySelectorAll(`li.tab[data-sync-id="${baseTabValue}"]`)
        relatedTabs.forEach((relatedTab) => {
          const relatedTabId = relatedTab.id
          setTimeout(() => {
            handleTabSelection(relatedTabId) // Handle the tab selection for related tabs
          }, 0)
        })
      }, true)
    })
  })

  // Function to handle tab selection
  // Ensures that Prism highlights syntax correctly when the tab content is visible
  function handleTabSelection (tabId) {
    const tabContent = document.getElementById(tabId + '--panel')
    const preElementWithDataLine = tabContent.querySelector('.content pre[data-line]')
    preElementWithDataLine && waitForVisibility(preElementWithDataLine, () => {
      if (Prism) {
        Prism.highlightAllUnder(tabContent) // Highlight syntax
        makePlaceholdersEditable(tabContent) // Make placeholders editable
      }
    })
  }

  // Function to wait until the element is visible before executing the callback
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

  // Function to scroll to the selected tab
  function scrollToTab (tabId) {
    const tabElement = document.getElementById(tabId)
    if (tabElement) {
      tabElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  // Function to scroll to a specified anchor
  function scrollToAnchor (anchor) {
    const anchorElement = document.getElementById(anchor) || document.querySelector(`[name="${anchor}"]`)
    if (anchorElement) {
      anchorElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }
})()
