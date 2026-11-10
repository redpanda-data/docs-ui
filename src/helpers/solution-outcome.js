'use strict'

/**
 * Resolves a solution's outcome diagram, named on the overview by
 * :page-solution-outcome-image: (a file name in the module's images/), and
 * returns { svg, src }: the SVG markup to inline and its published URL.
 *
 * The diagram is inlined rather than loaded with <img> so that it follows the
 * site's theme toggle. An <img> SVG is a separate document: it sees only the
 * OS prefers-color-scheme, never html[data-theme]. Inlined, its own
 * `[data-theme="dark"] .oc` rule and the --oc-* colors in solutions.css apply.
 *
 * The root <svg> gets aria-hidden: the partial wraps it in an element with
 * role="img" and the page's :page-solution-outcome-alt: as its name, so a
 * screen reader announces the alt text once instead of the alt text and the
 * SVG's own <title> and <desc>.
 *
 * Returns undefined when the attribute is empty or the image does not resolve
 * (the partial then renders nothing), and { src } without svg for a file that
 * is not an SVG or in a preview build that has no content catalog.
 *
 * Usage:
 *   {{#with (solution-outcome page.attributes.solution-outcome-image) as |outcome|}}
 */
module.exports = (name, { data }) => {
  if (!name || typeof name !== 'string') return undefined
  const { page, contentCatalog } = data.root || {}
  const file = name.trim()
  if (!contentCatalog || !contentCatalog.resolveResource) return { src: file }
  const context = page && page.component
    ? { component: page.component.name, version: page.version, module: page.module }
    : {}
  const image = contentCatalog.resolveResource(`image$${file}`, context, 'image', ['image'])
  if (!image) {
    const logger = data.root.logger
    const where = (page && page.src && page.src.path) || 'unknown page'
    const msg = `${where}: page-solution-outcome-image "${file}" is not in the module's images/`
    if (logger) logger.warn(msg)
    else console.warn(`[solution-outcome] ${msg}`)
    return undefined
  }
  const src = image.pub && image.pub.url
  if (!/\.svg$/i.test(file) || !image.contents) return { src }
  return { svg: inlineSvg(image.contents.toString()), src }
}

function inlineSvg (markup) {
  const svg = markup
    .replace(/<\?xml[\s\S]*?\?>/, '')
    .replace(/<!DOCTYPE[\s\S]*?>/i, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
  // The wrapper carries the accessible name; drop the root's own.
  return svg.replace(/<svg\b([^>]*)>/, (open, attrs) => {
    const kept = attrs
      .replace(/\s(?:role|aria-labelledby|aria-label|aria-hidden|focusable)="[^"]*"/g, '')
    return `<svg${kept} aria-hidden="true" focusable="false">`
  })
}

module.exports.inlineSvg = inlineSvg
