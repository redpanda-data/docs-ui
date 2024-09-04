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
  'use strict'

  function debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  const debouncedHighlightAll = debounce(() => {
    const elementsToHighlight = document.querySelectorAll('.tabs.is-loaded pre.highlight');
    elementsToHighlight.forEach((element) => {
      Prism.plugins.lineNumbers.resize(element);
    });
    Prism.highlightAll();
  }, 300); // Adjust debounce wait time as needed

  const debouncedAddPencilSpans = debounce(addPencilSpans, 300);

  window.addEventListener('DOMContentLoaded', function (event) {
    const url = new URL(window.location.href);
    const tabId = url.searchParams.get('tab') || url.hash.replace('#', '');

    function getClosestSyncGroupId(element) {
      if (element) {
        return element.closest('[data-sync-group-id]');
      }
      return null;
    }

    if (tabId) {
      url.hash = `#${tabId}`;
      url.searchParams.delete('tab');
      window.history.replaceState({}, document.title, url.toString());
      const element = document.getElementById(tabId);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
      setTimeout(() => {
        const tabToClick = document.getElementById(tabId);
        const syncGroup = getClosestSyncGroupId(tabToClick);
        if (tabToClick) {
          if (syncGroup && !syncGroup.classList.contains('is-loaded')) tabToClick.click();
        }
      }, 0);
    }

    const tabs = document.querySelectorAll('li.tab');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function (event) {
        const currentTab = event.target.closest('li.tab');
        const id = currentTab.id;

        const url = new URL(window.location.href);
        url.hash = id;
        url.searchParams.set('tab', id);
        window.history.pushState(null, null, url);
        debouncedHighlightAll();
        debouncedAddPencilSpans();
      }, true);
    });
  });
})();
