'use strict'

/**
 * True when the rendered HTML carries an element with the given id.
 *
 * Lets a layout skip a generated section when the page already authored its
 * own, for example the overview's `== Related docs` (id="related-docs"),
 * instead of rendering the same links twice. `html` may be a string or the
 * Buffer Antora hands the UI as page.contents.
 *
 * Usage: {{#unless (html-has-id @root.page.contents 'related-docs')}}...{{/unless}}
 */
module.exports = function (html, id) {
  if (html === undefined || html === null || typeof id !== 'string' || !id) return false
  const text = String(html)
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('\\sid=(["\'])' + escaped + '\\1').test(text)
}
