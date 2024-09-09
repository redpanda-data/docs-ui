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
 * - Scroll to the selected tab.
 */

(function () {
  'use strict';

  function debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  const debouncedHighlightAll = debounce(async () => {
    const elementsToHighlight = document.querySelectorAll('.tabs.is-loaded pre.highlight');
    elementsToHighlight && await Prism.highlightAll();
    elementsToHighlight.forEach(async (element) => {
      await Prism.plugins.lineNumbers.resize(element);
    });
  }, 300);

  window.addEventListener('DOMContentLoaded', function () {
    const url = new URL(window.location.href);
    const tabParam = url.searchParams.get('tab');

    function getClosestSyncGroupId(element) {
      if (element) {
        return element.closest('[data-sync-group-id]');
      }
      return null;
    }

    // Handle deep linking when tabParam exists
    if (tabParam) {
      const targetTab = document.getElementById(tabParam);
      if (targetTab) {
        const syncGroup = getClosestSyncGroupId(targetTab);
        if (!syncGroup.classList.contains('is-loaded')) {
          targetTab.click();
        }
        setTimeout(() => {
          targetTab.scrollIntoView({ behavior: 'smooth' });
        }, 0);
      }
    }

    const tabs = document.querySelectorAll('li.tab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function (event) {
        const currentTab = event.target.closest('li.tab');
        const tabId = currentTab.getAttribute('id');

        // Update the URL query parameter for the active tab
        const url = new URL(window.location.href);
        url.searchParams.set('tab', tabId);
        window.history.pushState(null, null, url);

        // Perform syntax highlighting and re-add pencil spans
        debouncedHighlightAll();
      }, true);
    });
  });
})();
