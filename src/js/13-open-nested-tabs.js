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
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  /**
   * Debounced function to highlight all code blocks using Prism.js.
   * This ensures that highlighting does not occur excessively during rapid tab switches.
   */
  const debouncedHighlightAll = debounce(() => {
    if (typeof Prism !== 'undefined' && Prism.highlightAll) {
      Prism.highlightAll();
      // If using line numbers plugin, resize them accordingly
      const lineNumberElements = document.querySelectorAll('.line-numbers');
      lineNumberElements.forEach(element => {
        if (Prism.plugins.lineNumbers) {
          Prism.plugins.lineNumbers.resize(element);
        }
      });
    }
  }, 200);

  /**
   * Retrieves the closest ancestor element with a 'data-sync-group-id' attribute.
   * @param {HTMLElement} element - The element to start searching from.
   * @returns {HTMLElement|null} - The closest ancestor with 'data-sync-group-id', or null if not found.
   */
  function getClosestSyncGroupElement(element) {
    if (element) {
      return element.closest('[data-sync-group-id]');
    }
    return null;
  }

  /**
   * Activates a tab by its ID across all synchronization groups it belongs to.
   * @param {string} tabId - The ID of the tab to activate.
   */
  function activateTab(tabId) {

    const targetTab = document.getElementById(tabId);
    if (!targetTab) {
      return;
    }

    const syncGroupElement = getClosestSyncGroupElement(targetTab);
    if (!syncGroupElement) {
      return;
    }

    const syncGroupIds = syncGroupElement.dataset.syncGroupId.split('|').map(id => id.trim());

    syncGroupIds.forEach(syncGroupId => {
      // Select all tab groups with this synchronization group ID
      const tabGroups = document.querySelectorAll(`[data-sync-group-id="${syncGroupId}"]`);
      tabGroups.forEach(group => {
        // Deactivate all tabs in this group
        const tabs = group.querySelectorAll('li.tab');
        tabs.forEach(tab => {
          tab.classList.remove('active');
          tab.setAttribute('aria-selected', 'false');
          tab.setAttribute('tabindex', '-1');
        });

        // Hide all tab panels in this group
        const panels = group.querySelectorAll('.tabpanel');
        panels.forEach(panel => {
          panel.classList.add('is-hidden');
          panel.setAttribute('hidden', '');
        });

        // Activate the target tab in this group
        const currentTab = group.querySelector(`#${tabId}`);
        if (currentTab) {
          currentTab.classList.add('active');
          currentTab.setAttribute('aria-selected', 'true');
          currentTab.setAttribute('tabindex', '0');

          // Show the corresponding tab panel
          const panelId = `${tabId}--panel`;
          const targetPanel = group.querySelector(`#${panelId}`);
          if (targetPanel) {
            targetPanel.classList.remove('is-hidden');
            targetPanel.removeAttribute('hidden');

            // Optionally, scroll to the activated tab panel
            targetPanel.scrollIntoView({ behavior: 'smooth' });
          }
        }
      });
    });

    // Update the URL with the active tab ID
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tabId);
    window.history.pushState(null, '', url);

    // Trigger Prism.js highlighting
    debouncedHighlightAll();
  }

  /**
   * Removes the 'tab' query parameter from the URL if an anchor is present.
   * Ensures that the hash fragment takes precedence over the 'tab' parameter.
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

    // Prioritize hash fragment over query parameter
    if (hash) {
      const targetTab = document.getElementById(hash);
      if (targetTab) {
        activateTab(hash);
        return;
      }
    }

    if (updatedTabParam) {
      const targetTab = document.getElementById(updatedTabParam);
      if (targetTab) {
        activateTab(updatedTabParam);
        return;
      }
    }
  }

  /**
   * Sets up event listeners for tab clicks to handle activation and synchronization.
   */
  function setupTabListeners() {
    const tabs = document.querySelectorAll('li.tab');

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function (event) {
        event.preventDefault();
        const clickedTab = event.currentTarget;
        const tabId = clickedTab.id;
        activateTab(tabId);
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
