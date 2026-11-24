'use strict'

// Every meaning (Enterprise, Beta, Preview, ...) has --meaning-NAME-fg, -bg,
// and -border tokens in both themes, and its text is readable: fg on its own
// bg, and fg straight on the page background, are each at least 4.5:1
// (WCAG AA for small text, which every badge is).

const test = require('node:test')
const assert = require('node:assert/strict')
const { resolve, contrast, themes } = require('./contrast')

const MEANINGS = ['enterprise', 'beta', 'preview', 'limited', 'deprecated', 'eol', 'eol-soon', 'new', 'since',
  'cloud', 'self-managed', 'certified', 'community', 'use-case', 'neutral']
const MIN = 4.5
const THEMES = themes()

function failures (theme) {
  const { vars, page } = THEMES[theme]
  const out = []
  for (const name of MEANINGS) {
    const fg = resolve(`var(--meaning-${name}-fg)`, vars)
    const bg = resolve(`var(--meaning-${name}-bg)`, vars)
    const onBg = contrast(fg, bg, page)
    const onPage = contrast(fg, page, page)
    if (onBg < MIN) out.push(`${theme} ${name}: fg ${fg} on bg ${bg} is ${onBg.toFixed(2)}:1`)
    if (onPage < MIN) out.push(`${theme} ${name}: fg ${fg} on page ${page} is ${onPage.toFixed(2)}:1`)
  }
  return out
}

test('page backgrounds resolve to the site colors', () => {
  assert.equal(THEMES.light.page.toLowerCase(), '#fff')
  assert.equal(THEMES.dark.page.toLowerCase(), '#101828')
})

test('every meaning declares fg, bg, and border in light and dark', () => {
  const missing = []
  for (const theme of ['light', 'dark']) {
    for (const name of MEANINGS) {
      for (const part of ['fg', 'bg', 'border']) {
        try { resolve(`var(--meaning-${name}-${part})`, THEMES[theme].vars) } catch { missing.push(`${theme} --meaning-${name}-${part}`) }
      }
    }
  }
  assert.deepEqual(missing, [])
})

test('dark values are set for dark mode, not inherited from light', () => {
  const [, , root] = THEMES.dark.vars
  const inherited = MEANINGS.filter((n) => THEMES.dark.vars[0][`--meaning-${n}-fg`] === undefined && root[`--meaning-${n}-fg`])
  assert.deepEqual(inherited, [])
})

test('light: every fg is at least 4.5:1 on its bg and on the page', () => {
  assert.deepEqual(failures('light'), [])
})

test('dark: every fg is at least 4.5:1 on its bg and on the page', () => {
  assert.deepEqual(failures('dark'), [])
})

// Negative control: the measurement can fail
test('the contrast check flags a low-contrast pair', () => {
  assert.ok(contrast('#999999', '#ffffff', '#ffffff') < MIN)
  assert.ok(contrast('#ffb59e', 'rgba(226, 64, 27, 0.14)', '#ffffff') < MIN, 'a dark fg composited over the light page fails')
  assert.ok(Math.abs(contrast('#000', '#fff', '#fff') - 21) < 0.01)
})
