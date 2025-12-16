/**
 * Markdown Dropdown - Production Ready
 *
 * Handles:
 * - Dropdown open/close
 * - Copy to clipboard
 * - View markdown in new tab
 * - Keyboard navigation
 * - Click outside to close
 */

;(function () {
  'use strict'

  document.addEventListener('DOMContentLoaded', init)

  function init () {
    const dropdowns = document.querySelectorAll('.markdown-dropdown')
    if (!dropdowns.length) return

    dropdowns.forEach(initDropdown)
  }

  function initDropdown (dropdown) {
    const toggle = dropdown.querySelector('.markdown-dropdown-toggle')
    const menu = dropdown.querySelector('.markdown-dropdown-menu')
    const items = dropdown.querySelectorAll('.markdown-dropdown-item')
    const markdownUrl = dropdown.dataset.markdownUrl

    if (!toggle || !menu || !markdownUrl) {
      return
    }

    let isOpen = false

    // Toggle dropdown
    toggle.addEventListener('click', (e) => {
      e.stopPropagation()
      isOpen = !isOpen
      setOpen(isOpen)
    })

    // Handle menu item clicks
    items.forEach(function (item) {
      item.addEventListener('click', function (e) {
        e.stopPropagation()
        var action = item.dataset.action

        if (action === 'copy') {
          handleCopy(markdownUrl, item)
          // Delay closing to allow user to see "Copied!" toast
          setTimeout(function () {
            setOpen(false)
          }, 2500)
        } else if (action === 'view') {
          handleView(markdownUrl)
          setOpen(false)
        } else if (action === 'ask-ai') {
          handleAskAI()
          setOpen(false)
        } else if (action === 'add-mcp') {
          handleAddMCP()
          setOpen(false)
        }
      })
    })

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (isOpen && !dropdown.contains(e.target)) {
        setOpen(false)
      }
    })

    // Close on ESC key
    document.addEventListener('keydown', (e) => {
      if (isOpen && e.key === 'Escape') {
        setOpen(false)
        toggle.focus()
      }
    })

    // Keyboard navigation in menu
    menu.addEventListener('keydown', (e) => {
      if (!isOpen) return

      const currentIndex = Array.from(items).indexOf(document.activeElement)
      let nextIndex, prevIndex

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          nextIndex = (currentIndex + 1) % items.length
          items[nextIndex].focus()
          break
        case 'ArrowUp':
          e.preventDefault()
          prevIndex = (currentIndex - 1 + items.length) % items.length
          items[prevIndex].focus()
          break
        case 'Home':
          e.preventDefault()
          items[0].focus()
          break
        case 'End':
          e.preventDefault()
          items[items.length - 1].focus()
          break
      }
    })

    function setOpen (open) {
      isOpen = open
      toggle.setAttribute('aria-expanded', open)
      menu.classList.toggle('is-open', open)

      if (open) {
        // Focus first item when opening
        setTimeout(() => items[0]?.focus(), 10)
      }
    }
  }

  /**
   * Handle copy to clipboard - matches pattern from 06-copy-to-clipboard.js
   */
  function handleCopy (markdownUrl, button) {
    // Fetch markdown content and copy to clipboard
    window.fetch(markdownUrl)
      .then(function (response) {
        if (!response.ok) throw new Error('Failed to fetch')
        return response.text()
      })
      .then(function (markdownText) {
        return window.navigator.clipboard.writeText(markdownText)
      })
      .then(
        function () {
          // Trigger brief animation by toggling CSS class (matches existing pattern)
          button.classList.add('clicked')
          // Force reflow so animation can restart properly
          button.offsetHeight // eslint-disable-line no-unused-expressions
          button.classList.remove('clicked')
        },
        function () {} // Empty error handler (matches existing pattern)
      )
  }

  /**
   * Handle view in new tab
   */
  function handleView (markdownUrl) {
    window.open(markdownUrl, '_blank', 'noopener,noreferrer')
  }

  /**
   * Handle Ask AI about this doc
   */
  function handleAskAI () {
    var kapa = window.Kapa

    if (kapa) {
      // Get page title for context
      var pageTitle = document.querySelector('h1.page')?.textContent || 'this page'
      var aiPromptText = 'I have a question about the documentation page: ' + pageTitle

      kapa.open({
        mode: 'ai',
        query: aiPromptText,
        submit: false,
      })
    } else {
      console.warn('Kapa AI is not available.')
    }
  }

  /**
   * Handle Add MCP Server to VS Code
   */
  function handleAddMCP () {
    // MCP server configuration
    var mcpConfig = {
      name: 'Redpanda Documentation',
      url: 'https://docs.redpanda.com/mcp',
    }

    // Create VS Code MCP install URI
    var configJson = JSON.stringify(mcpConfig)
    var encodedConfig = encodeURIComponent(configJson)
    var vscodeUri = 'vscode:mcp/install?' + encodedConfig

    // Open VS Code with the MCP install URI
    window.location.href = vscodeUri
  }
})()
