'use strict'

/**
 * Generates a hero gradient from a component's color
 * Usage: {{get-hero-gradient page}}
 *
 * Takes the component-metadata color and creates a gradient:
 * - Top: darker shade (mixed with black)
 * - Bottom: slightly lighter shade
 *
 * Priority:
 * 1. page.attributes['hero-gradient'] - explicit gradient override
 * 2. page.attributes['hero-color'] - page-level color override (useful for preview testing)
 * 3. component-metadata.heroGradient - component-level explicit gradient
 * 4. component-metadata.color - component base color
 *
 * @param {object} page - The page object from Antora
 * @returns {string|undefined} CSS linear-gradient value or undefined
 */
module.exports = function (page) {
  if (!page) return undefined

  // Check for page-level gradient override first
  if (page.attributes && page.attributes['hero-gradient']) {
    return page.attributes['hero-gradient']
  }

  // Check for page-level color override (useful for preview testing different components)
  if (page.attributes && page.attributes['hero-color']) {
    const baseColor = page.attributes['hero-color']
    const darkColor = darkenHex(baseColor, 0.6)
    const lightColor = darkenHex(baseColor, 0.3)
    return `linear-gradient(180deg, ${darkColor} 0%, ${lightColor} 100%)`
  }

  // Get component-metadata
  const headerData =
    page.componentVersion &&
    page.componentVersion.asciidoc &&
    page.componentVersion.asciidoc.attributes &&
    page.componentVersion.asciidoc.attributes['component-metadata']

  // If heroGradient is explicitly set, use it
  if (headerData && headerData.heroGradient) {
    return headerData.heroGradient
  }

  // Otherwise generate from the base color
  if (headerData && headerData.color) {
    const baseColor = headerData.color
    const darkColor = darkenHex(baseColor, 0.6) // 60% darker for top
    const lightColor = darkenHex(baseColor, 0.3) // 30% darker for bottom
    return `linear-gradient(180deg, ${darkColor} 0%, ${lightColor} 100%)`
  }

  return undefined
}

/**
 * Darkens a hex color by a given amount
 * @param {string} hex - Hex color (with or without #)
 * @param {number} amount - Amount to darken (0-1, where 1 is black)
 * @returns {string} Darkened hex color
 */
function darkenHex (hex, amount) {
  // Remove # if present
  hex = hex.replace(/^#/, '')

  // Parse RGB
  let r = parseInt(hex.substring(0, 2), 16)
  let g = parseInt(hex.substring(2, 4), 16)
  let b = parseInt(hex.substring(4, 6), 16)

  // Darken by mixing with black
  r = Math.round(r * (1 - amount))
  g = Math.round(g * (1 - amount))
  b = Math.round(b * (1 - amount))

  // Convert back to hex
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')
}
