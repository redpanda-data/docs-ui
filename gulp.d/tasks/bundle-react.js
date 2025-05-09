'use strict'

const browserify = require('browserify')
const babelify = require('babelify')
const source = require('vinyl-source-stream')
const buffer = require('vinyl-buffer')
const sourcemaps = require('gulp-sourcemaps')
const glob = require('glob')
const merge = require('merge-stream')
const path = require('path')
const log = require('fancy-log')
const { dest } = require('gulp')

function bundleAllReactTask ({ srcDir, destDir }) {
  const entries = glob.sync(path.join(srcDir, '**/*.{js,jsx}'))
  if (entries.length === 0) {
    log.warn(`No React modules found in ${srcDir}`)
    return Promise.resolve()
  }

  const tasks = entries.map((entryFile) => {
    const base = path.basename(entryFile).replace(/\.(jsx|js)$/, '')
    const outName = `${base}.bundle.js`
    return browserify({ entries: entryFile, debug: true })
      .transform(babelify, {
        presets: ['@babel/preset-env', '@babel/preset-react'],
        sourceMaps: true,
      })
      .bundle()
      .on('error', (err) => {
        log.error(err)
        this.emit('end')
      })
      .pipe(source(outName))
      .pipe(buffer())
      .pipe(sourcemaps.init({ loadMaps: true }))
      .pipe(sourcemaps.write('.'))
      .pipe(dest(destDir))
  })

  return merge(tasks)
}

module.exports = ({ srcDir, destDir }) => () => bundleAllReactTask({ srcDir, destDir })
