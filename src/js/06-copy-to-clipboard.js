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

  // Ensure each <pre> with a <code> child is styled appropriately
  document.querySelectorAll('pre').forEach(function (pre) {
    if (pre.firstElementChild && pre.firstElementChild.tagName.toLowerCase() === 'code') {
      pre.classList.add('code-first-child')
    }
  })

  // Process highlight blocks and literal blocks that contain code
  ;[].slice.call(document.querySelectorAll('.doc pre.highlight, .doc .literalblock pre')).forEach(function (pre) {
    var code, language, lang, copy, toast, askAI, toolbox

    // Normalize code blocks so we always have <pre> > <code>
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

    // Create a "Copy" button (if not suppressed)
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
    // Create an "Ask AI" button (if Kapa is available)
    if (window.Kapa && !pre.parentNode.parentNode.classList.contains('no-copy')) {
      ;(askAI = document.createElement('button')).className = 'ask-ai-button'
      askAI.setAttribute('title', 'Ask AI about this code')

      // Create sparkles SVG icon
      var sparklesSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      sparklesSvg.setAttribute('width', '16')
      sparklesSvg.setAttribute('height', '16')
      sparklesSvg.setAttribute('viewBox', '0 0 16 16')
      sparklesSvg.setAttribute('fill', 'none')
      sparklesSvg.setAttribute('class', 'ask-ai-icon')

      var sparklesPath = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      sparklesPath.setAttribute('fill-rule', 'evenodd')
      sparklesPath.setAttribute('clip-rule', 'evenodd')
      sparklesPath.setAttribute('d', 'M1.01942 4.14696C0.821273 4.07417 0.615365 4.0169 0.403168 3.97662C0.387588 3.97367 0.371975 3.9708 0.356327 3.96802C0.214558 3.94289 0.214558 3.74081 0.356327 3.71568C0.371975 3.7129 0.387588 3.71003 0.403168 3.70709C0.615365 3.6668 0.821273 3.60953 1.01942 3.53675C1.138 3.49318 1.2538 3.44407 1.36651 3.38969C2.14702 3.01321 2.77911 2.38509 3.158 1.60949C3.2127 1.49749 3.26214 1.38242 3.30596 1.26458C3.37921 1.06768 3.43684 0.863067 3.47738 0.652204C3.48035 0.636723 3.48323 0.621208 3.48603 0.605658C3.51132 0.464781 3.71467 0.464781 3.73997 0.605658C3.74277 0.621208 3.74565 0.636723 3.74861 0.652204C3.78916 0.863067 3.84678 1.06768 3.92003 1.26458C3.96387 1.38242 4.01329 1.49749 4.06802 1.60949C4.44688 2.38509 5.07898 3.01321 5.8595 3.38969C5.9722 3.44407 6.088 3.49318 6.20657 3.53675C6.40473 3.60953 6.61063 3.6668 6.82284 3.70709C6.83842 3.71003 6.85402 3.7129 6.86967 3.71568C7.01144 3.74081 7.01144 3.94289 6.86967 3.96802C6.85402 3.9708 6.83842 3.97367 6.82284 3.97662C6.61063 4.0169 6.40473 4.07417 6.20657 4.14696C6.088 4.19052 5.9722 4.23963 5.8595 4.29401C5.07898 4.67049 4.44688 5.29861 4.06802 6.07422C4.01329 6.18622 3.96387 6.30129 3.92003 6.41912C3.84678 6.61602 3.78916 6.82063 3.74861 7.03151C3.74565 7.04697 3.74277 7.06249 3.73997 7.07804C3.71467 7.21893 3.51132 7.21893 3.48603 7.07804C3.48323 7.06249 3.48035 7.04697 3.47738 7.03151C3.43684 6.82063 3.37921 6.61602 3.30596 6.41912C3.26214 6.30129 3.2127 6.18622 3.158 6.07422C2.77911 5.29861 2.14702 4.67049 1.36651 4.29401C1.2538 4.23963 1.138 4.19052 1.01942 4.14696ZM5.75667 9.15294C5.61809 9.11583 5.47758 9.08326 5.3353 9.05541C5.31306 9.05107 5.29079 9.04684 5.26848 9.04271L5.26172 9.04146L5.25257 9.0398C5.23849 9.03725 5.22303 9.03451 5.19212 9.02901L5.18132 9.0271C4.9546 8.98447 4.9546 8.66184 5.18132 8.61921L5.19212 8.6173C5.22303 8.6118 5.23849 8.60906 5.25257 8.60651L5.26172 8.60485L5.26848 8.60361C5.29079 8.59947 5.31306 8.59524 5.33528 8.5909C5.47756 8.56305 5.61809 8.53048 5.75667 8.49337C5.87504 8.46168 5.992 8.42664 6.10746 8.38841C7.9755 7.76963 9.44545 6.30893 10.0681 4.45264C10.1066 4.33791 10.1419 4.22168 10.1738 4.10403C10.2111 3.96634 10.2439 3.8267 10.2719 3.68531C10.2763 3.66323 10.2805 3.6411 10.2847 3.61894L10.286 3.61221L10.2876 3.60312C10.2902 3.5893 10.2929 3.57413 10.2983 3.54409L10.2985 3.54306L10.3004 3.53232C10.3433 3.30702 10.668 3.30702 10.7109 3.53232L10.7128 3.54306C10.7183 3.57377 10.7211 3.58913 10.7237 3.60312L10.7253 3.61221L10.7266 3.61894C10.7307 3.6411 10.735 3.66323 10.7394 3.68531C10.7674 3.82672 10.8002 3.96634 10.8375 4.10403C10.8694 4.22168 10.9047 4.33791 10.9431 4.45264C11.5658 6.30893 13.0358 7.76963 14.9038 8.38841C15.0193 8.42664 15.1362 8.46168 15.2546 8.49337C15.3932 8.53048 15.5337 8.56305 15.676 8.5909C15.6982 8.59524 15.7205 8.59947 15.7428 8.60361L15.7496 8.60485L15.7587 8.60651C15.7728 8.60906 15.7882 8.6118 15.8192 8.6173L15.83 8.61921C16.0567 8.66184 16.0567 8.98447 15.83 9.0271L15.8192 9.02901L15.7864 9.03482L15.7587 9.0398L15.7496 9.04146L15.7428 9.04271C15.7205 9.04684 15.6982 9.05107 15.676 9.05541C15.5337 9.08326 15.3932 9.11583 15.2546 9.15294C15.1362 9.18463 15.0193 9.21967 14.9038 9.2579C13.0358 9.87668 11.5658 11.3374 10.9431 13.1937C10.9047 13.3084 10.8694 13.4246 10.8375 13.5423C10.8002 13.68 10.7674 13.8196 10.7394 13.961C10.735 13.9831 10.7307 14.0052 10.7266 14.0274L10.7253 14.0341L10.7237 14.0432L10.7199 14.0637L10.713 14.1021L10.7109 14.114C10.668 14.3393 10.3433 14.3393 10.3004 14.114L10.2985 14.1033C10.293 14.0726 10.2902 14.0572 10.2876 14.0432L10.286 14.0341L10.2847 14.0274C10.2805 14.0052 10.2763 13.9831 10.2719 13.961C10.2439 13.8196 10.2111 13.68 10.1738 13.5423C10.1419 13.4246 10.1066 13.3084 10.0681 13.1937C9.44545 11.3374 7.9755 9.87668 6.10746 9.2579C5.992 9.21967 5.87504 9.18463 5.75667 9.15294ZM2.63009 13.4745C2.86838 13.5197 3.09411 13.5989 3.30206 13.7067C3.39456 13.7547 3.48354 13.8084 3.56853 13.8673C3.80536 14.0313 4.01129 14.236 4.17642 14.4713C4.23567 14.5558 4.28969 14.6442 4.33796 14.7361C4.44653 14.9428 4.52617 15.1671 4.57168 15.4039C4.57356 15.4137 4.5754 15.4234 4.57715 15.4333C4.59313 15.5222 4.72156 15.5222 4.73754 15.4333C4.7393 15.4234 4.74111 15.4137 4.74299 15.4039C4.78853 15.1671 4.86817 14.9428 4.97672 14.7361C5.02501 14.6442 5.07902 14.5558 5.13828 14.4713C5.30339 14.236 5.50933 14.0313 5.74616 13.8673C5.83115 13.8084 5.92013 13.7547 6.01262 13.7067C6.22059 13.5989 6.44631 13.5197 6.68461 13.4745C6.69445 13.4726 6.7043 13.4708 6.71418 13.469C6.80373 13.4532 6.80373 13.3255 6.71418 13.3097C6.7043 13.3079 6.69445 13.3061 6.68461 13.3042C6.44631 13.259 6.22059 13.1798 6.01262 13.072C5.92013 13.024 5.83115 12.9703 5.74616 12.9114C5.50933 12.7474 5.30339 12.5427 5.13828 12.3074C5.07902 12.2229 5.02501 12.1345 4.97672 12.0426C4.86817 11.836 4.78853 11.6116 4.74299 11.3748C4.74111 11.3651 4.7393 11.3553 4.73754 11.3454C4.72156 11.2565 4.59313 11.2565 4.57715 11.3454C4.5754 11.3553 4.57356 11.3651 4.57168 11.3748C4.52617 11.6116 4.44653 11.836 4.33796 12.0426C4.28969 12.1345 4.23567 12.2229 4.17642 12.3074C4.01129 12.5427 3.80536 12.7474 3.56853 12.9114C3.48354 12.9703 3.39456 13.024 3.30206 13.072C3.09411 13.1798 2.86838 13.259 2.63009 13.3042C2.62025 13.3061 2.61039 13.3079 2.60049 13.3097C2.51097 13.3255 2.51097 13.4532 2.60049 13.469C2.61039 13.4708 2.62025 13.4726 2.63009 13.4745Z')
      sparklesPath.setAttribute('fill', 'currentColor')

      sparklesSvg.appendChild(sparklesPath)
      askAI.appendChild(sparklesSvg)

      // Insert the Ask AI button into the toolbox
      toolbox.appendChild(askAI)

      askAI.addEventListener('click', handleAskAI.bind(askAI, code))
    }

    // Create a "Run" button only for coffeescript code blocks.
    //    (Temporary requirement until we introduce a Bloblang code type.)
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

  // Handles opening Kapa AI with the code snippet
  function handleAskAI (code) {
    var text = code.innerText.replace(TRAILING_SPACE_RX, '')
    if (code.dataset.lang === 'console' && text.startsWith('$ ')) {
      text = extractCommands(text)
    }

    var kapa = window.Kapa
    if (kapa) {
      // Create the prompt with the code snippet
      var aiPromptText = 'Explain this code snippet:\n\n```\n' + text + '\n```'

      kapa.open({
        mode: 'ai',
        query: aiPromptText,
        submit: true,
      })
    } else {
      console.warn('Kapa AI is not available.')
    }
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
