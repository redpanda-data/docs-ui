'use strict'

// Admonition labels (and their icons, which share the label color) and body
// text are at least 4.5:1 on the admonition background in light and dark,
// and each admonition keeps its own hue and icon.

const test = require('node:test')
const assert = require('node:assert/strict')
const { CSS, resolve, contrast, themes } = require('./contrast')

const TYPES = ['note', 'tip', 'important', 'caution', 'warning']
const MIN = 4.5
const THEMES = themes()

function failures (theme) {
  const { vars, page } = THEMES[theme]
  const out = []
  for (const type of TYPES) {
    const bg = resolve(`var(--admonition-${type}-bg)`, vars)
    for (const part of ['fg', 'text']) {
      const color = resolve(`var(--admonition-${type}-${part})`, vars)
      const ratio = contrast(color, bg, page)
      if (ratio < MIN) out.push(`${theme} ${type} ${part === 'fg' ? 'label' : 'text'}: ${color} on ${bg} is ${ratio.toFixed(2)}:1`)
    }
  }
  return out
}

test('every admonition declares fg, bg, border, and text in light and dark', () => {
  const missing = []
  for (const theme of ['light', 'dark']) {
    for (const type of TYPES) {
      for (const part of ['fg', 'bg', 'border', 'text']) {
        try { resolve(`var(--admonition-${type}-${part})`, THEMES[theme].vars) } catch { missing.push(`${theme} --admonition-${type}-${part}`) }
      }
    }
    if (theme === 'dark') {
      for (const type of TYPES) if (!THEMES.dark.vars[0][`--admonition-${type}-fg`]) missing.push(`dark --admonition-${type}-fg is not set for dark mode`)
    }
  }
  assert.deepEqual(missing, [])
})

test('light: admonition labels and text are at least 4.5:1', () => {
  assert.deepEqual(failures('light'), [])
})

test('dark: admonition labels and text are at least 4.5:1', () => {
  assert.deepEqual(failures('dark'), [])
})

test('doc.css colors each label and icon from its own tokens, and NOTE and IMPORTANT differ', () => {
  const doc = CSS('src/css/doc.css')
  for (const type of TYPES) {
    const rule = doc.match(new RegExp(`\\.admonitionblock\\.${type} \\.icon \\{([^}]*)\\}`))
    assert.ok(rule, `no .admonitionblock.${type} .icon rule`)
    assert.match(rule[1], new RegExp(`color:\\s*var\\(--admonition-${type}-fg\\)`), `${type} label color`)
  }
  const icon = (type) => (doc.match(new RegExp(`\\.icon-${type} \\{\\s*--admonition-icon:\\s*var\\((--[\\w-]+)\\)`)) || [])[1]
  const icons = TYPES.map(icon)
  assert.deepEqual(icons, ['--icon-info', '--icon-check-circle', '--icon-important', '--icon-triangle', '--icon-octagon'])
  assert.equal(new Set(icons).size, TYPES.length, 'each admonition has its own icon')
})
