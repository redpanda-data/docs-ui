'use strict'

const esbuild = require('esbuild')
const glob = require('glob')
const path = require('path')
const log = require('fancy-log')
const fs = require('fs')

/**
 * Bundles all React component files in the specified source directory using esbuild and outputs the bundled files to the destination directory.
 *
 * Finds all `.js` and `.jsx` files recursively in the source directory, bundles each file individually with esbuild (including minification in production and source maps), and writes the output as IIFE bundles targeting modern browsers.
 *
 * @param {Object} options - Options for bundling.
 * @param {string} options.srcDir - Path to the directory containing React component files.
 * @param {string} options.destDir - Path to the directory where bundled files will be written.
 * @returns {Promise<void>} Resolves when all bundles have been processed.
 */
async function bundleAllReactTask ({ srcDir, destDir }) {
  // Find all JS and JSX files in the source directory
  const entries = glob.sync(path.join(srcDir, '**/*.{js,jsx}'))

  if (entries.length === 0) {
    log.warn(`No React modules found in ${srcDir}`)
    return Promise.resolve()
  }

  // Make sure destination directory exists
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true })
  }

  // Bundle each entry file separately
  const bundlePromises = entries.map(async (entryFile) => {
    const base = path.basename(entryFile).replace(/\.(jsx|js)$/, '')
    const outName = `${base}.bundle.js`
    const outPath = path.join(destDir, outName)

    try {
      // Build with esbuild
      await esbuild.build({
        entryPoints: [entryFile],
        bundle: true,
        minify: process.env.NODE_ENV === 'production',
        sourcemap: true,
        outfile: outPath,
        format: 'iife', // Immediately Invoked Function Expression format
        target: ['es2020'],
        platform: 'browser',
        loader: {
          '.js': 'jsx', // Treat .js files as JSX too
          '.jsx': 'jsx',
        },
        define: {
          'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
        },
      })
      log.info(`Built ${outName}`)
    } catch (error) {
      log.error(`Error building ${base}:`, error.message)
    }
  })

  return Promise.all(bundlePromises)
}

module.exports = ({ srcDir, destDir }) => () => bundleAllReactTask({ srcDir, destDir })
