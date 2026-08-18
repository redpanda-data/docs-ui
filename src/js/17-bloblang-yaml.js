/* eslint-disable */
/**
 * Bloblang in YAML - Syntax Highlighting and Hover Documentation
 *
 * Post-processes YAML code blocks to detect and highlight Bloblang code
 * embedded in Redpanda Connect pipeline configurations.
 *
 * Works by:
 * 1. Detecting Connect-specific YAML keys (mapping, check, etc.)
 * 2. Re-tokenizing Bloblang content with the Bloblang grammar
 * 3. Replacing DOM nodes with highlighted versions
 * 4. Attaching hover documentation tooltips
 */

;(function() {
  'use strict'

  // YAML keys that contain full Bloblang mappings (multi-line)
  var BLOBLANG_MAPPING_KEYS = [
    'mapping',
    'mutation',
    'request_map',
    'result_map',
    'fields_mapping',
    'bloblang',
    // Hyphenated variants
    'request-map',
    'result-map',
    'fields-mapping',
  ]

  // YAML keys that contain Bloblang boolean expressions (single-line)
  var BLOBLANG_CHECK_KEYS = [
    'check',
    'skip_on',
    'skip-on', // Hyphenated variant
  ]

  // Pattern for Bloblang interpolation functions: ${! ... }
  var INTERPOLATION_PATTERN = /\$\{!\s*([^}]+)\s*\}/g

  // Connect-specific patterns to detect if YAML is a Connect config
  // Accept both underscore and hyphenated variants (e.g., request_map and request-map)
  var CONNECT_INDICATORS = [
    /\bmapping\s*:/,
    /\bprocessors\s*:/,
    /\brequest[-_]map\s*:/,
    /\bresult[-_]map\s*:/,
    /\bcheck\s*:/,
    /\binput\s*:/,
    /\boutput\s*:/,
    /\bpipeline\s*:/,
    /\bskip[-_]on\s*:/,
    /\$\{!\s*/,
  ]

  /**
   * Check if YAML text contains Connect pipeline patterns
   */
  function hasConnectPatterns(text) {
    return CONNECT_INDICATORS.some(function(pattern) {
      return pattern.test(text)
    })
  }

  /**
   * Check if a string likely contains Bloblang code
   */
  function isLikelyBloblang(str) {
    if (!str || str.length < 3) return false

    var bloblangPatterns = [
      /\broot\s*[.=]/, // root assignment or access
      /\bthis\s*\./, // this context access
      /=>/, // lambda arrow
      /@[\w(]/, // metadata access
      /\$\w+/, // variable reference
      /\.(map_each|filter|fold|flatten|catch|or)\s*\(/, // common methods
      /\b(if|match|let)\s+/, // control flow keywords
      /\|\s*$/m, // pipe operator at end of line
      /\.parse_json\s*\(/, // common parsing methods
      /\.format_json\s*\(/,
      /\buuid_v4\s*\(/, // common functions
      /\bnow\s*\(/,
      /\bjson\s*\(/,
      /\bcontent\s*\(/,
    ]

    return bloblangPatterns.some(function(pattern) {
      return pattern.test(str)
    })
  }

  /**
   * Find the YAML key that precedes a token by walking backwards through siblings
   */
  function findPrecedingKey(token) {
    var node = token.previousSibling
    var textAccum = ''
    var maxSteps = 20
    var steps = 0

    while (node && steps < maxSteps) {
      if (node.nodeType === Node.TEXT_NODE) {
        textAccum = node.textContent + textAccum
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        textAccum = node.textContent + textAccum
      }

      // Check for key pattern (supports hyphenated keys like request-map)
      var keyMatch = textAccum.match(/([\w-]+)\s*:\s*[\|>]?\s*$/)
      if (keyMatch) {
        return keyMatch[1]
      }

      node = node.previousSibling
      steps++
    }

    return null
  }

  /**
   * Extract Bloblang code from a YAML scalar token's text.
   *
   * Returns { leading, code }:
   * - leading: the whitespace trim() strips from the front of the token.
   *   For block scalars this is the newline + indentation that separates
   *   the | or > indicator from the first content line (the token can also
   *   begin with spaces or tabs, because the [ \t]* after the indicator is
   *   part of the scalar token in Prism's YAML grammar). It must be
   *   restored when the token is re-rendered, or "mapping: |" collapses
   *   onto the same line as the first Bloblang statement (DOC-2433).
   * - code: the Bloblang source to tokenize.
   *
   * Block scalars (mapping: | ...) are literal source text: YAML performs
   * no quote or escape processing on them, so neither does this function -
   * rewriting \n inside them, or stripping a coincidental leading/trailing
   * quote pair, corrupts the rendered and copied code (DOC-2441).
   *
   * Quoted flow scalars (mapping: "root = ...") are unwrapped and
   * unescaped according to their quote style: double quotes process
   * backslash escapes, single quotes only the '' escape. The stripped
   * quote character is returned so the caller can re-render it - the
   * quotes are part of the YAML source the reader sees and copies.
   */
  function extractBloblangFromBlock(tokenText, isBlockScalar) {
    var leading = tokenText.slice(0, tokenText.length - tokenText.trimStart().length)
    var text = tokenText.trim()
    var quote = null

    if (!isBlockScalar) {
      var q = text.charAt(0)
      if ((q === '"' || q === "'") && text.length >= 2 && text.endsWith(q)) {
        quote = q
        text = text.slice(1, -1)
        if (q === '"') {
          // Single pass so an escaped backslash can't feed a later rule
          // (the old sequential replace chain turned \\n into \<newline>).
          // Escapes this display code doesn't translate stay verbatim
          // rather than losing their backslash (\r must not become r).
          text = text.replace(/\\(.)/g, function (match, ch) {
            if (ch === 'n') return '\n'
            if (ch === 't') return '\t'
            if (ch === '"' || ch === "'" || ch === '\\' || ch === '/') return ch
            return match
          })
        } else {
          text = text.replace(/''/g, "'")
        }
      }
    }

    return { leading: leading, code: text, quote: quote }
  }

  /**
   * Tokenize Bloblang code and return HTML string
   */
  function tokenizeBloblang(code) {
    if (!window.Prism || !Prism.languages.bloblang) {
      return escapeHtml(code)
    }

    var tokens = Prism.tokenize(code, Prism.languages.bloblang)
    return Prism.Token.stringify(Prism.util.encode(tokens), 'bloblang')
  }

  /**
   * Escape HTML special characters
   */
  function escapeHtml(text) {
    var div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  /**
   * Check if a node indicates the end of a YAML literal block
   * (a new YAML key or list item at the same or lower indent level)
   */
  function isEndOfLiteralBlock(node, baseIndent) {
    if (!node) return true

    // Text node: check if it ends with a newline and indent that's lower/equal to baseIndent
    // This handles cases where the next token will be at a lower indent
    if (node.nodeType === Node.TEXT_NODE) {
      var text = node.textContent

      // Check for text node that's just whitespace ending with lower indent
      // Pattern: newlines followed by spaces, where the last line's indent is <= baseIndent
      var lines = text.split('\n')
      if (lines.length > 1) {
        var lastLine = lines[lines.length - 1]
        // If last line is just spaces (waiting for next token), check indent
        if (/^\s*$/.test(lastLine)) {
          var lastIndent = lastLine.length
          // If this indent is lower than base, block has ended
          if (lastIndent < baseIndent) {
            return true
          }
        }
      }

      // Also check for inline content that starts at lower indent
      var match = text.match(/\n( *)\S/)
      if (match) {
        var indent = match[1].length
        if (indent < baseIndent) {
          return true
        }
      }
    }

    // Element node that is a YAML punctuation "-" (list item marker) at lower indent
    if (
      node.nodeType === Node.ELEMENT_NODE &&
      node.classList.contains('token') &&
      node.classList.contains('punctuation') &&
      node.textContent === '-'
    ) {
      // Check previous text node for indent
      var prev = node.previousSibling
      if (prev && prev.nodeType === Node.TEXT_NODE) {
        var indentMatch = prev.textContent.match(/\n( *)$/)
        if (indentMatch && indentMatch[1].length < baseIndent) {
          return true
        }
      }
    }

    // Element node that is a YAML key at lower indent
    if (
      node.nodeType === Node.ELEMENT_NODE &&
      node.classList.contains('token') &&
      (node.classList.contains('key') || node.classList.contains('atrule'))
    ) {
      // Check previous text node for indent
      var prev = node.previousSibling
      if (prev && prev.nodeType === Node.TEXT_NODE) {
        var indentMatch = prev.textContent.match(/\n( *)$/)
        if (indentMatch && indentMatch[1].length < baseIndent) {
          return true
        }
      }
    }

    return false
  }

  /**
   * Get the base indentation level from a token's content or surrounding text
   * This determines where the literal block content starts
   */
  function getBaseIndent(token) {
    // First, check the token content itself for indentation of the first real line
    var content = token.textContent
    var contentMatch = content.match(/\n( +)\S/)
    if (contentMatch) {
      return contentMatch[1].length
    }

    // Fall back to checking preceding siblings
    var prev = token.previousSibling
    var attempts = 0
    while (prev && attempts < 10) {
      if (prev.nodeType === Node.TEXT_NODE) {
        var match = prev.textContent.match(/\n( +)$/)
        if (match) {
          return match[1].length
        }
        // Also check for newline within the text
        var innerMatch = prev.textContent.match(/\n( +)\S/)
        if (innerMatch) {
          return innerMatch[1].length
        }
      }
      prev = prev.previousSibling
      attempts++
    }
    return 2 // Default minimum indent for YAML block content
  }

  /**
   * Collect continuation nodes after a literal block scalar
   * When Prism splits a YAML literal block at blank lines,
   * the continuation content becomes separate siblings
   */
  function collectLiteralBlockContinuation(startToken) {
    var nodes = []
    var baseIndent = getBaseIndent(startToken)
    var node = startToken.nextSibling

    while (node && !isEndOfLiteralBlock(node, baseIndent)) {
      nodes.push(node)
      node = node.nextSibling
    }

    return nodes
  }

  /**
   * Extract text content from a list of nodes
   */
  function extractTextFromNodes(nodes) {
    return nodes
      .map(function(node) {
        return node.textContent || ''
      })
      .join('')
  }

  /**
   * Process a multi-line mapping token (like mapping: |)
   * Also handles continuation content after blank lines
   */
  function processMultilineMapping(token) {
    var rawText = token.textContent
    // Prism's YAML grammar gives block scalars the "scalar" class ("string"
    // is only an alias on them); a token with "string" alone is a quoted
    // flow scalar, whose quotes/escapes YAML actually processes.
    var isBlockScalar = token.classList.contains('scalar')
    var extracted = extractBloblangFromBlock(rawText, isBlockScalar)
    var bloblangCode = extracted.code
    var leadingWhitespace = extracted.leading

    // Check for continuation content after this token. Only block scalars
    // can have it (Prism splits them at blank lines); a quoted flow scalar
    // is single-line by grammar, and collecting "continuation" for one
    // swallows sibling keys that sit at or above the fallback base indent.
    var continuationNodes = isBlockScalar ? collectLiteralBlockContinuation(token) : []
    var continuationText = extractTextFromNodes(continuationNodes)

    // Combine the token content with continuation
    var fullCode = bloblangCode + continuationText

    if (!fullCode.trim()) return false

    // Check if the combined content looks like Bloblang
    if (!isLikelyBloblang(fullCode) && !isLikelyBloblang(bloblangCode)) {
      return false
    }

    var highlighted = tokenizeBloblang(fullCode)

    var wrapper = document.createElement('span')
    wrapper.className = 'bloblang-embedded'
    // Re-render the quotes stripped from a quoted flow scalar (same as
    // processSingleLineCheck) so the reader still sees them and the copy
    // button keeps them.
    var quoteHtml = extracted.quote ? '<span class="token punctuation">' + extracted.quote + '</span>' : ''
    // leadingWhitespace is whitespace-only (what trim() stripped), so it is
    // HTML-inert and safe to concatenate unescaped. Asymmetry note: trailing
    // whitespace on the scalar's last content line is still dropped by the
    // trim - invisible in the render, observable only via the copy button.
    wrapper.innerHTML = leadingWhitespace + quoteHtml + highlighted + quoteHtml

    token.innerHTML = ''
    token.appendChild(wrapper)

    // Remove continuation nodes (they're now inside the wrapper)
    continuationNodes.forEach(function(node) {
      if (node.parentNode) {
        node.parentNode.removeChild(node)
      }
    })

    return true
  }

  /**
   * Process a single-line check expression (like check: "this.type == 'foo'")
   */
  function processSingleLineCheck(token) {
    var text = token.textContent.trim()

    // Remove surrounding quotes
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
      var quote = text[0]
      var inner = text.slice(1, -1)
      var highlighted = tokenizeBloblang(inner)

      token.innerHTML =
        '<span class="token punctuation">' +
        quote +
        '</span>' +
        '<span class="bloblang-inline">' +
        highlighted +
        '</span>' +
        '<span class="token punctuation">' +
        quote +
        '</span>'
      return true
    }

    return false
  }

  /**
   * Process interpolation functions within a string: ${! ... }
   */
  function processInterpolation(token) {
    var text = token.textContent
    if (!INTERPOLATION_PATTERN.test(text)) return false

    // Reset regex
    INTERPOLATION_PATTERN.lastIndex = 0

    var result = ''
    var lastIndex = 0
    var match

    while ((match = INTERPOLATION_PATTERN.exec(text)) !== null) {
      // Add text before the match
      result += escapeHtml(text.slice(lastIndex, match.index))

      // Tokenize the Bloblang expression inside ${! }
      var bloblangExpr = match[1]
      var highlighted = tokenizeBloblang(bloblangExpr)

      result +=
        '<span class="bloblang-interpolation">' +
        '<span class="token punctuation">${!</span>' +
        '<span class="bloblang-inline">' +
        highlighted +
        '</span>' +
        '<span class="token punctuation">}</span>' +
        '</span>'

      lastIndex = match.index + match[0].length
    }

    // Add remaining text
    result += escapeHtml(text.slice(lastIndex))

    if (lastIndex > 0) {
      token.innerHTML = result
      return true
    }

    return false
  }

  /**
   * Process a single YAML code block
   */
  function processYamlBlock(codeElement) {
    // Early exit if not Connect config
    var fullText = codeElement.textContent
    if (!hasConnectPatterns(fullText)) {
      return
    }

    var processed = false

    // Find all potential Bloblang regions
    // In YAML, Bloblang appears in:
    // 1. Scalar values (strings) after specific keys
    // 2. Literal block scalars (|)
    // 3. Interpolation within any string

    // Strategy: Walk through text nodes and token spans
    var walker = document.createTreeWalker(codeElement, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null, false)

    var nodesToProcess = []
    var node

    while ((node = walker.nextNode())) {
      if (
        node.nodeType === Node.ELEMENT_NODE &&
        node.classList.contains('token') &&
        (node.classList.contains('string') ||
          node.classList.contains('scalar') ||
          node.classList.contains('punctuation'))
      ) {
        nodesToProcess.push(node)
      }
    }

    // Process collected nodes
    nodesToProcess.forEach(function(token) {
      // Skip already processed
      if (token.querySelector('.bloblang-embedded, .bloblang-inline')) {
        return
      }

      var text = token.textContent

      // Check for interpolation first (can appear anywhere)
      if (INTERPOLATION_PATTERN.test(text)) {
        INTERPOLATION_PATTERN.lastIndex = 0
        if (processInterpolation(token)) {
          processed = true
          return
        }
      }

      // Find preceding key
      var key = findPrecedingKey(token)

      if (key && BLOBLANG_MAPPING_KEYS.indexOf(key) !== -1) {
        // This is a mapping value - check if it looks like Bloblang
        if (isLikelyBloblang(text)) {
          if (processMultilineMapping(token)) {
            processed = true
          }
        }
      } else if (key && BLOBLANG_CHECK_KEYS.indexOf(key) !== -1) {
        // This is a check expression
        if (processSingleLineCheck(token)) {
          processed = true
        }
      } else if (isLikelyBloblang(text) && text.length > 20) {
        // Heuristic: long strings that look like Bloblang
        if (processMultilineMapping(token)) {
          processed = true
        }
      }
    })

    // Attach tooltips to newly created Bloblang tokens
    if (processed && window.addBloblangTooltips) {
      window.addBloblangTooltips(codeElement)
    }
  }

  /**
   * Initialize: Hook into Prism completion
   */
  function init() {
    if (!window.Prism) {
      return
    }

    // Process YAML blocks after Prism highlights them
    Prism.hooks.add('complete', function(env) {
      if (env.language === 'yaml' || env.language === 'yml') {
        // Use requestIdleCallback for better performance, fallback to setTimeout
        var schedule =
          window.requestIdleCallback ||
          function(cb) {
            setTimeout(cb, 10)
          }
        schedule(function() {
          processYamlBlock(env.element)
        })
      }
    })

    // Also process existing YAML blocks on page load
    document.addEventListener('DOMContentLoaded', function() {
      var yamlBlocks = document.querySelectorAll('pre > code.language-yaml, pre > code.language-yml')
      yamlBlocks.forEach(function(block) {
        var schedule =
          window.requestIdleCallback ||
          function(cb) {
            setTimeout(cb, 10)
          }
        schedule(function() {
          processYamlBlock(block)
        })
      })
    })
  }

  // Initialize when Prism is ready
  if (window.Prism) {
    init()
  } else {
    // Wait for Prism to load
    document.addEventListener('DOMContentLoaded', function() {
      if (window.Prism) {
        init()
      }
    })
  }
})()
