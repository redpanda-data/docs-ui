'use strict'

// Parses a JSON attribute value, such as page-context-switcher, page-faqs, or
// toc-tools-links. Malformed JSON is logged and treated as empty so one bad
// attribute cannot fail the whole site build.
module.exports = (a, options) => {
  if (typeof a === 'undefined' || a === null) {
    return {}
  }
  try {
    return JSON.parse(a)
  } catch (err) {
    const { page, logger } = (options && options.data && options.data.root) || {}
    const where = (page && page.src && page.src.path) || (page && page.relativeSrcPath) || 'unknown page'
    const message = `${where}: ignoring malformed JSON attribute value (${err.message}): ${String(a).slice(0, 80)}`
    if (logger && typeof logger.warn === 'function') logger.warn(message)
    else console.warn(`[obj] ${message}`)
    return {}
  }
}
