;(function () {
  'use strict'

  // Regular expressions used for processing console snippets
  var CMD_RX = /^\$ (\S[^\\\n]*(\\\n(?!\$ )[^\\\n]*)*)(?=\n|$)/gm
  var LINE_CONTINUATION_RX = /( ) *\\\n *|\\\n( ?) */g
  var TRAILING_SPACE_RX = / +$/gm

  // Pull UI configuration from Antora's <script> tag if needed
  var config = (document.getElementById('site-script') || { dataset: {} }).dataset
  var uiRootPath = config.uiRootPath == null ? '.' : config.uiRootPath
  var svgAs = config.svgAs

  // Check if current browser supports copy operations
  var supportsCopy = window.navigator.clipboard

  // Skip if we're within swagger/rapidoc blocks to avoid double copy buttons
  if (document.querySelectorAll('.body.swagger').length > 0) return

  // Ensure each <pre> with a <code> child is styled appropriately
  document.querySelectorAll('pre').forEach(function (pre) {
    if (pre.firstElementChild && pre.firstElementChild.tagName.toLowerCase() === 'code') {
      pre.classList.add('code-first-child')
    }
  })

  // Process highlight blocks and literal blocks that contain code
  ;[].slice.call(document.querySelectorAll('.doc pre.highlight, .doc .literalblock pre')).forEach(function (pre) {
    var code, language, lang, copy, toast, toolbox

    // ------------------------------------------------------------
    // 1. Normalize code blocks so we always have <pre> > <code>
    // ------------------------------------------------------------
    // If this <pre> has "highlight" class, there's likely a <code> inside
    if (pre.classList.contains('highlight')) {
      code = pre.querySelector('code')
      if ((language = code.dataset.lang) && language !== 'console') {
        // Display the language name in the toolbox
        ;(lang = document.createElement('span')).className = 'source-lang'
        lang.appendChild(document.createTextNode(language))
      }
    } else if (pre.innerText.startsWith('$ ')) {
      var block = pre.parentNode.parentNode
      block.classList.remove('literalblock')
      block.classList.add('listingblock')
      pre.classList.add('highlightjs', 'highlight')
      ;(code = document.createElement('code')).className = 'language-console hljs'
      code.dataset.lang = 'console'
      code.appendChild(pre.firstChild)
      pre.appendChild(code)
    } else {
      return
    }

    // Create a div to hold the copy/run buttons (the toolbox)
    ;(toolbox = document.createElement('div')).className = 'source-toolbox'
    if (lang) toolbox.appendChild(lang)

    // ----------------------------------------------
    // 2. Create a "Copy" button (if not suppressed)
    // ----------------------------------------------
    if (supportsCopy && !pre.parentNode.parentNode.classList.contains('no-copy')) {
      ;(copy = document.createElement('button')).className = 'copy-button'
      copy.setAttribute('title', 'Copy to clipboard')

      if (svgAs === 'svg') {
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svg.setAttribute('class', 'copy-icon')
        var use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
        use.setAttribute('href', uiRootPath + '/img/octicons-16.svg#icon-clippy')
        svg.appendChild(use)
        copy.appendChild(svg)
      } else {
        var img = document.createElement('img')
        img.src = uiRootPath + '/img/octicons-16.svg#view-clippy'
        img.alt = 'copy icon'
        img.className = 'copy-icon'
        copy.appendChild(img)
      }

      toast = document.createElement('span')
      toast.className = 'copy-toast'
      toast.appendChild(document.createTextNode('Copied!'))
      copy.appendChild(toast)

      // Insert the copy button into the toolbox
      toolbox.appendChild(copy)

      copy.addEventListener('click', writeToClipboard.bind(copy, code))
    }

    // -----------------------------------------------------------------
    // 3. Create a "Run" button only for coffeescript code blocks.
    //    (Temporary requirement until we introduce a Bloblang code type.)
    // -----------------------------------------------------------------
    if (code && code.dataset.lang === 'coffeescript') {
      var run = document.createElement('button')
      run.className = 'run-button'
      run.setAttribute('title', 'Run this Bloblang mapping in a new tab')
      run.innerText = 'Run'
      toolbox.prepend(run)

      run.addEventListener('click', function () {
        var rawText = code.innerText.replace(TRAILING_SPACE_RX, '')
        // Parse the snippet into mapping, input, and meta sections (if present).
        var parsed = parseBloblangSnippet(rawText)
        // When empty, default to {}
        const finalInput = parsed.input.trim() ? parsed.input : '{}'
        const finalMeta = parsed.meta.trim() ? parsed.meta : '{}'
        const finalMapping = parsed.mapping.trim() ? parsed.mapping : '{}'
        var encodedMap = encodeBase64(finalMapping)
        var encodedIn = encodeBase64(finalInput)
        var encodedMeta = encodeBase64(finalMeta)

        // Build the URL with query params for the snippet sections
        // You can also wrap each in encodeURIComponent(...) if your environment needs extra safety.
        var runUrl = '/redpanda-connect/guides/bloblang/playground/?map=' + encodedMap +
                    '&input=' + encodedIn +
                    '&meta=' + encodedMeta
        window.open(runUrl, '_blank')
      })
    }

    pre.parentNode.appendChild(toolbox)
  })

  // This helper function extracts commands from console-style code
  // by removing `$ ` prefixes and line continuations.
  function extractCommands (text) {
    var cmds = []
    var m
    while ((m = CMD_RX.exec(text))) {
      cmds.push(m[1].replace(LINE_CONTINUATION_RX, '$1$2'))
    }
    // Combine with && to treat multi-line console as a single chain
    return cmds.join(' && ')
  }

  // Handles copying the code content to clipboard
  function writeToClipboard (code) {
    var text = code.innerText.replace(TRAILING_SPACE_RX, '')
    if (code.dataset.lang === 'console' && text.startsWith('$ ')) {
      text = extractCommands(text)
    }
    window.navigator.clipboard.writeText(text).then(
      function () {
        // Trigger a brief 'Copied!' animation by toggling a CSS class
        this.classList.add('clicked')
        // Force reflow so the animation can restart properly
        this.offsetHeight // eslint-disable-line no-unused-expressions
        this.classList.remove('clicked')
      }.bind(this),
      function () {}
    )
  }

  /**
   * parseBloblangSnippet
   *
   * Splits a code snippet into:
   * - mapping: everything until first # In: or # Meta:
   * - input: Everything between # In: and next directive
   * - meta: Everything between # Meta: and next directive
   * - # Out: lines are ignored
   */
  function parseBloblangSnippet (rawSnippet) {
    const mappingLines = []
    const inputLines = []
    const metaLines = []

    let inSeen = false
    let metaSeen = false
    let ignoreAll = false

    // Start in the mapping section
    let currentSection = 'mapping'

    // Split snippet into lines
    const lines = rawSnippet.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()

      if (ignoreAll) {
        continue
      }

      // If line starts with # Out:, ignore it completely
      if (trimmed.startsWith('# Out:')) {
        continue
      }

      if (trimmed.startsWith('# In:')) {
        if (!inSeen) {
          inSeen = true
          currentSection = 'in'
          const afterIn = trimmed.slice('# In:'.length).trim()
          if (afterIn) {
            inputLines.push(afterIn)
          }
        } else {
          ignoreAll = true
        }
        continue
      }

      // Check for # Meta:
      if (trimmed.startsWith('# Meta:')) {
        if (!metaSeen) {
          metaSeen = true
          currentSection = 'meta'
          const afterMeta = trimmed.slice('# Meta:'.length).trim()
          if (afterMeta) {
            metaLines.push(afterMeta)
          }
        } else {
          ignoreAll = true
        }
        continue
      }

      switch (currentSection) {
        case 'mapping':
          mappingLines.push(line)
          break
        case 'in':
          inputLines.push(line)
          break
        case 'meta':
          metaLines.push(line)
          break
      }
    }

    const mapping = mappingLines.join('\n')
    const input = inputLines.join('\n')
    const meta = metaLines.join('\n')

    return {
      mapping,
      input,
      meta,
    }
  }
  function encodeBase64 (str) {
    // Convert string -> UTF-8 bytes
    const utf8Bytes = new TextEncoder().encode(str)
    // Convert bytes -> binary string
    let binaryStr = ''
    for (let i = 0; i < utf8Bytes.length; i++) {
      binaryStr += String.fromCharCode(utf8Bytes[i])
    }
    return window.btoa(binaryStr)
  }
})()
