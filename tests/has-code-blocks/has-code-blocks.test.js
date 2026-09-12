/**
 * head-scripts.hbs loads Prism (core + Bloblang grammar + two plugins) and the
 * tabs script only when the article needs them (has-code-blocks helper). The
 * home and component landing pages have no code yet paid ~200 ms of script
 * evaluation for it on every visit. The helper must fail open: with nothing to
 * inspect it says "yes" so no page can lose highlighting by accident.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.join(__dirname, '../..')
const helper = require(path.join(ROOT, 'src/helpers/has-code-blocks.js'))
const call = (page) => helper({ data: { root: { page } } })

test('pages with a <pre>, a tabset, or a callout list need the code runtime', () => {
  assert.equal(call({ contents: Buffer.from('<p>x</p><pre class="highlight"><code>rpk</code></pre>') }), true)
  assert.equal(call({ contents: Buffer.from('<div class="listingblock"><div class="content"><pre>plain</pre></div></div>') }), true)
  assert.equal(call({ contents: '<div class="openblock tabs is-loading"><div class="content"></div></div>' }), true)
  assert.equal(call({ contents: '<div class="tabset"></div>' }), true)
  assert.equal(call({ contents: '<div class="colist arabic"><table></table></div>' }), true)
})

test('landing pages without code skip it', () => {
  assert.equal(call({ contents: Buffer.from('<section class="home-hero"><h1>Hi</h1><p>Prefer <code>rpk</code>.</p></section>') }), false)
  assert.equal(call({ contents: '<p>The tabs on the left prefetch nothing.</p>' }), false, 'prose mentioning tabs is not a tabset')
  assert.equal(call({ contents: '<span class="pretty">x</span>' }), false, '<pre> must be a tag, not a prefix')
})

test('fails open when there is nothing to inspect', () => {
  assert.equal(call(undefined), true)
  assert.equal(call({}), true)
  assert.equal(call({ contents: null }), true)
})

test('head-scripts.hbs gates the Prism and tabs scripts on the helper', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/partials/head-scripts.hbs'), 'utf8')
  const gate = src.indexOf('(has-code-blocks)')
  assert.ok(gate > 0, 'helper is called')
  const block = src.slice(gate, src.indexOf('{{/if}}', gate))
  for (const script of ['prism-core.js', 'prism-bloblang.js', 'prism-line-numbers-plugin.js', 'prism-line-highlight-plugin.js', 'vendor/tabs.js', 'prism.min.css']) {
    assert.ok(block.includes(script), `${script} is inside the gated block`)
  }
})
