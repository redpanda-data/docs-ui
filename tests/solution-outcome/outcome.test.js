'use strict'
/**
 * The outcome diagram on a solution overview (solution-outcome.hbs and the
 * solution-outcome helper):
 *  - the helper resolves :page-solution-outcome-image: as an image of the
 *    page's own module and returns the SVG to inline, with the root <svg>
 *    hidden from screen readers;
 *  - the partial names it with :page-solution-outcome-alt: and renders
 *    nothing without the attribute or when the image does not resolve;
 *  - the layout puts it after the metadata panel and the first paragraph of
 *    the introduction (split-after-first-paragraph), before the Steps list;
 *  - solutions.css sets every --oc-* color for light and for
 *    html[data-theme="dark"], which is what makes it follow the site toggle.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Handlebars = require('handlebars')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const outcome = require('../../src/helpers/solution-outcome.js')

const SVG = `<?xml version="1.0" encoding="UTF-8"?>
<!-- drawn by hand -->
<svg xmlns="http://www.w3.org/2000/svg" class="oc" viewBox="0 0 640 332" role="img" aria-labelledby="oc-title oc-desc">
  <title id="oc-title">What it delivers</title>
  <desc id="oc-desc">Events in, outcomes out.</desc>
  <text>Live leaderboard</text>
</svg>
`

function catalog (files) {
  const calls = []
  return {
    calls,
    resolveResource (spec, context, family, permitted) {
      calls.push({ spec, context, family, permitted })
      const name = spec.replace(/^image\$/, '')
      const key = `${context.component}:${context.module}:${name}`
      return files[key]
    },
  }
}

const page = { component: { name: 'solutions' }, version: '', module: 'multiplayer-gaming', url: '/solutions/multiplayer-gaming/', src: { path: 'modules/multiplayer-gaming/pages/index.adoc' } }
const svgFile = { contents: Buffer.from(SVG), pub: { url: '/solutions/multiplayer-gaming/_images/outcome.svg' } }
const quiet = { warn () {} }

test('resolves the image in the page\'s own module and inlines it', () => {
  const contentCatalog = catalog({ 'solutions:multiplayer-gaming:outcome.svg': svgFile })
  const result = outcome('outcome.svg', { data: { root: { page, contentCatalog, logger: quiet } } })
  assert.deepEqual(contentCatalog.calls[0], {
    spec: 'image$outcome.svg',
    context: { component: 'solutions', version: '', module: 'multiplayer-gaming' },
    family: 'image',
    permitted: ['image'],
  })
  assert.equal(result.src, '/solutions/multiplayer-gaming/_images/outcome.svg')
  assert.ok(result.svg.startsWith('<svg '), 'the XML prolog and comments are stripped')
  assert.ok(!result.svg.includes('<?xml'))
  assert.ok(!result.svg.includes('drawn by hand'))
  assert.match(result.svg, /^<svg [^>]*aria-hidden="true" focusable="false">/)
  assert.doesNotMatch(result.svg.split('>')[0], /role=|aria-labelledby=/)
  assert.ok(result.svg.includes('class="oc"'), 'the class the theme rules key on is kept')
  assert.ok(result.svg.includes('<title id="oc-title">'), 'title and desc stay for the standalone file')
})

test('a missing image warns and renders nothing', () => {
  const warnings = []
  const result = outcome('nope.svg', { data: { root: { page, contentCatalog: catalog({}), logger: { warn: (m) => warnings.push(m) } } } })
  assert.equal(result, undefined)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /page-solution-outcome-image "nope.svg"/)
})

test('an empty attribute, a non-SVG, and a preview build without a catalog', () => {
  assert.equal(outcome('', { data: { root: { page } } }), undefined)
  assert.equal(outcome(undefined, { data: { root: { page } } }), undefined)
  const png = { contents: Buffer.from('x'), pub: { url: '/solutions/x/_images/outcome.png' } }
  assert.deepEqual(outcome('outcome.png', { data: { root: { page, contentCatalog: catalog({ 'solutions:multiplayer-gaming:outcome.png': png }) } } }), { src: '/solutions/x/_images/outcome.png' })
  assert.deepEqual(outcome('outcome.svg', { data: { root: { page } } }), { src: 'outcome.svg' })
})

function render (attributes, contentCatalog) {
  const hbs = Handlebars.create()
  hbs.registerHelper('solution-outcome', outcome)
  hbs.registerHelper('relativize', require('../../src/helpers/relativize.js'))
  const tpl = hbs.compile(read('src/partials/solution-outcome.hbs'))
  return tpl({}, { data: { root: { page: { ...page, attributes }, contentCatalog, logger: quiet } } })
}

test('the partial names the inlined diagram with the alt text', () => {
  const html = render(
    { 'solution-outcome-image': 'outcome.svg', 'solution-outcome-alt': 'Game events flow into Redpanda & out come results.' },
    catalog({ 'solutions:multiplayer-gaming:outcome.svg': svgFile })
  )
  assert.match(html, /<figure class="sol-outcome is-before-toc">/)
  assert.match(html, /<div class="sol-outcome-art" role="img" aria-label="Game events flow into Redpanda &amp; out come results.">/)
  assert.match(html, /<svg [^>]*aria-hidden="true"/)
  assert.ok(html.includes('<text>Live leaderboard</text>'), 'the SVG is inlined, not escaped')
})

test('the partial renders nothing without the attribute or the image', () => {
  assert.equal(render({}, catalog({})).trim(), '')
  assert.equal(render({ 'solution-outcome-image': 'missing.svg' }, catalog({})).trim(), '')
})

test('the overview layout puts the diagram after the metadata panel and the first paragraph', () => {
  const layout = read('src/layouts/solution.hbs')
  const meta = layout.indexOf('{{> solution-meta')
  const first = layout.indexOf('{{{intro.before}}}')
  const diagram = layout.indexOf('{{> solution-outcome')
  const rest = layout.indexOf('{{{intro.after}}}')
  const steps = layout.indexOf('{{> solution-steps')
  assert.ok(meta > -1 && first > meta && diagram > first && rest > diagram && steps > rest,
    'expected the metadata panel, the first paragraph, the outcome diagram, the rest of the introduction, then Steps')
  assert.ok(!read('src/layouts/solution-step.hbs').includes('solution-outcome'), 'step pages do not show it')
})

test('split-after-first-paragraph ends the first part after the first paragraph block', () => {
  const split = require('../../src/helpers/split-after-first-paragraph.js')
  const html = '<div id="preamble">\n<div class="sectionbody">\n<div class="paragraph">\n<p>A studio runs.</p>\n</div>\n<div class="paragraph">\n<p>Second.</p>\n</div>\n</div>\n</div>'
  const { before, after } = split(html)
  assert.ok(before.endsWith('<p>A studio runs.</p>\n</div>'))
  assert.ok(after.startsWith('\n<div class="paragraph">\n<p>Second.</p>'))
  assert.equal(before + after, html)
  const titled = split('<div class="paragraph lead"><div class="title">T</div><p>One.</p></div><p>x</p>')
  assert.equal(titled.before, '<div class="paragraph lead"><div class="title">T</div><p>One.</p></div>')
  assert.deepEqual(split('<div class="ulist"><ul><li><p>a</p></li></ul></div>'), { before: '<div class="ulist"><ul><li><p>a</p></li></ul></div>', after: '' })
  assert.deepEqual(split(undefined), { before: '', after: '' })
})

test('solutions.css sets every diagram color for light and for the dark theme', () => {
  const css = read('src/css/solutions.css')
  const block = (selector) => {
    const at = css.indexOf(`${selector} {`)
    assert.ok(at > -1, `missing ${selector}`)
    return css.slice(at, css.indexOf('}', at))
  }
  const names = (text) => [...text.matchAll(/(--oc-[a-z-]+):/g)].map((m) => m[1]).sort()
  const light = names(block('.sol-outcome .oc'))
  const dark = names(block('html[data-theme="dark"] .sol-outcome .oc'))
  assert.ok(light.length >= 10, `expected the full palette, found ${light.join(', ')}`)
  assert.deepEqual(dark, light, 'the dark theme sets the same colors as the light one')
})
