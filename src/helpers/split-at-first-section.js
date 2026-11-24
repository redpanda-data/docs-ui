'use strict'

/**
 * Splits converted page HTML at its first top-level section, so a layout can
 * put something between the preamble and the first h2.
 *
 * Asciidoctor emits the text before the first `==` as <div id="preamble">
 * (or as bare blocks when there is no title) and each `==` section as
 * <div class="sect1">. `before` is everything up to the first sect1, `after`
 * the rest; a page with no sections is all `before`.
 *
 * Usage:
 *   {{#with (split-at-first-section page.contents) as |parts|}}
 *     {{{parts.before}}} ... {{{parts.after}}}
 *   {{/with}}
 */
const SECT1 = /<div class="sect1(?:\s[^"]*)?"/

module.exports = function (html) {
  const text = html == null ? '' : String(html)
  const match = SECT1.exec(text)
  if (!match) return { before: text, after: '' }
  return { before: text.slice(0, match.index), after: text.slice(match.index) }
}
