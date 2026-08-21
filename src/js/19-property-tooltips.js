/* global uiRootPath fetch localStorage */
/**
 * Redpanda Property Tooltips
 *
 * Adds hover documentation tooltips to configuration property references.
 * Marking is opt-in: only code elements emitted by the prop: AsciiDoc macro
 * (class property-ref plus a data-property-name attribute) are decorated.
 * Plain backticked words are never matched, so ambiguous terms such as
 * admin or rack in Helm or feature contexts don't pick up wrong tooltips.
 * Disable on specific pages with:
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
   * Get the component-local property pages base URL from meta tag.
   * head-meta resolves reference:properties/cluster-properties.adoc in the
   * current page's own component, so cloud pages link to cloud's property
   * pages, streaming pages to streaming's, and so on.
   */
  function getPropertiesPagesUrl () {
    var meta = document.querySelector('meta[name="properties-pages-url"]')
    // Ignore unresolved placeholders (the UI preview resolver emits '#').
    if (meta && meta.content && meta.content.indexOf('cluster-properties') !== -1) {
      return meta.content
    }
    return null
  }

  /**
   * Get the latest Redpanda tag from meta tag (for cache versioning)
   */
  function getLatestRedpandaTag () {
    var meta = document.querySelector('meta[name="latest-redpanda-tag"]')
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

  var CACHE_KEY = 'redpanda-properties-cache'
  var CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours
  // Missing-resource markers live under their own key so they can never
  // overwrite a valid cached dataset, and are only written for HTTP 404/410
  // (the resource does not exist). Transient failures (5xx, offline, parse
  // errors) are not cached at all: the next page view simply retries.
  // The value is a per-URL map ({url: {version, timestamp}}) because the
  // properties JSON URL and tag vary per doc version: a user browsing
  // several versions with missing JSON must not thrash a single marker.
  var MISSING_CACHE_KEY = 'redpanda-properties-missing'
  var MISSING_CACHE_TTL = 60 * 60 * 1000 // 1 hour: re-check missing resources so a fix deploy is picked up

  /**
   * Read the missing-resource map, dropping expired or malformed entries
   */
  function readMissingMarkers () {
    try {
      var parsed = JSON.parse(localStorage.getItem(MISSING_CACHE_KEY) || '{}')
      if (!parsed || typeof parsed !== 'object') return {}
      var now = Date.now()
      var fresh = {}
      Object.keys(parsed).forEach(function (markedUrl) {
        var entry = parsed[markedUrl]
        if (entry && typeof entry.timestamp === 'number' && now - entry.timestamp < MISSING_CACHE_TTL) {
          fresh[markedUrl] = entry
        }
      })
      return fresh
    } catch (e) {
      return {}
    }
  }

  function hasMissingMarker (url, version) {
    var entry = readMissingMarkers()[url]
    return !!(entry && entry.version === version)
  }

  function markMissing (url, version) {
    try {
      var markers = readMissingMarkers()
      markers[url] = { version: version, timestamp: Date.now() }
      localStorage.setItem(MISSING_CACHE_KEY, JSON.stringify(markers))
    } catch (e) {
      // localStorage full or unavailable
    }
  }

  function clearMissingMarker (url) {
    try {
      var markers = readMissingMarkers()
      delete markers[url]
      // Always rewrite: this also prunes expired entries from storage
      localStorage.setItem(MISSING_CACHE_KEY, JSON.stringify(markers))
    } catch (e) {
      // localStorage full or unavailable
    }
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

    // Static fallback URL for preview mode
    var rootPath = typeof uiRootPath !== 'undefined' ? uiRootPath : '/_'
    var staticFallbackUrl = rootPath + '/redpanda-properties.json'

    if (!url) {
      if (isPreviewMode()) {
        // Use static fallback for preview/development when no meta tag
        url = staticFallbackUrl
      } else {
        console.warn('Property tooltips: No properties-json-url meta tag found')
        propertiesLoading = false
        return Promise.resolve(null)
      }
    }

    // Key the cache on the resolved URL as well as the tag. Different components
    // now publish their own dataset, so the same tag no longer identifies the
    // same JSON: caching on the tag alone served one component's properties on
    // another's pages for the whole TTL, which is exactly the mix-up the
    // per-component resolution exists to prevent. The missing-marker cache
    // beside this one was already keyed by URL.
    var cacheVersion = (getLatestRedpandaTag() || 'unknown') + '|' + url

    // Check localStorage cache (skip in preview mode for easier testing).
    // The dataset cache and the missing-marker each get their own try/catch
    // so a corrupt entry in one cannot disable the other check.
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
      if (hasMissingMarker(url, cacheVersion)) {
        // The resource is known not to exist for this version: resolve to
        // an empty lookup instead of re-requesting a 404 on every page view
        propertiesData = {}
        propertiesLoading = false
        propertiesLoadQueue.forEach(function (resolve) {
          resolve(propertiesData)
        })
        propertiesLoadQueue = []
        return Promise.resolve(propertiesData)
      }
    }

    return fetch(url)
      .then(function (response) {
        if (!response.ok) {
          var httpError = new Error('HTTP ' + response.status)
          httpError.status = response.status
          throw httpError
        }
        return response.json()
      })
      .then(function (json) {
        propertiesData = buildPropertyLookup(json)

        // Cache the result (skip in preview mode)
        if (!isPreviewMode()) {
          // Clear the missing-marker before the cache write: if setItem
          // throws on quota, a stale marker must not outlive a successful fetch
          clearMissingMarker(url)
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
        // In preview mode, retry with static fallback if versioned URL fails
        if (isPreviewMode() && url !== staticFallbackUrl) {
          console.info('Property tooltips: Versioned URL failed, trying static fallback')
          return fetch(staticFallbackUrl)
            .then(function (response) {
              if (!response.ok) {
                throw new Error('HTTP ' + response.status)
              }
              return response.json()
            })
            .then(function (json) {
              propertiesData = buildPropertyLookup(json)
              propertiesLoading = false
              propertiesLoadQueue.forEach(function (resolve) {
                resolve(propertiesData)
              })
              propertiesLoadQueue = []
              return propertiesData
            })
            .catch(function (fallbackError) {
              console.warn('Property tooltips: Static fallback also failed:', fallbackError)
              propertiesLoading = false
              propertiesData = {}
              propertiesLoadQueue.forEach(function (resolve) {
                resolve(propertiesData)
              })
              propertiesLoadQueue = []
              return propertiesData
            })
        }

        console.warn('Property tooltips: Failed to load properties data:', error)
        if (!isPreviewMode() && (error.status === 404 || error.status === 410)) {
          markMissing(url, cacheVersion)
        }
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
  function createPropertyTooltip (prop, stampedUrl) {
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

    if (badges.length > 0) {
      parts.push('<div class="prop-tooltip-badges">' + badges.join(' ') + '</div>')
    }

    // Description: first paragraph only. The tooltip is a preview; the full
    // accepted-values detail lives at the "View full documentation" anchor.
    if (prop.description) {
      parts.push('<div class="prop-tooltip-description">' + formatDescription(prop.description, true) + '</div>')
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

    // Link to full documentation, relative to the current page's component
    parts.push('<a href="' + escapeHtml(buildDocUrl(prop, stampedUrl)) + '" class="prop-tooltip-link">View full documentation &rarr;</a>')

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
   * The anchor Asciidoctor generates for a property heading: dots become
   * hyphens, underscores are valid id characters and stay.
   * e.g., "redpanda.storage.mode" -> "redpanda-storage-mode"
   * e.g., "cloud_storage_enabled" -> "cloud_storage_enabled"
   */
  function propertyAnchor (name) {
    return name.replace(/\./g, '-')
  }

  /**
   * Documentation URL for a property. The prop macro stamps data-doc-url
   * with the URL of the page it discovered actually documents the property
   * (per component, respecting include tags) -- always prefer that. The
   * scope-derived guess remains only for markers built before the stamp
   * existed.
   */
  function buildDocUrl (prop, stampedUrl) {
    if (stampedUrl) return stampedUrl
    var scope = prop.configScope || 'cluster'
    var anchor = propertyAnchor(prop.name)
    var pagesUrl = getPropertiesPagesUrl()
    if (pagesUrl) {
      // Swap the scope into the component-resolved cluster-properties URL.
      return pagesUrl.replace('cluster-properties', scope + '-properties') + '#' + anchor
    }
    // Fallback for pages without the meta tag: streaming URL space.
    return '/' + getDocVersion() + '/reference/properties/' + scope + '-properties/#' + anchor
  }

  /**
   * Find a property whose heading anchor matches the given anchor, so
   * <<anchor,text>> internal references can link across property pages.
   * Hand-written references use inconsistent anchor spellings, so index
   * each property under the real Asciidoctor id plus the legacy variants
   * (dots removed / underscores hyphenated).
   */
  var anchorIndex = null
  function propertyForAnchor (anchor) {
    if (!propertiesData) return null
    if (!anchorIndex) {
      anchorIndex = {}
      Object.keys(propertiesData).forEach(function (name) {
        var prop = propertiesData[name]
        anchorIndex[propertyAnchor(name)] = prop
        anchorIndex[name.replace(/\./g, '').replace(/_/g, '-')] = prop
        anchorIndex[name.replace(/[._]/g, '-')] = prop
      })
    }
    return anchorIndex[anchor] || null
  }

  /**
   * Attribute names considered "defined" when evaluating ifdef/ifndef
   * conditionals in property descriptions. Property descriptions are shared
   * between the self-managed and cloud sites, so pick the branch matching
   * the site this page belongs to.
   */
  function definedConditionalAttributes () {
    var defined = []
    // Cloud components set page-cloud: true, which head-meta surfaces as a
    // meta tag. Fall back to the component-resolved pages URL for pages
    // built before the meta tag existed.
    var meta = document.querySelector('meta[name="page-env-cloud"]')
    var pagesUrl = getPropertiesPagesUrl() || ''
    if ((meta && meta.content === 'true') || pagesUrl.indexOf('cloud-data-platform') !== -1) {
      defined.push('env-cloud')
    }
    return defined
  }

  /**
   * Evaluate AsciiDoc preprocessor conditionals (ifdef/ifndef/endif) in a
   * description, keeping only the lines for the current site.
   */
  function stripConditionals (text, defined) {
    var out = []
    var stack = []
    text.split('\n').forEach(function (line) {
      var directive = line.match(/^\s*(ifdef|ifndef)::([^[\]]+)\[(.*)\]\s*$/)
      if (directive) {
        var attrs = directive[2]
        var satisfied
        if (attrs.indexOf(',') !== -1) {
          satisfied = attrs.split(',').some(function (a) { return defined.indexOf(a.trim()) !== -1 })
        } else if (attrs.indexOf('+') !== -1) {
          satisfied = attrs.split('+').every(function (a) { return defined.indexOf(a.trim()) !== -1 })
        } else {
          satisfied = defined.indexOf(attrs.trim()) !== -1
        }
        if (directive[1] === 'ifndef') satisfied = !satisfied
        if (directive[3]) {
          // Single-line form: ifdef::attr[content]
          if (satisfied && stack.every(Boolean)) out.push(directive[3])
        } else {
          stack.push(satisfied)
        }
        return
      }
      if (/^\s*endif::[^[\]]*\[\]\s*$/.test(line)) {
        stack.pop()
        return
      }
      if (stack.every(Boolean)) out.push(line)
    })
    return out.join('\n')
  }

  /**
   * Format one run of inline text - sanitize HTML while preserving safe
   * links, code spans, and property cross-references.
   *
   * Handles:
   * - Pre-resolved <a> tags from JSON (safe, with href attribute)
   * - Backticks converted to <code> tags
   * - prop:/config_ref macro calls rendered as code
   * - glossterm: rendered as its term, link: as a sanitized anchor
   * - <<anchor,text>> internal references linked when they name a property
   * - Fallback xref resolution for unqualified same-component targets
   */
  /**
   * The text the glossary macro itself would display.
   *
   * macros/glossary.js declares positionalAttributes(['definition',
   * 'customText']) and displays `customText || term`, so the SECOND positional
   * wins, the first is the definition, and a named customText= or term=
   * overrides either. Splitting on the first comma got the common cases right
   * but showed 'display,extra' for three positionals and kept the quotes on a
   * quoted value.
   */
  function glossaryDisplayText (term, attrlist) {
    var positional = []
    var named = {}
    // Split on commas outside double quotes, keeping empty fields: the macro
    // reads glossterm:Term[,display] as an absent definition plus a display
    // value, so dropping the empty first field lost the display text.
    var parts = String(attrlist) === '' ? [] : String(attrlist).split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    parts.forEach(function (part) {
      var value = part.trim()
      var eq = value.indexOf('=')
      var name = eq === -1 ? null : value.slice(0, eq).trim()
      if (name && /^[A-Za-z][\w-]*$/.test(name)) {
        named[name] = unquote(value.slice(eq + 1).trim())
      } else {
        positional.push(unquote(value))
      }
    })
    return named.customText || positional[1] || named.term || term.trim()
  }

  function unquote (value) {
    return value.replace(/^(['"])([\s\S]*)\1$/, '$2')
  }

  function formatInline (text) {
    if (!text) return ''

    // Extract and preserve <a> tags (already resolved in JSON generation)
    var linkPlaceholders = []
    var withPlaceholders = text.replace(/<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>/g, function (match, href, display) {
      var index = linkPlaceholders.length
      // Sanitize href to prevent javascript: URLs - allow http(s), absolute, relative, and anchor links
      if (href.match(/^(https?:|\/|#|\.\.?\/)/i)) {
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

    // Render prop macro calls from generated descriptions as code (the
    // text= attribute wins as the display, matching the macro's rendering)
    var withProps = withCode.replace(/prop:([^[\s]+)\[([^\]]*)\]/g, function (match, name, attrs) {
      var textMatch = attrs.match(/text=([^,\]]+)/)
      return '<code>' + (textMatch ? textMatch[1] : name) + '</code>'
    })

    // Legacy config_ref macro calls survive in older published JSONs
    withProps = withProps.replace(/config_ref:([^[,]+)(?:,[^[]*)?\[([^\]]*)\]/g, function (match, name, payload) {
      var display = payload.replace(/^`|`$/g, '') || name
      return '<code>' + display + '</code>'
    })

    // glossterm:Term[definition,customText] names a glossary entry. The macro
    // declares its positional attributes as ['definition', 'customText'] and
    // displays `customText || term`, so the FIRST bracketed value is the
    // definition, not display text: glossterm:wire format[wire-format] shows
    // "wire format". A tooltip nested inside a tooltip is not reachable, so
    // render whichever text the macro itself would have displayed.
    withProps = withProps.replace(/glossterm:([^[\]\s][^[\]]*)\[([^\]]*)\]/g, function (match, term, attrlist) {
      return glossaryDisplayText(term, attrlist)
    })

    // link:url[label] for external targets. Sanitize the scheme, as the <a>
    // placeholder branch above does, so a javascript: URL cannot get through.
    withProps = withProps.replace(/\blink:(\S+?)\[([^\]]*)\]/g, function (match, href, display) {
      // A trailing ^ on the display text is AsciiDoc for "open in a new tab".
      // Without stripping it the caret renders as part of the link text.
      var newWindow = /\^$/.test(display)
      var label = (newWindow ? display.slice(0, -1) : display) || href
      // Allow http(s), a site-root path, a fragment, or a relative path. Reject
      // everything else, including javascript: and a protocol-relative //host,
      // which is an off-site URL wearing a path's clothing.
      // Reject any backslash outright: browsers treat \ as / in special schemes,
      // so /\/evil.example resolves to https://evil.example and slipped past the
      // protocol-relative guard below. mailto: is allowed -- it is an ordinary
      // docs link, and dropping it silently lost the address.
      if (/\\/.test(href)) return label
      if (!href.match(/^(https?:\/\/|mailto:|\/(?!\/)|#|\.\.?\/)/i)) return label
      var attrs = newWindow ? ' target="_blank" rel="noopener"' : ''
      // The whole description was escaped above, so & is already &amp; here;
      // escaping again turned ?a=1&b=2 into ?a=1&amp;amp;b=2 and the browser
      // requested a parameter containing a literal "amp;". escapeHtml goes
      // through textContent, which leaves quotes alone, so quote them here --
      // that is the only character still able to close the attribute.
      return '<a href="' + href.replace(/"/g, '&quot;') + '"' + attrs + '>' + label + '</a>'
    })

    // Internal <<anchor,text>> references (escaped to &lt;&lt;...&gt;&gt;).
    // Link when the anchor names another documented property; otherwise
    // render the display text alone.
    var withRefs = withProps.replace(/&lt;&lt;([^,&\s]+)(?:,\s*((?:(?!&gt;&gt;).)*?))?&gt;&gt;/g, function (match, anchor, display) {
      var target = propertyForAnchor(anchor)
      var label = display || (target ? '<code>' + target.name + '</code>' : anchor)
      if (target) {
        return '<a href="' + escapeHtml(buildDocUrl(target)) + '">' + label + '</a>'
      }
      return label
    })

    // Fallback: resolve remaining xrefs. Unqualified targets resolve
    // relative to the current page; module-qualified targets (one ':')
    // resolve against the component root derived from the property pages
    // URL. Component-qualified targets can't be resolved client-side and
    // render as their display text.
    var withXrefs = withRefs.replace(
      // .adoc is optional: one real description writes
      // xref:develop:transactions#transaction-usage-tips[...] with no extension,
      // and requiring it meant the macro did not match at all and the raw
      // xref:...[...] source was shown to the reader. This matters more now that
      // property datasets keep their xref macros instead of having them
      // pre-rewritten into anchors during the build.
      /xref:([^[\]#]+?)(?:\.adoc)?(?:#([^[\]]*))?\[([^\]]*)\]/g,
      function (match, path, anchor, display) {
        var label = display || path.split('/').pop()
        var href
        var parts = path.split(':')
        if (parts.length === 1) {
          href = path.replace(/^\.\//, '')
        } else if (parts.length === 2) {
          var pagesUrl = getPropertiesPagesUrl()
          if (!pagesUrl) return label
          var componentRoot = pagesUrl.replace(/reference\/properties\/cluster-properties\/?$/, '')
          href = componentRoot + parts[0] + '/' + parts[1].replace(/^\.\//, '')
        } else {
          return label
        }
        // Antora indexifies page URLs: index pages drop the final segment.
        href = href.replace(/\/index$/, '') + '/'
        if (anchor) href += '#' + anchor
        // escapeHtml goes through textContent, which leaves quotes alone, and an
        // xref target may contain one -- so quote it here as the link: branch
        // does. Without this a crafted target closed the href and added an
        // event handler.
        return '<a href="' + escapeHtml(href).replace(/"/g, '&quot;') + '">' + label + '</a>'
      }
    )

    // Restore preserved links
    return withXrefs.replace(/___LINK_(\d+)___/g, function (match, index) {
      return linkPlaceholders[parseInt(index, 10)] || match
    })
  }

  /**
   * Format description - evaluate conditionals, then render paragraphs and
   * bullet lists so multi-line descriptions don't collapse into one blob.
   * With summaryOnly, keep just the first block (the summary sentence) and
   * mark the truncation with an ellipsis.
   */
  function formatDescription (text, summaryOnly) {
    if (!text) return ''

    var cleaned = stripConditionals(String(text), definedConditionalAttributes())
    var blocks = []
    var paragraph = []
    var list = null

    function flushParagraph () {
      if (paragraph.length) {
        blocks.push('<p>' + formatInline(paragraph.join(' ')) + '</p>')
        paragraph = []
      }
    }
    function flushList () {
      if (list) {
        blocks.push('<ul>' + list.map(function (item) { return '<li>' + formatInline(item) + '</li>' }).join('') + '</ul>')
        list = null
      }
    }

    cleaned.split('\n').forEach(function (rawLine) {
      var line = rawLine.trim()
      if (!line) {
        flushParagraph()
        flushList()
        return
      }
      var item = line.match(/^[*-]\s+(.*)$/)
      if (item) {
        flushParagraph()
        if (!list) list = []
        list.push(item[1])
        return
      }
      if (list) {
        // Continuation of the previous list item
        list[list.length - 1] += ' ' + line
        return
      }
      paragraph.push(line)
    })
    flushParagraph()
    flushList()

    if (summaryOnly && blocks.length > 1) {
      var first = blocks[0]
      if (first.slice(-4) === '</p>') {
        return first.slice(0, -4) + '&#8230;</p>'
      }
      return first + '<p>&#8230;</p>'
    }
    return blocks.join('')
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

      // Scope: only elements marked by the prop: macro are decorated
      var article = document.querySelector('article.doc')
      if (!article) return

      var codeElements = article.querySelectorAll(
        'code[data-property-name]:not(.has-property-tooltip), code.property-ref:not(.has-property-tooltip)'
      )
      var isTouch = isTouchDevice()

      // Only the first mention of a property in a paragraph (or list item,
      // table cell, ...) gets a tooltip. Repeats render as plain code so a
      // dense paragraph isn't wall-to-wall dotted underlines.
      var decoratedContainers = new WeakMap()
      var isRepeatMention = function (codeEl, name) {
        var container = codeEl.closest('p, li, td, th, dt, dd') || codeEl.parentElement || article
        var seen = decoratedContainers.get(container)
        if (seen && seen.has(name)) return true
        if (!seen) {
          seen = new Set()
          decoratedContainers.set(container, seen)
        }
        seen.add(name)
        return false
      }

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
          // Same show delay as the glossary and enterprise tooltips, so
          // dragging the cursor across a paragraph doesn't fire previews.
          delay: [200, 0],
          popperOptions: {
            modifiers: [
              { name: 'preventOverflow', options: { boundary: 'viewport' } },
              { name: 'flip', options: { fallbackPlacements: ['bottom', 'top'] } },
            ],
          },
        }
      }

      codeElements.forEach(function (codeEl) {
        var text = codeEl.getAttribute('data-property-name') || codeEl.textContent.trim()

        // Look up the marked property in the published data
        if (Object.prototype.hasOwnProperty.call(properties, text)) {
          if (isRepeatMention(codeEl, text)) return
          var prop = properties[text]
          var tooltipContent = createPropertyTooltip(prop, codeEl.getAttribute('data-doc-url'))

          // Mark as having tooltip (for styling and to avoid re-processing)
          codeEl.classList.add('has-property-tooltip')
          codeEl.classList.add('has-documentation')
          if (prop.isEnterprise) {
            codeEl.classList.add('is-enterprise-property')
          }
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
   * Note: beta versions may not have property attachments, so fall back to current
   */
  function getDocVersion () {
    // Try to extract version from URL path (e.g., /25.3/reference/... or /current/...)
    // Match with or without trailing slash to handle edge cases
    var match = window.location.pathname.match(/^\/(\d+\.\d+|current)(?:\/|$)/)
    if (match) {
      return match[1]
    }
    // Fallback to 'current' for beta, unversioned, or root pages
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
        // Use requestIdleCallback for non-blocking processing, with a
        // timeout so tooltips still attach promptly when the main thread
        // never goes idle (busy pages, loaded CI runners)
        var schedule = window.requestIdleCallback
          ? function (cb) { window.requestIdleCallback(cb, { timeout: 500 }) }
          : function (cb) { setTimeout(cb, 100) }
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
