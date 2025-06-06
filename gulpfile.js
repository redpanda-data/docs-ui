'use strict'

const { parallel, series, watch } = require('gulp')
const createTask = require('./gulp.d/lib/create-task')
const exportTasks = require('./gulp.d/lib/export-tasks')
const log = require('fancy-log')
const { exec } = require('child_process')
const path = require('path')
const gulp = require('gulp')

const bundleName = 'ui'
const buildDir = 'build'
const previewSrcDir = 'preview-src'
const previewDestDir = 'public'
const srcDir = 'src'
const destDir = `${previewDestDir}/_`

const { reload: livereload } = process.env.LIVERELOAD === 'true' ? require('gulp-connect') : {}
const serverConfig = { host: '0.0.0.0', port: 5252, livereload }

const task = require('./gulp.d/tasks')
const glob = {
  all: [srcDir, previewSrcDir],
  css: `${srcDir}/css/**/*.css`,
  js: ['gulpfile.js', 'gulp.d/**/*.js', `${srcDir}/{helpers,js}/**/*.js`],
}

const rapidocSrc = 'node_modules/rapidoc/dist/rapidoc-min.js'
const rapidocDest = path.join(srcDir, 'static')

function copyRapidoc () {
  return gulp.src(rapidocSrc)
    .pipe(gulp.dest(rapidocDest))
}

const cleanTask = createTask({
  name: 'clean',
  desc: 'Clean files and folders generated by build',
  call: task.remove(['build', 'public']),
})

const lintCssTask = createTask({
  name: 'lint:css',
  desc: 'Lint the CSS source files using stylelint (standard config)',
  call: task.lintCss(glob.css),
})

const lintJsTask = createTask({
  name: 'lint:js',
  desc: 'Lint the JavaScript source files using eslint (JavaScript Standard Style)',
  call: task.lintJs(glob.js),
})

const lintTask = createTask({
  name: 'lint',
  desc: 'Lint the CSS and JavaScript source files',
  call: parallel(lintCssTask, lintJsTask),
})

const formatTask = createTask({
  name: 'format',
  desc: 'Format the JavaScript source files using prettify (JavaScript Standard Style)',
  call: task.format(glob.js),
})

const buildTask = createTask({
  name: 'build',
  desc: 'Build and stage the UI assets for bundling',
  call: task.build(
    srcDir,
    destDir,
    process.argv.slice(2).some((name) => name.startsWith('preview'))
  ),
})

const buildWasmTask = createTask({
  name: 'build:wasm',
  desc: 'Build the WebAssembly (.wasm) file using Go and the go.mod in blobl-editor/wasm',
  call: (done) => {
    const wasmDir = path.join(__dirname, 'blobl-editor', 'wasm')
    // Absolute path for the output file (go build -o requires a file path).
    const wasmOutputPath = path.join(__dirname, srcDir, 'static', 'blobl.wasm')

    const envVars = {
      ...process.env,
      GOOS: 'js',
      GOARCH: 'wasm',
    }

    const command = `go build -o "${wasmOutputPath}" .`

    exec(command, { cwd: wasmDir, env: envVars }, (err, stdout, stderr) => {
      if (err) {
        log.error('Error building WASM:', stderr)
        done(err)
        return
      }
      log.info('WebAssembly built successfully:', stdout)
      done()
    })
  },
})

const bundleBuildTask = createTask({
  name: 'bundle:build',
  call: series(cleanTask, lintTask, buildWasmTask, copyRapidoc, buildTask),
})

const bundlePackTask = createTask({
  name: 'bundle:pack',
  desc: 'Create a bundle of the staged UI assets for publishing',
  call: task.pack(
    destDir,
    buildDir,
    bundleName,
    (bundlePath) => !process.env.CI && log(`Antora option: --ui-bundle-url=${bundlePath}`)
  ),
})

const bundleTask = createTask({
  name: 'bundle',
  desc: 'Clean, lint, build, and bundle the UI for publishing',
  call: series(bundleBuildTask, bundlePackTask),
})

const packTask = createTask({
  name: 'pack',
  desc: '(deprecated; use bundle instead)',
  call: series(bundleTask),
})

const buildPreviewPagesTask = createTask({
  name: 'preview:build-pages',
  call: task.buildPreviewPages(srcDir, previewSrcDir, previewDestDir, livereload),
})

const previewBuildTask = createTask({
  name: 'preview:build',
  desc: 'Process and stage the UI assets and generate pages for the preview',
  call: series(buildWasmTask, copyRapidoc, buildTask, buildPreviewPagesTask),
})

const previewServeTask = createTask({
  name: 'preview:serve',
  call: task.serve(previewDestDir, serverConfig, () => watch(glob.all, previewBuildTask)),
})

const previewTask = createTask({
  name: 'preview',
  desc: 'Generate a preview site and launch a server to view it',
  call: series(previewBuildTask, previewServeTask),
})

module.exports = exportTasks(
  bundleTask,
  cleanTask,
  lintTask,
  formatTask,
  buildWasmTask,
  buildTask,
  bundleTask,
  bundlePackTask,
  previewTask,
  previewBuildTask,
  packTask
)
