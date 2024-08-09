/* eslint-disable */

/**
 * This script assigns unique and consistent IDs to <pre> elements containing <code> blocks within the document.
 * The IDs are generated based on a hash of the URL combined with an index. This ensures that the IDs are consistent 
 * across page loads, which is useful for maintaining references and bookmarks to specific code blocks.
 * These IDs are required for the linkable line numbers feature in Prism.
 * https://prismjs.com/plugins/line-highlight/
 */

(function () {
  'use strict'

  // Event listener for when the DOM content is fully loaded
  window.addEventListener('DOMContentLoaded', function (event) {
    /**
     * Generates a hash value for a given string.
     * @param {string} str - The input string to hash.
     * @returns {number} - The hash value of the input string.
     */
    function hashString(str) {
      let hash = 0, i, chr;
      if (str.length === 0) return hash;
      for (i = 0; i < str.length; i++) {
        chr = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0; // Convert to 32bit integer
      }
      return hash;
    }

    /**
     * Generates a unique ID based on the URL hash and an index.
     * This ensures that the ID remains consistent across page loads.
     * @param {number} index - The index of the current <pre> element.
     * @returns {string} - The generated unique ID.
     */
    function generateUniqueId(index) {
      const urlHash = hashString(window.location.href);
      return `code-${urlHash}-${index}`;
    }

    // Select all <pre> elements that are direct children of two nested <div> elements
    var preElements = document.querySelectorAll('div > div > pre');

    // Iterate over each <pre> element
    preElements.forEach(function (preElem, index) {
      // If the first child of the <pre> element is a <code> block, assign a unique ID
      if (preElem.firstElementChild && preElem.firstElementChild.tagName === 'CODE') {
        preElem.id = generateUniqueId(index);
      }

      var grandparent = preElem.parentElement.parentElement;

      // Check if the grandparent element has a class that starts with 'lines'
      Array.from(grandparent.classList).forEach(function (className) {
        if (className.startsWith('lines')) {
          var matches = className.match(/(\d+(-\d+)?)/g);
          if (matches) {
            var attributeValue = matches.join(',');
            preElem.setAttribute('data-line', attributeValue);
          }
        }
        if (className.startsWith('line-numbers')) {
          preElem.classList.add('linkable-line-numbers');
        }
      });
    });
  });
})();
