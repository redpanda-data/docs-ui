'use strict'

const esbuild = require('esbuild')
const glob = require('glob')
const path = require('path')
const log = require('fancy-log')
const fs = require('fs')

const isDev = process.env.NODE_ENV === 'development'

// @kapaai/agent-react does `import { Prism } from 'react-syntax-highlighter'`,
// which is the build that bundles every refractor grammar (~780 KB minified).
// Point that one bare import at our shim, which registers a curated grammar
// set on PrismLight instead. Only the exact specifier is redirected; the
// package's own subpath imports (styles, prism-light) resolve normally.
const lightSyntaxHighlighterPlugin = {
  name: 'light-syntax-highlighter',
  setup (build) {
    build.onResolve({ filter: /^react-syntax-highlighter$/ }, () => ({
      path: path.join(__dirname, '..', '..', 'src', 'js', 'react', 'shims', 'react-syntax-highlighter.js'),
    }))
  },
}

/**
 * Bundles all React component files in the specified source directory using esbuild and outputs the bundled files
 * to the destination directory.
 *
 * Finds all `.js` and `.jsx` files recursively in the source directory, bundles each file individually with esbuild
 * (including minification in production and source maps), and writes the output as IIFE bundles targeting modern browsers.
 *
 * @param {Object} options - Options for bundling.
 * @param {string} options.srcDir - Path to the directory containing React component files.
 * @param {string} options.destDir - Path to the directory where bundled files will be written.
 * @returns {Promise<void>} Resolves when all bundles have been processed.
 */
async function bundleAllReactTask ({ srcDir, destDir }) {
  // Find all JS and JSX files in the source directory
  // shims/ holds drop-in replacements for third-party modules (see the resolve
  // plugin above); they are bundled into their importers, never on their own.
  const entries = glob.sync(path.join(srcDir, '**/*.{js,jsx}'), { ignore: ['**/shims/**'] })

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
        // Production by default. The release workflow never set NODE_ENV, so
        // every published AskAI.bundle.js shipped unminified with React's
        // development build (4.8 MB raw, 940 KB compressed, and dev-mode
        // rendering on the main thread). Opt into the dev build explicitly
        // with NODE_ENV=development when debugging the drawer.
        minify: !isDev,
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
          'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
        },
        // @kapaai/agent-core lazily imports zod-to-json-schema only when a tool
        // defines Zod-schema parameters; we register no tools, so leave it unresolved
        external: ['zod-to-json-schema'],
        plugins: [lightSyntaxHighlighterPlugin],
      })
      log.info(`Built ${outName}`)
    } catch (error) {
      log.error(`Error building ${base}:`, error.message)
      throw error // Propagate error to fail the build
    }
  })

  return Promise.all(bundlePromises)
}

module.exports = ({ srcDir, destDir }) => () => bundleAllReactTask({ srcDir, destDir })
