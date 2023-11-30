'use strict'

const eslint = require('gulp-eslint')
const vfs = require('vinyl-fs')
const gulpIf = require('gulp-if')

const eslintConfig = {
  rules: {
    'max-len': ['error', { code: 200 }],
  },
}

module.exports = (files) => (done) =>
  vfs
    .src(files)
    .pipe(gulpIf((file) => !file.path.includes('vendor'), eslint(eslintConfig)))
    .pipe(eslint.format())
    .pipe(eslint.failAfterError())
    .on('error', done)
