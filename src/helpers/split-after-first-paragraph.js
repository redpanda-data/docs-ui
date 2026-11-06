'use strict'

/**
 * Splits converted HTML after its first paragraph block, so a layout can put
 * something between the opening paragraph of a preamble and the rest of it.
 *
 * Asciidoctor emits a paragraph as <div class="paragraph"> holding an optional
 * block title and one <p>. `before` ends with that block's closing </div>,
 * `after` is the rest; HTML with no paragraph is all `before`, so whatever the
 * layout inserts still lands after the introduction.
 *
 * Usage:
 *   {{#with (split-after-first-paragraph parts.before) as |intro|}}
 *     {{{intro.before}}} ... {{{intro.after}}}
 *   {{/with}}
 */
const PARAGRAPH = /<div class="paragraph(?:\s[^"]*)?"[^>]*>[\s\S]*?<\/p>\s*<\/div>/

module.exports = function (html) {
  const text = html == null ? '' : String(html)
  const match = PARAGRAPH.exec(text)
  if (!match) return { before: text, after: '' }
  const end = match.index + match[0].length
  return { before: text.slice(0, end), after: text.slice(end) }
}
