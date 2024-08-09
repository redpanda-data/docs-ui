/* eslint-disable */

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

    // Function to get the data-sync-group-id of the closest ancestor
    function getClosestSyncGroupId(element) {
      if (element) {
        return element.closest('[data-sync-group-id]');
      }
      return null;
    }

    // If a tabId is present, simulate a click on the corresponding tab
    if (tabId) {
      // Set the hash anchor to the value of the 'tab' parameter
      url.hash = `#${tabId}`;
      // Remove the 'tab' parameter from the query string
      url.searchParams.delete('tab');
      // Update the browser's URL without reloading the page
      window.history.replaceState({}, document.title, url.toString());
      // Scroll to the element with the new hash anchor
      const element = document.getElementById(tabId);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
      setTimeout(() => {
        const tabToClick = document.getElementById(tabId)
        const syncGroup = getClosestSyncGroupId(tabToClick)
        if (tabToClick) {
          if (syncGroup && !syncGroup.classList.contains('is-loaded')) tabToClick.click() // Simulate the click event
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
        setTimeout(function() {
          // Defer highlighting using requestIdleCallback
          requestIdleCallback(function() {
            const elementsToHighlight = document.querySelectorAll('.tabs.is-loaded pre.highlight');
            elementsToHighlight.forEach((element) => {
              Prism.plugins.lineNumbers.resize(element);
            });
            Prism.highlightAll()
          });
          const editableSpans = document.querySelectorAll('[contenteditable="true"].editable');
          editableSpans.forEach(span => {
            removeNestedSpans(span);
          });
          addPencilSpans();
        }, 0);
      }, true)
    })
  })
})()
