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

  /**
   * Debounce utility function to limit the rate at which a function can fire.
   * @param {Function} func - The function to debounce.
   * @param {number} wait - The debounce delay in milliseconds.
   * @returns {Function} - The debounced function.
   */
  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  /**
   * Debounced function to highlight targeted code blocks using Prism.js.
   * This ensures that highlighting does not occur excessively during rapid tab switches.
   * @param {HTMLElement[]} codeElements - Array of code elements to highlight.
   */
  const debouncedHighlight = debounce((codeElements) => {
    if (typeof Prism !== 'undefined' && Prism.highlightElement) {
      requestAnimationFrame(() => {
        codeElements.forEach(pre => {
          const code = pre.querySelector('code');
          if (code) {
            // https://prismjs.com/docs/Prism.html#.highlightElement
            Prism.highlightElement(code, true);
            Prism.plugins.lineNumbers.resize(code)
          }
        });
      })
    } else {
      console.warn('Prism.highlightElement() is not available. Ensure Prism.js is correctly loaded.');
    }
  }, 100);

  /**
   * Simulates a click on the specified tab element.
   * @param {HTMLElement} tabElement - The tab element to click.
   */
  function simulateTabClick(tabElement) {
    if (tabElement) {
      tabElement.click();
    }
  }

  /**
   * Removes the 'tab' query parameter from the URL if an anchor is present.
   * Ensures that the hash fragment takes precedence over the 'tab' parameter.
   * @param {URL} url - The current URL object.
   */
  function stripTabParamIfHashPresent(url) {
    if (url.hash && url.searchParams.has('tab')) {
      url.searchParams.delete('tab');
      window.history.replaceState(null, '', url);
    }
  }

  /**
   * Handles deep linking by activating the appropriate tab based on the URL's query parameter or hash fragment.
   */
  function handleDeepLinking() {
    const url = new URL(window.location.href);
    stripTabParamIfHashPresent(url);

    // Re-parse the URL after potential modification
    const updatedUrl = new URL(window.location.href);
    const updatedTabParam = updatedUrl.searchParams.get('tab');
    const hash = updatedUrl.hash.substring(1); // Remove the '#' character

    // Define a valid hash pattern (adjust as needed)
    const validHashPattern = /^[a-zA-Z0-9-_]+$/;

    // Prioritize hash fragment over query parameter
    if (hash && validHashPattern.test(hash)) {
      const targetTab = document.getElementById(hash);
      if (targetTab) {
        simulateTabClick(targetTab);
        return;
      } else {
        console.warn(`No tab found for hash "${hash}".`);
      }
    }

    if (updatedTabParam && validHashPattern.test(updatedTabParam)) {
      const targetTab = document.getElementById(updatedTabParam);
      if (targetTab) {
        simulateTabClick(targetTab);
        return;
      } else {
        console.warn(`No tab found for query parameter "${updatedTabParam}".`);
      }
    }
  }

  /**
   * Sets up event listeners for tab clicks to handle activation and synchronization.
   * Utilizes an external library to manage synchronized tab activation.
   */
  function setupTabListeners() {
    const tabs = document.querySelectorAll('li.tab');

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function (event) {
        event.preventDefault();
        const clickedTab = event.currentTarget;
        const tabId = clickedTab.id;

        // Let the external library handle synchronization
        // After synchronization, highlight code blocks within active tabs
        // Use a short timeout to allow the external library to activate tabs
        setTimeout(() => {
          const activePanels = document.querySelectorAll('.tabpanel:not(.is-hidden)');
          const codeBlocks = Array.from(activePanels).flatMap(panel => Array.from(panel.querySelectorAll('pre.highlight, pre.line-numbers.highlight')));
          if (codeBlocks.length > 0) {
            debouncedHighlight(codeBlocks);
          }
        }, 100); // Adjust delay as needed based on external library's behavior
      });
    });
  }

  /**
   * Initializes the tab synchronization and deep linking on page load.
   */
  function initializeTabs() {
    setupTabListeners();
    handleDeepLinking();
  }

  window.addEventListener('DOMContentLoaded', initializeTabs);

  /**
   * Handle browser navigation (back/forward buttons) to maintain tab state.
   */
  window.addEventListener('popstate', handleDeepLinking);

})();
