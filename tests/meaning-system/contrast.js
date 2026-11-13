'use strict'

// Color parsing and WCAG 2 contrast for the meaning-system tests. Reads the
// custom properties a CSS file declares inside one selector's blocks, resolves
// var() references, and composites translucent colors over the page
// background before measuring, the way the browser paints them.

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const CSS = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// Custom properties declared in every block whose selector list includes
// `selector` exactly (later declarations win, as in the cascade).
function declarations (css, selector) {
  const out = {}
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(css))) {
    const selectors = m[1].split(',').map((s) => s.trim())
    if (!selectors.includes(selector)) continue
    const decl = /(--[\w-]+)\s*:\s*([^;]+);/g
    let d
    while ((d = decl.exec(m[2]))) out[d[1]] = d[2].trim()
  }
  return out
}

function resolve (value, scopes, depth = 0) {
  if (depth > 10) throw new Error(`var() loop at ${value}`)
  const m = value.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/)
  if (!m) return value
  for (const scope of scopes) if (m[1] in scope) return resolve(scope[m[1]], scopes, depth + 1)
  if (m[2]) return resolve(m[2].trim(), scopes, depth + 1)
  throw new Error(`unresolved ${m[1]}`)
}

function parseColor (value) {
  const v = value.trim().toLowerCase()
  if (v === 'white') return { r: 255, g: 255, b: 255, a: 1 }
  let m = v.match(/^#([0-9a-f]{3,8})$/)
  if (m) {
    let h = m[1]
    if (h.length <= 4) h = h.split('').map((c) => c + c).join('')
    const n = (i) => parseInt(h.slice(i, i + 2), 16)
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 }
  }
  m = v.match(/^rgba?\(([^)]+)\)$/)
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  throw new Error(`not a color: ${value}`)
}

const over = (top, bottom) => ({
  r: top.r * top.a + bottom.r * (1 - top.a),
  g: top.g * top.a + bottom.g * (1 - top.a),
  b: top.b * top.a + bottom.b * (1 - top.a),
  a: 1,
})

function luminance (c) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
}

// Contrast of fg on bg, both composited over the page background first
function contrast (fg, bg, page) {
  const b = over(parseColor(bg), parseColor(page))
  const f = over(parseColor(fg), b)
  const [hi, lo] = [luminance(f), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// The two themes: their meaning tokens and page background, read from the
// files the site ships. Light tokens live on :root in vars.css; dark ones on
// html[data-theme=dark] in dark-mode.css.
function themes () {
  const vars = CSS('src/css/vars.css')
  const dark = CSS('src/css/dark-mode.css')
  const root = declarations(vars, ':root')
  const legacy = declarations(vars, 'html:not([data-theme=dark])')
  const shared = declarations(vars, 'html[data-theme=dark]')
  const lightScope = [legacy, root]
  const darkVars = { ...declarations(vars, 'html[data-theme=dark]'), ...declarations(dark, 'html[data-theme=dark]') }
  const darkScope = [darkVars, shared, root]
  return {
    light: { vars: lightScope, page: resolve('var(--body-background)', lightScope) },
    dark: { vars: darkScope, page: resolve('var(--body-background)', darkScope) },
  }
}

module.exports = { CSS, declarations, resolve, parseColor, contrast, themes }
