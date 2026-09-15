'use strict'

/**
 * Whether the article uses a Font Awesome icon that needs the font.
 * Usage: {{#if (has-font-awesome-icons)}}...{{/if}}
 *
 * Asciidoctor runs with icons=font, so `icon:name[]` in content emits
 * <i class="fa fa-name">. The Font Awesome stylesheet used to load on every
 * page for that, though no page in a full site build used anything but the
 * checklist squares (fa-square-o, fa-check-square-o), which doc.css draws
 * itself. head-styles.hbs now loads the stylesheet only where the body has
 * some other fa- class, so the macro keeps working and the other 9,000
 * pages stop paying for it.
 *
 * Fails closed: no body to inspect means no icon macro output to render.
 */
const NEEDS_FONT = /\bfa fa-(?!(?:check-)?square-o\b)[a-z0-9-]+/

module.exports = ({ data: { root } }) => {
  const page = root && root.page
  if (!page || page.contents == null) return false
  const html = typeof page.contents === 'string' ? page.contents : page.contents.toString()
  return NEEDS_FONT.test(html)
}
