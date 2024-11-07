/* eslint-disable */

const REGEX_EDITABLE_SPAN = /&lt;.[^&A-Z]+&gt;/g;
const REGEX_ESCAPE = /[\\^$*+?.()|[\]{}]/g;
const REGEX_HTML_TAG = /<[^>]*>/g;
const REGEX_LT_GT = /&lt;|&gt;/g;
const REGEX_PREPROCESS_PUNCTUATION = /<span class="token punctuation">(\()<\/span>|<span class="token punctuation">(\))<\/span>/g;
const REGEX_CONUM_SPAN = /(\s\(<span class="token number">(\d+)<\/span>\)|(\s)\((\d+)\))$/gm;

function unnestPlaceholders() {
  const editables = document.querySelectorAll('[contenteditable="true"]');

  editables.forEach(editable => {

    // Remove empty siblings, but don't remove conum elements
    let nextSibling = editable.nextElementSibling;
    while (nextSibling && nextSibling.innerHTML.trim() === '') {
      // Check if the sibling has a conum class, if so, skip removal
      if (!nextSibling.classList.contains('conum')) {
        const siblingToRemove = nextSibling;
        nextSibling = nextSibling.nextElementSibling;
        siblingToRemove.remove();
      } else {
        // If it's a conum, move to the next sibling without removing it
        nextSibling = nextSibling.nextElementSibling;
      }
    }


    let parent = editable.parentElement;

    // If the parent is also contenteditable, move the child out of the nested structure
    while (parent && parent.getAttribute('contenteditable') === 'true') {
      const grandParent = parent.parentElement;

      // Move the current editable element before the parent to "unnest" it
      grandParent.insertBefore(editable, parent);

      // If the parent becomes empty, remove the parent element
      if (parent.childNodes.length === 0) {
        parent.remove();
      }

      // Continue checking up the chain if the parent is also contenteditable
      parent = grandParent;
    }
  });
}

(function () {
  'use strict';

  function observeCodeBlocksForConumRestoration() {
    const codeElems = document.querySelectorAll('code');

    codeElems.forEach(code => {
      let mutationInProgress = false;

      const observer = new MutationObserver(mutations => {
        if (mutationInProgress) return; // Prevent recursion
        mutationInProgress = true;

        mutations.forEach(mutation => {
          // Check for removed nodes that are conum elements
          mutation.removedNodes.forEach(removedNode => {
            if (removedNode.nodeType === Node.ELEMENT_NODE && removedNode.classList.contains('conum')) {
              // Only reinsert if it was actually removed and not reinserted elsewhere
              if (!mutation.target.querySelector(`i.conum[data-value="${removedNode.getAttribute('data-value')}"]`)) {
                mutation.target.appendChild(removedNode);
              }
            }
          });
          // Optionally, check for added nodes to ensure conum elements were correctly reinserted
          mutation.addedNodes.forEach(addedNode => {
            if (addedNode.nodeType === Node.ELEMENT_NODE && addedNode.classList.contains('conum')) {
              const dataValue = addedNode.getAttribute('data-value');
              const duplicates = mutation.target.querySelectorAll(`i.conum[data-value="${dataValue}"]`);
              if (duplicates.length > 1) {
                // Remove duplicates, keeping the first one
                duplicates.forEach((dup, index) => {
                  if (index > 0) dup.remove();
                });
              }
            }
          });
        });
        mutationInProgress = false;
      });
      observer.observe(code, { childList: true, subtree: true });
    });
  }

  window.addEventListener('DOMContentLoaded', function () {
    try {
      observeCodeBlocksForConumRestoration()
      makePlaceholdersEditable();
      Prism && Prism.highlightAll();
    } catch (error) {
      console.error('An error occurred while making placeholders editable:', error);
    }
  });

  function makePlaceholdersEditable(element) {
    createEditablePlaceholders(element);
    unnestPlaceholders();
    addClasses(element);
    addEvents(element);
  }

  function createEditablePlaceholders(parentElement) {
    const baseElement = parentElement || document;
    const codeElements = baseElement.querySelectorAll("pre > code");

    codeElements.forEach(codeElement => {
      const preElement = codeElement.parentElement;
      const contentDivElement = preElement.parentElement;
      const listingBlockElement = contentDivElement.parentElement;

      if (listingBlockElement.classList.contains('no-placeholders')) {
        return;
      }

      codeElement.classList.add('keep-markup');
      preprocessParentheses(codeElement);
      addConumSpans(codeElement);

      if (!['xml', 'html', 'rust', 'coffeescript', 'text'].includes(codeElement.dataset.lang)) {
        addEditableSpan(/&lt;.[^&A-Z]+&gt;/g, codeElement);
      }
    });
  }

  if (!RegExp.escape) {
    RegExp.escape = function(s) {
      return s.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
    };
  }

  function addEditableSpan(regex, element) {
    if (!element || !element.textContent) {
      return;
    }

    const text = element.innerHTML;
    const placeholders = text.match(regex) || [];
    const processed = new Set();
    let newHTML = text;

    placeholders
      .sort((a, b) => b.length - a.length)
      .forEach(placeholder => {
        const cleanedPlaceholder = placeholder.replace(/<[^>]*>/g, '').replace(/&lt;|&gt;/g, '');
        if (processed.has(placeholder) || cleanedPlaceholder.trim() === 'none') {
          return;
        }
        const regexString = RegExp.escape(placeholder);
        const globalRegex = new RegExp(regexString, 'g');
        newHTML = newHTML.replace(globalRegex, `<span contenteditable="true" data-type="${cleanedPlaceholder}" aria-label="Edit ${cleanedPlaceholder}" title="Edit ${cleanedPlaceholder}" role="textbox" aria-multiline="false">&lt;${cleanedPlaceholder}&gt;</span>`);
        processed.add(placeholder);
      });

    element.innerHTML = newHTML;
  }

  function preprocessParentheses(element) {
    if (!element || !element.textContent) {
      return;
    }

    const pattern = /<span class="token punctuation">(\()<\/span>|<span class="token punctuation">(\))<\/span>/g;
    element.innerHTML = element.innerHTML.replace(pattern, (match, openParen, closeParen) => {
      return openParen || closeParen || match;
    });
  }

  function addConumSpans(element) {
    if (!element || !element.textContent) {
      return;
    }
    // Handle standalone numbers in parentheses, avoiding function-like patterns
    const standalonePattern = /(?<!\w)\((\d+)\)(?!\w)/g;
    element.innerHTML = element.innerHTML.replace(standalonePattern, (match, num) => {
      return `<i class="conum" data-value="${num}"></i>`;
    });
    const complexPattern = /(\s\(<span class="token number">(\d+)<\/span>\)|(\s)\((\d+)\))$/gm;
    element.innerHTML = element.innerHTML.replace(complexPattern, (match, p1, p2, p3, p4) => {
      return p3 ? `${p3}<i class="conum" data-value="${p4}"></i>` : `<i class="conum" data-value="${p2}"></i>`;
    });
  }

  function addClasses(parentElement) {
    const baseElement = parentElement || document;
    const editablePlaceholders = baseElement.querySelectorAll('[contenteditable="true"]');

    editablePlaceholders.forEach(placeholder => {
      placeholder.classList.add('editable');
    });
  }

  function addEvents(parentElement) {
    const baseElement = parentElement || document;
    const editablePlaceholders = baseElement.querySelectorAll('[contenteditable="true"]');

    editablePlaceholders.forEach(placeholder => {
      placeholder.addEventListener('input', handleInputEvent);
      placeholder.addEventListener('keydown', handleEnterKey);
      placeholder.addEventListener('blur', handleBlurEvent);
      placeholder.addEventListener('focus', handleFocusEvent);

      const dataType = placeholder.getAttribute('data-type');
      if (!dataType) {
        console.error('Data type attribute is missing on the placeholder.');
        return;
      }

      const savedText = sessionStorage.getItem(dataType);
      placeholder.textContent = savedText ? savedText : `<${dataType}>`;
    });
  }

  function handleInputEvent(event) {
    const dataType = event.target.dataset.type;
    const newText = event.target.textContent;

    document.querySelectorAll(`[data-type="${dataType}"][contenteditable="true"]`).forEach(span => {
      if (!isWithinHiddenTab(span) && span !== event.target) {
        span.textContent = newText;
      }
    });
  }

  function handleEnterKey(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.target.blur();
    }
  }

  function handleBlurEvent() {

    const currentText = this.textContent.trim();
    const dataType = this.getAttribute('data-type');

    if (!currentText) {
      const defaultText = `<${dataType}>`;
      this.textContent = defaultText;

      document.querySelectorAll(`[data-type="${dataType}"][contenteditable="true"]`).forEach(span => {
        span.textContent = defaultText;
      });
    } else {
      sessionStorage.setItem(dataType, currentText);
    }
  }

  function handleFocusEvent() {
    // Select all text inside the placeholder when it receives focus
    const range = document.createRange();
    const selection = window.getSelection();
    range.selectNodeContents(this);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function isWithinHiddenTab(element) {
    let ancestor = element.parentElement;
    while (ancestor) {
      if (ancestor.classList.contains('tabpanel') && ancestor.classList.contains('is-hidden')) {
        return true;
      }
      ancestor = ancestor.parentElement;
    }
    return false;
  }
})();
