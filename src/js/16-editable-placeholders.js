/* eslint-disable */

(function () {
  'use strict'

  window.addEventListener('load', function () {
    try {
      makePlaceholdersEditable()
      // Rehighlight code block lines.
      if (Prism) {
        Prism.highlightAll();
      }
      // Remove any Prism markup injected inside editable spans.
      const editableSpans = document.querySelectorAll('[contenteditable="true"].editable');
      editableSpans.forEach(span => removeNestedSpans(span));
      // Add pencil icons next to editable placeholders
      addPencilSpans();
    } catch (error) {
      console.error('An error occurred while making placeholders editable:', error)
    }
  })

  function makePlaceholdersEditable(element) {
    createEditablePlaceholders(element);
    unnestPlaceholders()
    addClasses(element)
    addEvents(element)
  }

  function addPencilSpans() {
    const editableSpans = document.querySelectorAll('[contenteditable="true"].editable');
    editableSpans.forEach(span => {
      const pencilSpan = document.createElement('span');
      pencilSpan.className = 'fa fa-pencil cursor';
      pencilSpan.setAttribute('aria-hidden', 'true');
      span.insertAdjacentElement('afterend', pencilSpan);
    });
  }

  function createEditablePlaceholders(parentElement) {
    const baseElement = parentElement || document;
    const codeElements = baseElement.querySelectorAll("pre > code");
    for (let i = 0; i < codeElements.length; i++) {
      const codeElement = codeElements[i];
      const preElement = codeElement.parentElement;
      const contentDivElement = preElement.parentElement;
      const listingBlockElement = contentDivElement.parentElement;
      // Check if the grandparent has the class 'no-placeholders'
      if (listingBlockElement.classList.contains('no-placeholders')) {
        continue;
      }
      // Tries to stop Prism from removing our HTML markup such as conum spans or editable spans. It doesn't always work, so we do removeNestedSpans to remove any Prism markup injected inside our editable spans.
      // https://prismjs.com/plugins/keep-markup/
      codeElement.classList.add('keep-markup')
      preprocessParentheses(codeElement)
      addConumSpans(codeElement);
      if(codeElement.dataset.lang !== 'xml' && codeElement.dataset.lang !== 'html' && codeElement.dataset.lang !== 'rust' && codeElement.dataset.lang !== 'coffeescript' && codeElement.dataset.lang !== 'text') {
        addEditableSpan(/&lt;.[^&A-Z]+&gt;/g, codeElement);
      }
    }
  }
  if (!RegExp.escape) {
    RegExp.escape = function(s) {
      return s.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
    };
  }
  function unnestPlaceholders() {
    const editables = document.querySelectorAll('[contenteditable="true"]');
    editables.forEach(editable => {
      if (editable.parentElement && editable.parentElement.getAttribute('contenteditable') === 'true') {
        editable.parentElement.replaceWith(editable);
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
    const sortedPlaceholders = placeholders.sort((a, b) => b.length - a.length);
    for (const placeholder of sortedPlaceholders) {
      const cleanedPlaceholder = placeholder.replace(/<[^>]*>/g, '').replace(/&lt;|&gt;/g, '');
      if (processed.has(placeholder) || cleanedPlaceholder === 'none') {
        continue;
      }
      const regexString = RegExp.escape(placeholder);
      const globalRegex = new RegExp(regexString, 'g');
      newHTML = newHTML.replace(globalRegex, `<span contenteditable="true" data-type="${cleanedPlaceholder}" aria-label="Edit ${cleanedPlaceholder}" title="Edit ${cleanedPlaceholder}" role="textbox" aria-multiline="false">&lt;${cleanedPlaceholder}&gt;</span>`);
      processed.add(placeholder);
    }
    element.innerHTML = newHTML;
  }
  function preprocessParentheses(element) {
    if (!element || !element.textContent) {
        return;
    }
    // This pattern matches parentheses that are wrapped in `span` tags.
    let pattern = /<span class="token punctuation">(\()<\/span>|<span class="token punctuation">(\))<\/span>/g;
  
    let codeContent = element.innerHTML;
    // Replace the matched patterns by removing the span tags and leaving the parentheses.
    let processedContent = codeContent.replace(pattern, function(match, openParen, closeParen) {
      if (openParen) {
        return openParen;
      }
      if (closeParen) {
        return closeParen;
      }
      return match;
    });
    element.innerHTML = processedContent;
  }
  function addConumSpans(element) {
      if (!element || !element.textContent) {
          return;
      }
      let codeContent = element.innerHTML;
      let pattern = /(\s\(<span class="token number">(\d+)<\/span>\)|\((\d+)\))\s*$/gm;
      let replaced = codeContent.replace(pattern, function(match, p1, p2, p3) {
          // Determine which group captured the digit, and use it for the data-value.
          let digit = p2 || p3;
          return `<i class="conum" data-value="${digit}"></i>`;
      });
      element.innerHTML = replaced;
  }

  function addClasses(parentElement) {
    const baseElement = parentElement || document;
    const editablePlaceholders = baseElement.querySelectorAll('[contenteditable="true"]');

    editablePlaceholders.forEach((placeholder) => {
      placeholder.classList.add('editable');
    });
  }

  function addEvents(parentElement) {
    const baseElement = parentElement || document;
    const editablePlaceholders = baseElement.querySelectorAll('[contenteditable="true"]');
    editablePlaceholders.forEach((placeholder) => {
      placeholder.addEventListener('input', function(event) {
        const dataType = event.target.dataset.type;
        const newText = event.target.textContent;

        document.querySelectorAll(`[data-type="${dataType}"][contenteditable="true"]`).forEach(span => {
          // Check if the span is within a hidden tab
          let hasHiddenAncestor = false
          let ancestor = span.parentElement
          while (ancestor) {
              if (ancestor.classList.contains('tabpanel') && ancestor.classList.contains('is-hidden')) {
                  hasHiddenAncestor = true
                  break
              }
              ancestor = ancestor.parentElement
          }
          // Update the text if the span isn't within a hidden tab
          if (!hasHiddenAncestor && span !== event.target) {
              span.textContent = newText
          }
        });
      });
      // Handle the Enter key
      placeholder.addEventListener('keydown', function(event) {
        if (event.key === 'Enter') {
          // Prevent the default Enter key behavior (newline)
          event.preventDefault()
          // Exit the editable mode and move the focus out
          event.target.blur()
        }
      });
      placeholder.addEventListener('blur', function() {
        const cursor = this.nextElementSibling
        if (cursor && cursor.classList.contains('cursor')) {
          cursor.style.display = 'inline'
        }
        const currentText = this.textContent.trim()
        const dataType = this.getAttribute('data-type')
        // Reset to default if empty and propagate the reset
        if (!currentText) {
          const defaultText = `<${dataType}>`
          this.textContent = defaultText
          // Update all placeholders of the same data-type with the default text
          document.querySelectorAll(`[data-type="${dataType}"][contenteditable="true"]`).forEach(span => {
            span.textContent = defaultText
          })
        } else {
          sessionStorage.setItem(dataType, currentText)
        }
      })
      placeholder.addEventListener('focus', function() {
      const cursor = this.nextElementSibling;
        if (cursor && cursor.classList.contains('cursor')) {
          cursor.style.display = 'none';
        }
        // Select all text inside the placeholder when it receives focus
        const range = document.createRange();
        const selection = window.getSelection();
        range.selectNodeContents(this);
        selection.removeAllRanges();
        selection.addRange(range);
      });
      const dataType = placeholder.getAttribute('data-type')
      if (!dataType) {
        console.error('Data type attribute is missing on the placeholder.')
        return
      }
      const savedText = sessionStorage.getItem(dataType);
      placeholder.textContent = savedText ? savedText : `<${dataType}>`;
    })
  }
  function removeNestedSpans(editableElement) {
    if (!editableElement || !editableElement.hasAttribute('contenteditable')) {
      console.error('The provided element is not a valid contenteditable element.');
      return;
    }

    // Extract the text content from the nested spans
    let textContent = '';
    editableElement.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) {
        textContent += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'SPAN') {
        textContent += node.textContent;
      }
    });

    // Remove all child nodes
    while (editableElement.firstChild) {
      editableElement.removeChild(editableElement.firstChild);
    }

    // Set the text content to the outer span
    editableElement.textContent = textContent.trim();
  }
})()