'use strict'

// The explorer ships outside site.js and site.css. 27-iceberg-explorer.js
// fetches its stylesheet, then its script, only when the page has a mount.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { page, mount } = require('./helpers/dom')

const ROOT = path.join(__dirname, '../..')
const LOADER = fs.readFileSync(path.join(ROOT, 'src/js/27-iceberg-explorer.js'), 'utf8')
const siteScript = '<script id="site-script" src="../../_/js/site.js" data-ui-root-path="../../_"></script>'

function assets (doc) {
  return [...doc.head.querySelectorAll('[data-iceberg-explorer-asset]')].map((el) => el.getAttribute('src') || el.getAttribute('href'))
}

test('a page without a mount fetches nothing', async () => {
  const { doc } = await page(siteScript + '<p>No explorer here.</p>', { src: LOADER })
  assert.deepStrictEqual(assets(doc), [])
})

test('a page with mounts fetches the stylesheet, then the script, once', async () => {
  const { doc, window } = await page(siteScript + mount() + mount(), { src: LOADER })
  assert.deepStrictEqual(assets(doc), ['../../_/css/iceberg-explorer.css'])
  const link = doc.head.querySelector('link[data-iceberg-explorer-asset]')
  assert.strictEqual(link.rel, 'stylesheet')
  link.onload()
  link.onerror()
  assert.deepStrictEqual(assets(doc), ['../../_/css/iceberg-explorer.css', '../../_/js/vendor/iceberg-explorer.js'])
  // Running the loader again (another init path) adds nothing.
  window.eval(LOADER)
  assert.strictEqual(assets(doc).length, 2)
})

test('a stylesheet that fails to load still lets the script start', async () => {
  const { doc } = await page(siteScript + mount(), { src: LOADER })
  doc.head.querySelector('link[data-iceberg-explorer-asset]').onerror()
  assert.strictEqual(assets(doc)[1], '../../_/js/vendor/iceberg-explorer.js')
})

test('the build ships the explorer as its own files, not in site.js or site.css', () => {
  assert.ok(!/@import "iceberg-explorer\.css"/.test(fs.readFileSync(path.join(ROOT, 'src/css/site.css'), 'utf8')))
  assert.match(fs.readFileSync(path.join(ROOT, 'gulp.d/tasks/build.js'), 'utf8'), /'css\/iceberg-explorer\.css'/)
  assert.strictEqual(fs.readFileSync(path.join(ROOT, 'src/js/vendor/iceberg-explorer.bundle.js'), 'utf8').trim(), "require('../iceberg-explorer.js')")
  // site.js is every src/js/<n>-*.js file; the explorer itself is not one.
  const siteModules = fs.readdirSync(path.join(ROOT, 'src/js')).filter((f) => /^\d+-.*\.js$/.test(f))
  for (const f of siteModules) {
    const src = fs.readFileSync(path.join(ROOT, 'src/js', f), 'utf8')
    assert.ok(!/renderSchema|parseSections/.test(src), `${f} carries explorer code`)
  }
  assert.ok(LOADER.length < 4000, `the loader is ${LOADER.length} bytes`)
})
