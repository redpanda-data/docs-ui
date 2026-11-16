'use strict'

/**
 * Whether the article uses a Font Awesome icon that needs the font.
 * Usage: {{#if (has-font-awesome-icons)}}...{{/if}}
 *
 * The site playbook turns font icons off (icons unset), so admonition labels
 * and checklist markers are real text and doc.css styles that markup. A
 * content repo's own local playbook may still use icons=font, where
 * `icon:name[]` emits <i class="fa fa-name">. No content uses that macro, but
 * this keeps it working where it appears. The Font Awesome stylesheet used to load on every
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
