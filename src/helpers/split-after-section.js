'use strict'

/**
 * Splits converted page HTML after the top-level section whose h2 has the
 * given id, so a layout can put something directly after that section.
 *
 * Asciidoctor emits each `==` section as <div class="sect1"> with its h2 as
 * the first child. The section ends where the next sect1 starts, or, for the
 * last one, where the footnotes start or the HTML ends. `before` is the HTML
 * up to that point, `after` the rest. When no section has the id, `before` is
 * all of the HTML and `after` is empty, so the insert lands at the end.
 *
 * Usage:
 *   {{#with (split-after-section page.contents 'production-considerations') as |parts|}}
 *     {{{parts.before}}} ... {{{parts.after}}}
 *   {{/with}}
 */
const SECT1 = /<div class="sect1(?:\s[^"]*)?"[^>]*>\s*<h2 id="([^"]*)"/g
const FOOTNOTES = '<div id="footnotes"'

module.exports = function (html, id) {
  const text = html == null ? '' : String(html)
  const want = typeof id === 'string' ? id : ''
  SECT1.lastIndex = 0
  let match
  let found = false
  while ((match = SECT1.exec(text))) {
    if (found) return { before: text.slice(0, match.index), after: text.slice(match.index) }
    if (match[1] === want) found = true
  }
  if (!found) return { before: text, after: '' }
  const notes = text.indexOf(FOOTNOTES)
  const end = notes === -1 ? text.length : notes
  return { before: text.slice(0, end), after: text.slice(end) }
}
