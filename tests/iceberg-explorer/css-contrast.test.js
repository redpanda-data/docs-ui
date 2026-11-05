'use strict'

// Small explorer text (card headings, labels, tags, optional/required, tree
// punctuation) must reach WCAG AA 4.5:1 on the card in both themes. Colors are
// resolved from the explorer tokens, falling back to the site tokens in
// vars.css and dark-mode.css, so a change to either side is caught.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

const read = (f) => fs.readFileSync(path.join(__dirname, '../../src/css', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// Custom properties declared in every top-level block with one of the given
// selectors in its selector list, later blocks winning.
function props (css, selectors) {
  const out = {}
  css.replace(/([^{}]+)\{([^{}]*)\}/g, (m, sel, body) => {
    if (!sel.split(',').some((x) => selectors.includes(x.trim()))) return
    body.replace(/(--[\w-]+)\s*:\s*([^;]+);/g, (mm, k, v) => { out[k] = v.trim() })
  })
  return out
}

const vars = read('vars.css')
const site = props(vars, [':root', 'html:not([data-theme=dark])'])
const siteDark = Object.assign(props(vars, [':root', 'html[data-theme=dark]']),
  props(read('dark-mode.css'), ['html[data-theme=dark]']))
const ice = read('iceberg-explorer.css')
const iceLight = props(ice, ['[data-iceberg-explorer]'])
const iceDark = Object.assign({}, iceLight, props(ice, ['[data-theme="dark"] [data-iceberg-explorer]']))

function resolve (value, scope, depth = 0) {
  assert.ok(depth < 20, 'var() loop resolving ' + value)
  const m = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(value.trim())
  if (!m) return value.trim()
  if (scope[m[1]] !== undefined) return resolve(scope[m[1]], scope, depth + 1)
  assert.ok(m[2], `${m[1]} is undefined and has no fallback`)
  return resolve(m[2], scope, depth + 1)
}

function rgba (hex) {
  const h = hex.replace('#', '')
  const full = h.length === 3 || h.length === 4 ? h.split('').map((c) => c + c).join('') : h
  const n = full.match(/../g).map((x) => parseInt(x, 16))
  return { rgb: n.slice(0, 3), a: n.length === 4 ? n[3] / 255 : 1 }
}
const blend = (fg, a, bg) => fg.map((c, i) => c * a + bg[i] * (1 - a))
function lum (rgb) {
  const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

const THEMES = {
  light: { scope: Object.assign({}, site, iceLight), page: '--body-background' },
  dark: { scope: Object.assign({}, siteDark, iceDark), page: '--body-background' },
}

function card (theme) {
  const t = THEMES[theme]
  const page = rgba(resolve(`var(${t.page})`, t.scope)).rgb
  const panel = rgba(resolve('var(--ice-panel)', t.scope))
  return blend(panel.rgb, panel.a, page)
}

// Text tokens and the tint behind them (tags are 12% of their own color).
const TEXT = ['--ice-muted', '--ice-cyan', '--ice-green', '--ice-blue', '--ice-yellow', '--ice-purple', '--ice-error']
const TAGS = ['--ice-tag-info', '--ice-tag-real', '--ice-error']

for (const theme of Object.keys(THEMES)) {
  test(`small text reaches 4.5:1 on the card in ${theme} mode`, () => {
    const bg = card(theme)
    for (const tok of TEXT) {
      const fg = rgba(resolve(`var(${tok})`, THEMES[theme].scope)).rgb
      const r = ratio(fg, bg)
      assert.ok(r >= 4.5, `${tok} is ${r.toFixed(2)}:1 in ${theme} mode`)
    }
  })
  test(`tags reach 4.5:1 on their own tint in ${theme} mode`, () => {
    assert.match(ice, /background:\s*color-mix\(in sRGB, var\(--tag-fg\) 12%, transparent\)/)
    const bg = card(theme)
    for (const tok of TAGS) {
      const fg = rgba(resolve(`var(${tok})`, THEMES[theme].scope)).rgb
      const r = ratio(fg, blend(fg, 0.12, bg))
      assert.ok(r >= 4.5, `${tok} is ${r.toFixed(2)}:1 in ${theme} mode`)
    }
  })
}

test('fonts and accent come from tokens the docs site defines', () => {
  assert.ok(!/--code-font-family/.test(ice), '--code-font-family is not defined on docs pages; use --monospace-font-family')
  assert.ok(!/--product-color/.test(ice), '--product-color is not defined on docs pages')
  assert.ok(site['--monospace-font-family'], 'vars.css no longer defines --monospace-font-family')
  const accent = /--ice-accent:\s*var\((--[\w-]+)/.exec(ice)
  assert.ok(accent && site[accent[1]], `--ice-accent points at ${accent && accent[1]}, which vars.css does not define`)
})

test('placeholders are drawn at full opacity in the muted color', () => {
  assert.match(ice, /input::placeholder\s*\{[^}]*color:\s*var\(--ice-muted\)[^}]*opacity:\s*1/)
})
