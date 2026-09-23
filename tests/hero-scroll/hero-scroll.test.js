/**
 * A full-bleed hero clips decorative glows that are deliberately bigger than
 * the hero box. Clipping with `overflow: hidden` makes the hero a scroll
 * container, and in WebKit a touch that starts inside a scroll container with
 * overflowing content is latched to that container: because a hidden box can't
 * be scrolled by the user, the swipe does nothing and never reaches the page.
 * The hero IS the first screen on a phone, so the landing page looked frozen on
 * load until you tapped somewhere first. `overflow: clip` clips identically
 * without creating a scroll container.
 *
 * These are source assertions on purpose: the failure only shows up with real
 * touch input on a real WebKit build, which no headless runner here can send.
 * What is checkable, and what regressed, is the declaration itself.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.join(__dirname, '../..')

// Every hero that paints decorative layers outside its own box and therefore
// has to clip. .ch3-hero (component-home-v3.css) is absent by design: it clips
// in a separate .ch3-hero-bg layer that is pointer-events: none, so no touch
// ever lands in it.
const HEROES = [
  ['src/css/home.css', '.home-hero'],
  ['src/css/data-platform.css', '.dp-hero'],
  ['src/css/labs-home.css', '.labs-hero'],
]

const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

// The declarations of the first rule whose selector list contains exactly this
// selector. Naive on purpose: a selector chunk keeps only what follows the last
// brace, which drops any enclosing at-rule prelude.
function ruleBody (css, selector) {
  const chunks = stripComments(css).split('}')
  for (const chunk of chunks) {
    const brace = chunk.lastIndexOf('{')
    if (brace < 0) continue
    const selectors = chunk.slice(0, brace).split('{').pop().split(',').map((s) => s.trim())
    if (selectors.includes(selector)) return chunk.slice(brace + 1)
  }
  return null
}

const overflowValues = (body) =>
  [...body.matchAll(/(?:^|;)\s*overflow\s*:\s*([^;]+)/g)].map((m) => m[1].trim())

for (const [file, selector] of HEROES) {
  test(`${selector} clips without becoming a scroll container`, () => {
    const body = ruleBody(read(file), selector)
    assert.ok(body, `${selector} has a rule in ${file}`)
    const values = overflowValues(body)
    assert.ok(values.length, `${selector} sets overflow`)
    assert.equal(values.at(-1), 'clip', `${selector} ends on overflow: clip, not ${values.at(-1)}`)
    assert.equal(values.at(-2), 'hidden', `${selector} keeps overflow: hidden ahead of clip for Safari < 16`)
  })
}

test('no landing-page hero goes back to clipping with overflow: hidden alone', () => {
  const files = ['src/css/home.css', 'src/css/data-platform.css', 'src/css/labs-home.css', 'src/css/component-home-v3.css']
  const offenders = []
  for (const file of files) {
    const chunks = stripComments(read(file)).split('}')
    for (const chunk of chunks) {
      const brace = chunk.lastIndexOf('{')
      if (brace < 0) continue
      const selectors = chunk.slice(0, brace).split('{').pop().split(',').map((s) => s.trim())
      // A hero box itself, not its inner layers (-hero-bg, -hero-inner, ...).
      const heroBox = selectors.some((s) => /(^|[\s>])[.#][a-z0-9-]*-hero$/.test(s))
      if (!heroBox) continue
      const values = overflowValues(chunk.slice(brace + 1))
      // visible and clip are both fine: neither makes a scroll container.
      const last = values.at(-1)
      if (/^(hidden|auto|scroll)\b/.test(last || '')) offenders.push(`${file}: ${selectors.join(', ')} -> overflow: ${last}`)
    }
  }
  assert.deepEqual(offenders, [], 'heroes clip with overflow: clip so a first swipe still scrolls the page')
})
