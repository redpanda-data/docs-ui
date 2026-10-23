'use strict'
/**
 * 33-solution-productionize.js reaches site.js. The build concatenates only
 * src/js files that match its glob (gulp.d/tasks/build.js), so a misnamed file
 * would leave the card without its buttons and no error. Same check as
 * tests/solution-quiz/bundle.test.js, for this script.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '../..')
const SRC = path.join(ROOT, 'src')
const FILE = 'js/33-solution-productionize.js'
const BUILT = path.join(ROOT, 'public/_/js/site.js')

function siteGlob () {
  const build = fs.readFileSync(path.join(ROOT, 'gulp.d/tasks/build.js'), 'utf8')
  const match = /\.src\('(js\/[^']+)'[^)]*\)\s*\.pipe\(bundle\(/.exec(build)
  assert.ok(match, 'could not find the site.js glob in gulp.d/tasks/build.js')
  return match[1]
}

function fromGlobStream (name) {
  const resolve = (pkg, from) => path.dirname(require.resolve(pkg + '/package.json', { paths: [from] }))
  const glob = resolve('glob', resolve('glob-stream', resolve('vinyl-fs', ROOT)))
  return require(name === 'glob' ? glob : require.resolve(name, { paths: [glob] }))
}

test('the site.js glob picks up the productionize script', () => {
  const files = fromGlobStream('glob').sync(siteGlob(), { cwd: SRC })
  assert.ok(files.includes(FILE), `${FILE} does not match ${siteGlob()}`)
})

function builtSkip () {
  if (!fs.existsSync(BUILT)) return 'no build at public/_/js/site.js (npx gulp build)'
  if (fs.statSync(BUILT).mtimeMs + 1000 < fs.statSync(path.join(SRC, FILE)).mtimeMs) return 'public/_/js/site.js is older than the source (npx gulp build)'
  return false
}

test('the built site.js carries the card script', { skip: builtSkip() }, () => {
  const built = fs.readFileSync(BUILT, 'utf8')
  assert.ok(built.includes('__solutionProductionize'), 'window.__solutionProductionize is not in site.js')
  assert.ok(built.includes('data-sol-productionize-plan'), 'the card wiring is not in site.js')
})
