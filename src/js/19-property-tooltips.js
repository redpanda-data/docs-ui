/* global uiRootPath fetch localStorage */
/**
 * Redpanda Property Tooltips
 *
 * Adds hover documentation tooltips to configuration property names.
 * Enabled by default on all pages. Disable on specific pages with:
 *   :page-disable-property-tooltips: true
 */

;(function () {
  'use strict'

  // State
  var propertiesData = null
  var propertiesLoading = false
  var propertiesLoadQueue = []

  /**
   * Check if property tooltips are disabled on this page
   */
  function isPropertyTooltipsDisabled () {
    var meta = document.querySelector('meta[name="disable-property-tooltips"]')
    return meta && meta.content === 'true'
  }

  /**
   * Get the properties JSON URL from meta tag (set by docs repo)
   */
  function getPropertiesJsonUrl () {
    var meta = document.querySelector('meta[name="properties-json-url"]')
    if (meta && meta.content) {
      return meta.content
    }
    return null
  }

  /**
   * Check if running in preview/development mode
   */
  function isPreviewMode () {
    return (
      window.location.hostname.includes('docs-ui.netlify.app') ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    )
  }

  /**
   * Fetch properties JSON with caching
   */
  function loadPropertiesData () {
    if (propertiesData) {
      return Promise.resolve(propertiesData)
    }

    if (propertiesLoading) {
      return new Promise(function (resolve) {
        propertiesLoadQueue.push(resolve)
      })
    }

    propertiesLoading = true

    // Determine the URL - prefer meta tag, fall back to static for preview
    var url = getPropertiesJsonUrl()

    if (!url) {
      if (isPreviewMode()) {
        // Use static fallback for preview/development when no meta tag
        var rootPath = typeof uiRootPath !== 'undefined' ? uiRootPath : '/_'
        url = rootPath + '/redpanda-properties.json'
      } else {
        console.warn('Property tooltips: No properties-json-url meta tag found')
        propertiesLoading = false
        return Promise.resolve(null)
      }
    }

    var CACHE_KEY = 'redpanda-properties-cache'
    var CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours
    var cacheVersion = url // Use URL as cache key since it contains version

    // Check localStorage cache (skip in preview mode for easier testing)
    if (!isPreviewMode()) {
      try {
        var cached = localStorage.getItem(CACHE_KEY)
        if (cached) {
          var parsed = JSON.parse(cached)
          if (parsed.version === cacheVersion && Date.now() - parsed.timestamp < CACHE_TTL) {
            propertiesData = parsed.data
            propertiesLoading = false
            propertiesLoadQueue.forEach(function (resolve) {
              resolve(propertiesData)
            })
            propertiesLoadQueue = []
            return Promise.resolve(propertiesData)
          }
        }
      } catch (e) {
        // Ignore cache errors
      }
    }

    return fetch(url)
      .then(function (response) {
        if (!response.ok) {
          throw new Error('HTTP ' + response.status)
        }
        return response.json()
      })
      .then(function (json) {
        propertiesData = buildPropertyLookup(json)

        // Cache the result (skip in preview mode)
        if (!isPreviewMode()) {
          try {
            localStorage.setItem(
              CACHE_KEY,
              JSON.stringify({
                version: cacheVersion,
                timestamp: Date.now(),
                data: propertiesData,
              })
            )
          } catch (e) {
            // localStorage full or unavailable
          }
        }

        propertiesLoading = false
        propertiesLoadQueue.forEach(function (resolve) {
          resolve(propertiesData)
        })
        propertiesLoadQueue = []
        return propertiesData
      })
      .catch(function (error) {
        console.warn('Property tooltips: Failed to load properties data:', error)
        propertiesLoading = false
        propertiesData = {}
        propertiesLoadQueue.forEach(function (resolve) {
          resolve(propertiesData)
        })
        propertiesLoadQueue = []
        return propertiesData
      })
  }

  /**
   * Build a lookup map from the JSON properties
   */
  function buildPropertyLookup (json) {
    var lookup = {}

    if (json.properties) {
      Object.keys(json.properties).forEach(function (name) {
        var prop = json.properties[name]
        lookup[name] = {
          name: prop.name,
          type: prop.type,
          default: prop.default,
          description: prop.description,
          configScope: prop.config_scope,
          needsRestart: prop.needs_restart,
          cloudSupported: prop.cloud_supported,
          isDeprecated: prop.is_deprecated,
          isEnterprise: prop.is_enterprise,
          visibility: prop.visibility,
          minimum: prop.minimum,
          maximum: prop.maximum,
          nullable: prop.nullable,
        }
      })
    }

    return lookup
  }

  /**
   * Create HTML content for property tooltip
   */
  function createPropertyTooltip (prop) {
    var parts = []

    // Signature line with type
    parts.push(
      '<div class="prop-tooltip-signature"><code>' +
        escapeHtml(prop.name) +
        '</code>: <code>' +
        escapeHtml(prop.type || 'unknown') +
        '</code></div>'
    )

    // Badges row
    var badges = []
    if (prop.configScope) {
      badges.push('<span class="prop-badge prop-badge-scope">' + escapeHtml(prop.configScope) + '</span>')
    }
    if (prop.needsRestart) {
      badges.push('<span class="prop-badge prop-badge-restart">restart required</span>')
    }
    if (prop.isEnterprise) {
      badges.push('<span class="prop-badge prop-badge-enterprise">enterprise</span>')
    }
    if (prop.isDeprecated) {
      badges.push('<span class="prop-badge prop-badge-deprecated">deprecated</span>')
    }
    if (prop.cloudSupported === false) {
      badges.push('<span class="prop-badge prop-badge-self-hosted">self-hosted only</span>')
    }

    if (badges.length > 0) {
      parts.push('<div class="prop-tooltip-badges">' + badges.join(' ') + '</div>')
    }

    // Description
    if (prop.description) {
      parts.push('<div class="prop-tooltip-description">' + formatDescription(prop.description) + '</div>')
    }

    // Default value
    if (prop.default !== null && prop.default !== undefined) {
      var defaultValue = typeof prop.default === 'object' ? JSON.stringify(prop.default) : String(prop.default)
      parts.push(
        '<div class="prop-tooltip-default"><strong>Default:</strong> <code>' + escapeHtml(defaultValue) + '</code></div>'
      )
    }

    // Range constraints
    if (prop.minimum !== undefined || prop.maximum !== undefined) {
      var range = []
      if (prop.minimum !== undefined) range.push('min: ' + prop.minimum)
      if (prop.maximum !== undefined) range.push('max: ' + prop.maximum)
      parts.push('<div class="prop-tooltip-range"><strong>Range:</strong> ' + range.join(', ') + '</div>')
    }

    // Link to full documentation (use current page version)
    var scope = prop.configScope || 'cluster'
    var version = getDocVersion()
    var docUrl = '/' + version + '/reference/properties/' + scope + '-properties/#' + prop.name.replace(/_/g, '-')
    parts.push('<a href="' + escapeHtml(docUrl) + '" class="prop-tooltip-link">View full documentation &rarr;</a>')

    return '<div class="property-doc-tooltip">' + parts.join('') + '</div>'
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml (text) {
    if (text === null || text === undefined) return ''
    var div = document.createElement('div')
    div.textContent = String(text)
    return div.innerHTML
  }

  /**
   * Format description - sanitize HTML while preserving safe links and code
   *
   * Handles:
   * - Pre-resolved <a> tags from JSON (safe, with href attribute)
   * - Backticks converted to <code> tags
   * - Fallback xref resolution for any unresolved xrefs
   */
  function formatDescription (text) {
    if (!text) return ''

    // Extract and preserve <a> tags (already resolved in JSON generation)
    var linkPlaceholders = []
    var withPlaceholders = text.replace(/<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/g, function (match, href, display) {
      var index = linkPlaceholders.length
      // Sanitize href to prevent javascript: URLs
      if (href.match(/^(https?:|\/)/i)) {
        linkPlaceholders.push('<a href="' + escapeHtml(href) + '">' + escapeHtml(display) + '</a>')
      } else {
        linkPlaceholders.push(escapeHtml(display))
      }
      return '___LINK_' + index + '___'
    })

    // Escape remaining HTML for security
    var escaped = escapeHtml(withPlaceholders)

    // Convert backticks to code tags
    var withCode = escaped.replace(/`([^`]+)`/g, '<code>$1</code>')

    // Fallback: resolve any remaining xrefs that weren't pre-resolved
    var withXrefs = withCode.replace(
      /xref:\.?\/?([^[]+)\.adoc(?:#([^[]*))?\[([^\]]+)\]/g,
      function (match, path, anchor, display) {
        var href = path.replace(/^\.\//, '') + '/'
        if (anchor) href += '#' + anchor
        return '<a href="' + href + '">' + display + '</a>'
      }
    )

    // Restore preserved links
    var result = withXrefs.replace(/___LINK_(\d+)___/g, function (match, index) {
      return linkPlaceholders[parseInt(index, 10)] || match
    })

    return result
  }

  /**
   * Check if device is touch-based
   */
  function isTouchDevice () {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0
  }

  /**
   * Find and process all code elements that match property names
   */
  function processCodeElements () {
    loadPropertiesData().then(function (properties) {
      if (!properties || Object.keys(properties).length === 0) {
        return
      }

      // Create a Set for fast lookup
      var propertyNames = new Set(Object.keys(properties))

      // Scope: opt-in pages look at all <code> elements in the article
      var article = document.querySelector('article.doc')
      if (!article) return

      var codeElements = article.querySelectorAll('code:not(.has-property-tooltip)')
      var isTouch = isTouchDevice()

      var getTippyConfig = function (content) {
        return {
          content: content,
          allowHTML: true,
          interactive: true,
          theme: 'bloblang-doc',
          placement: 'top',
          maxWidth: 450,
          appendTo: document.body,
          trigger: isTouch ? 'click' : 'mouseenter focus',
          hideOnClick: isTouch ? 'toggle' : true,
        }
      }

      codeElements.forEach(function (codeEl) {
        var text = codeEl.textContent.trim()

        // Check if this code element matches a property name
        if (propertyNames.has(text)) {
          var prop = properties[text]
          var tooltipContent = createPropertyTooltip(prop)

          // Mark as having tooltip (for styling and to avoid re-processing)
          codeEl.classList.add('has-property-tooltip')
          codeEl.classList.add('has-documentation')
          codeEl.style.cursor = 'help'
          codeEl.setAttribute('tabindex', '0')
          codeEl.setAttribute('role', 'button')
          codeEl.setAttribute('aria-label', text + ' property documentation')

          if (isTouch) {
            codeEl.setAttribute('aria-haspopup', 'dialog')
          }

          // Attach Tippy tooltip (same pattern as Bloblang tooltips)
          if (window.tippy) {
            window.tippy(codeEl, getTippyConfig(tooltipContent))
          }
        }
      })

      // Keyboard accessibility
      article.querySelectorAll('code.has-property-tooltip').forEach(function (el) {
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            if (el._tippy) el._tippy.show()
          } else if (e.key === 'Escape') {
            if (el._tippy) el._tippy.hide()
          }
        })
      })
    })
  }

  /**
   * Get the current documentation version from the URL path
   * Returns 'current' as fallback if version cannot be determined
   */
  function getDocVersion () {
    // Try to extract version from URL path (e.g., /25.3/reference/... or /current/...)
    var match = window.location.pathname.match(/^\/(\d+\.\d+|current|beta)\//)
    if (match) {
      return match[1]
    }
    // Fallback to 'current' for unversioned or root pages
    return 'current'
  }

  /**
   * Initialize property tooltips with retry for Tippy.js loading
   */
  function init () {
    if (isPropertyTooltipsDisabled()) {
      return
    }

    // Retry mechanism for Tippy.js - it may still be loading
    var maxRetries = 5
    var retryDelay = 100 // ms

    function tryInit (retriesLeft) {
      if (window.tippy) {
        // Use requestIdleCallback for non-blocking processing
        var schedule = window.requestIdleCallback || function (cb) {
          setTimeout(cb, 100)
        }
        schedule(function () {
          processCodeElements()
        })
      } else if (retriesLeft > 0) {
        setTimeout(function () {
          tryInit(retriesLeft - 1)
        }, retryDelay)
      } else {
        console.warn('Property tooltips: Tippy.js not loaded after retries')
      }
    }

    tryInit(maxRetries)
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
