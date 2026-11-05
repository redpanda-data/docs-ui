'use strict'

/**
 * Whether the rendered page needs the code-block runtime (Prism syntax
 * highlighting, its line-number/highlight plugins, and the tabs script).
 * Usage: {{#if (has-code-blocks)}}...{{/if}}
 *
 * Antora hands the converted article body to the template as page.contents,
 * so this is a plain substring check on that HTML: a <pre> (listing, literal,
 * or source block), a tabset, or an Asciidoctor callout list. Landing pages
 * (home, component homes, search) have none of these, yet still paid ~200 ms
 * of script evaluation for Prism on every visit.
 *
 * Fails open: with no page.contents to inspect (a layout with no article, or
 * the UI preview's model) the scripts load exactly as they always did.
 */
const NEEDS_CODE_RUNTIME = /<pre\b|class="(?:[^"]*\s)?(?:tabs|tabset|colist)(?:\s[^"]*)?"/

module.exports = ({ data: { root } }) => {
  const page = root && root.page
  if (!page || page.contents == null) return true
  const html = typeof page.contents === 'string' ? page.contents : page.contents.toString()
  return NEEDS_CODE_RUNTIME.test(html)
}
