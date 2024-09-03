/* eslint-disable */

const REGEX_EDITABLE_SPAN = /&lt;.[^&A-Z]+&gt;/g;
const REGEX_ESCAPE = /[\\^$*+?.()|[\]{}]/g;
const REGEX_HTML_TAG = /<[^>]*>/g;
const REGEX_LT_GT = /&lt;|&gt;/g;
const REGEX_PREPROCESS_PUNCTUATION = /<span class="token punctuation">(\()<\/span>|<span class="token punctuation">(\))<\/span>/g;
const REGEX_CONUM_SPAN = /(\s\(<span class="token number">(\d+)<\/span>\)|(\s)\((\d+)\))$/gm;

function addPencilSpans() {
  const editableSpans = document.querySelectorAll('[contenteditable="true"].editable');

  editableSpans.forEach(span => {
    let nextSibling = span.nextElementSibling;

    while (nextSibling && !nextSibling.textContent.trim() && !nextSibling.classList.contains('cursor')) {
      const siblingToRemove = nextSibling;
      nextSibling = nextSibling.nextElementSibling;
      siblingToRemove.remove();
    }

    if (!nextSibling?.classList.contains('cursor')) {
      const pencilSpan = document.createElement('span');
      pencilSpan.className = 'fa fa-pencil cursor';
      pencilSpan.setAttribute('aria-hidden', 'true');
      span.insertAdjacentElement('afterend', pencilSpan);
    }
  });
}

function processEditableSpans() {
  const editableSpans = document.querySelectorAll('[contenteditable="true"].editable');

  editableSpans.forEach(span => {
    const codeParent = span.closest('code');

    if (codeParent && span.parentElement !== codeParent) {
      let currentParent = span.parentElement;

      while (currentParent && currentParent !== codeParent) {
        const grandParent = currentParent.parentElement;

        if (grandParent && grandParent === codeParent) {
          grandParent.insertBefore(span, currentParent.nextSibling);
        } else {
          grandParent.insertBefore(span, currentParent);
        }

        if (currentParent.textContent.trim() === '' && !currentParent.classList.contains('cursor')) {
          currentParent.remove();
        }

        currentParent = span.parentElement;
      }
    }

    let textContent = '';
    span.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        textContent += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'SPAN') {
        textContent += node.textContent;
      }
    });

    span.textContent = textContent.trim();
  });

  addPencilSpans();
}

(function () {
  'use strict';

  function observeCodeBlocksForConumRestoration() {
    const codeElems = document.querySelectorAll('code');

    codeElems.forEach(code => {
      let mutationInProgress = false;

      const observer = new MutationObserver(mutations => {
        if (mutationInProgress) return;
        mutationInProgress = true;

        mutations.forEach(mutation => {
          mutation.removedNodes.forEach(removedNode => {
            if (removedNode.nodeType === Node.ELEMENT_NODE && removedNode.classList.contains('conum')) {
              if (!mutation.target.querySelector(`i.conum[data-value="${removedNode.getAttribute('data-value')}"]`)) {
                mutation.target.appendChild(removedNode);
              }
            }
          });
          mutation.addedNodes.forEach(addedNode => {
            if (addedNode.nodeType === Node.ELEMENT_NODE && addedNode.classList.contains('conum')) {
              const dataValue = addedNode.getAttribute('data-value');
              const duplicates = mutation.target.querySelectorAll(`i.conum[data-value="${dataValue}"]`);
              if (duplicates.length > 1) {
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
      observeCodeBlocksForConumRestoration();
      makePlaceholdersEditable();
      Prism && Prism.highlightAll();
      processEditableSpans();
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
        addEditableSpan(REGEX_EDITABLE_SPAN, codeElement);
      }
    });
  }

  if (!RegExp.escape) {
    RegExp.escape = function(s) {
      return s.replace(REGEX_ESCAPE, '\\$&');
    };
  }

  function unnestPlaceholders() {
    const editables = document.querySelectorAll('[contenteditable="true"]');
    editables.forEach(editable => {
      if (editable.parentElement?.getAttribute('contenteditable') === 'true') {
        editable.replaceWith(editable);
      }
    });
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
        const cleanedPlaceholder = placeholder.replace(REGEX_HTML_TAG, '').replace(REGEX_LT_GT, '');
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

    element.innerHTML = element.innerHTML.replace(REGEX_PREPROCESS_PUNCTUATION, (match, openParen, closeParen) => {
      return openParen || closeParen || match;
    });
  }

  function addConumSpans(element) {
    if (!element || !element.textContent) {
      return;
    }

    element.innerHTML = element.innerHTML.replace(REGEX_CONUM_SPAN, (match, p1, p2, p3, p4) => {
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
    const cursor = this.nextElementSibling;
    if (cursor?.classList.contains('cursor')) {
      cursor.style.display = 'inline';
    }

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
    const cursor = this.nextElementSibling;
    if (cursor?.classList.contains('cursor')) {
      cursor.style.display = 'none';
    }

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
