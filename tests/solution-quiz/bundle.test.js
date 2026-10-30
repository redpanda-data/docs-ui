'use strict'
/**
 * 27-solution-quiz-source.js reaches site.js. The build concatenates only
 * src/js files that match its glob (gulp.d/tasks/build.js), so a name such as
 * 27a-solution-quiz-source.js would be left out without an error and the quiz
 * would quietly fall back to the title and rule.
 *
 * The glob is read from build.js and matched with the glob package vinyl-fs
 * uses, so the test follows the build. The built site.js is checked too when
 * a build is present (npx gulp build or npx gulp bundle).
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '../..')
const SRC = path.join(ROOT, 'src')
const FILE = 'js/27-solution-quiz-source.js'
const BUILT = path.join(ROOT, 'public/_/js/site.js')

function siteGlob () {
  const build = fs.readFileSync(path.join(ROOT, 'gulp.d/tasks/build.js'), 'utf8')
  const match = /\.src\('(js\/[^']+)'[^)]*\)\s*\.pipe\(bundle\(/.exec(build)
  assert.ok(match, 'could not find the site.js glob in gulp.d/tasks/build.js')
  return match[1]
}

// glob, and its minimatch, as resolved from glob-stream: the package vinyl-fs
// hands the pattern to.
function fromGlobStream (name) {
  const resolve = (pkg, from) => path.dirname(require.resolve(pkg + '/package.json', { paths: [from] }))
  const glob = resolve('glob', resolve('glob-stream', resolve('vinyl-fs', ROOT)))
  return require(name === 'glob' ? glob : require.resolve(name, { paths: [glob] }))
}

test('the site.js glob picks up the quiz source script', () => {
  const pattern = siteGlob()
  const files = fromGlobStream('glob').sync(pattern, { cwd: SRC })
  assert.ok(files.includes(FILE), `${FILE} does not match ${pattern}`)
  assert.ok(files.includes('js/28-solution-progress.js'), 'control: the progress script matches')
})

test('control: a lettered name would be left out', () => {
  const minimatch = fromGlobStream('minimatch')
  assert.equal(minimatch('js/27a-solution-quiz-source.js', siteGlob()), false)
  assert.equal(minimatch(FILE, siteGlob()), true)
})

function builtSkip () {
  if (!fs.existsSync(BUILT)) return 'no build at public/_/js/site.js (npx gulp build)'
  // The build stamps site.js with its newest source's mtime, rounded, so allow
  // a second.
  if (fs.statSync(BUILT).mtimeMs + 1000 < fs.statSync(path.join(SRC, FILE)).mtimeMs) return 'public/_/js/site.js is older than the source (npx gulp build)'
  return false
}

test('the built site.js carries the quiz source reader', { skip: builtSkip() }, () => {
  const built = fs.readFileSync(BUILT, 'utf8')
  // Property names survive minification; local function names do not.
  assert.ok(built.includes('extractStepSource'), 'extractStepSource is not in site.js')
  assert.ok(built.includes('__solutionQuiz'), 'window.__solutionQuiz is not in site.js')
  assert.ok(built.includes('STEP SOURCE BEGIN'), 'the STEP SOURCE markers are not in site.js')
})
