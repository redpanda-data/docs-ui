/**
 * js/vendor/prism/prism-core.js is generated from the prismjs package and the
 * grammar list in gulp.d/prism-languages.js (see gulp.d/tasks/generate-prism.js).
 * It replaced a 677 KB download-page build carrying 230 grammars.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.join(__dirname, '../..')
const languages = require(path.join(ROOT, 'gulp.d/prism-languages.js'))
const generate = require(path.join(ROOT, 'gulp.d/tasks/generate-prism.js'))
const components = require('prismjs/components.json')

test('every listed grammar exists in the installed prismjs', () => {
  const unknown = languages.filter((id) => !components.languages[id])
  assert.deepEqual(unknown, [])
  assert.deepEqual([...new Set(languages)], languages, 'no duplicates')
})

test('the grammars the site relies on most are listed', () => {
  for (const id of ['bash', 'yaml', 'sql', 'json', 'python', 'go', 'javascript', 'markup', 'docker', 'promql']) {
    assert.ok(languages.includes(id), id)
  }
})

test('the generated file has core, the grammars, keep-markup, and nothing else', async () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prism-')), 'prism-core.js')
  await generate(out)()
  const js = fs.readFileSync(out, 'utf8')
  assert.match(js, /^\/\* eslint-disable \*\//)
  assert.match(js, /PrismJS \d+\.\d+\.\d+: core \+ \d+ grammars \+ keep-markup/)
  assert.ok(js.includes('Prism.languages.bash') || js.includes('languages.bash='), 'bash grammar')
  assert.ok(js.includes('languages.yaml'), 'yaml grammar')
  assert.ok(js.includes('keep-markup'), 'keep-markup plugin (editable placeholders depend on it)')
  assert.ok(!js.includes('languages.abap'), 'unlisted grammars are not bundled')
  assert.ok(!js.includes('languages.cobol'), 'unlisted grammars are not bundled')
  assert.ok(fs.statSync(out).size < 160 * 1024, `trimmed build stays small, got ${fs.statSync(out).size}`)
  // A grammar with a dependency pulls it in (docker needs nothing, but php
  // needs markup-templating): dependency order is resolved by prismjs itself.
  assert.ok(js.indexOf('markup-templating') < js.indexOf('languages.php'), 'dependencies precede dependents')
})

test('the generated file is not tracked and the build wires the task in', () => {
  const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
  assert.match(gitignore, /^src\/js\/vendor\/prism\/prism-core\.js$/m)
  const gulpfile = fs.readFileSync(path.join(ROOT, 'gulpfile.js'), 'utf8')
  assert.match(gulpfile, /generatePrismTask,\n\s+buildWasmTask/, 'runs in bundle:build before the assets are staged')
  assert.match(gulpfile, /series\(generatePrismTask, buildWasmTask/, 'and in preview:build')
})
