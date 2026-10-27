'use strict'

// Finds every AsciiDoc attribute the UI templates, helpers, and browser
// scripts read, and reports each one by the name a writer types (for
// example `page-beta`, not the `beta` key Antora exposes on page.attributes).
//
// ui-attributes.test.js compares the result with src/ui-attributes.json.
//
// Reads the scanner understands:
//   - page.attributes.X, page.attributes.[X], page.attributes['X'],
//     page.attributes?.['X'] (Antora strips the page- prefix, so the writer
//     name is page-X)
//   - <anything>.asciidoc.attributes.X and ['X'] (the writer name is X)
//   - (page-attribute "X") in templates (the writer name is X)
//   - template literals such as `whats-new-${i}-title`, reported as the
//     pattern whats-new-{n}-title
//   - helpers that receive an attributes object as a parameter, listed in
//     INDIRECT below
//   - {{#with <x>.attributes}} blocks, where {{key}}, {{#if key}}, and
//     {{#unless key}} inside the block read key
//
// Anything it cannot classify is returned in `unclassified` so the test fails
// instead of silently missing a read.

const fs = require('node:fs')
const path = require('node:path')

const SRC = path.join(__dirname, '..', '..', 'src')

// Helpers that read attribute keys from an object they are handed rather than
// from page.attributes directly. `vars` are the identifiers that hold the
// object; `prefixes` turn a key into the writer name (page.attributes keys
// need `page-`, asciidoc.attributes keys are used as is).
const INDIRECT = {
  'helpers/add-suggested-labs.js': { vars: ['attributes'], prefixes: ['page-'] },
  'helpers/list-related-labs.js': { vars: ['attributes'], prefixes: ['page-'] },
  'helpers/get-whats-new-color.js': { vars: ['attributes'], prefixes: ['page-'] },
  'helpers/is-eol.js': { vars: ['input'], prefixes: [''] },
  'helpers/version-status.js': { vars: ['attributes'], prefixes: [''] },
  // Checks component, page, and site attributes in turn.
  'helpers/get-kapa-source-groups.js': { vars: ['attrs'], prefixes: ['', 'page-'] },
  'helpers/get-ai-suggestions.js': { vars: ['attrs'], prefixes: [''] },
  'helpers/get-agent-suggestions.js': { vars: ['attrs'], prefixes: [''] },
  'helpers/aggregate-whats-new.js': { vars: ['attrs'], prefixes: [''] },
}

// Template helpers that may receive a whole attributes object, mapped to the
// helper file that reads from it (which must be in INDIRECT).
const HELPERS_TAKING_ATTRIBUTES = {
  'add-suggested-labs': 'helpers/add-suggested-labs.js',
  'list-related-labs': 'helpers/list-related-labs.js',
  'get-whats-new-color': 'helpers/get-whats-new-color.js',
  'is-eol': 'helpers/is-eol.js',
  'version-status': 'helpers/version-status.js',
}

const KEY = '[A-Za-z0-9_][A-Za-z0-9_-]*'
const QUOTED = '[\'"`]([^\'"`]+)[\'"`]'
// `?.` and `.` both allowed between the parts of an accessor chain.
const DOT = '\\??\\.'

function listFiles (dir, exts) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'vendor') continue
      out.push(...listFiles(full, exts))
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full)
    }
  }
  return out
}

function stripJsComments (text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function stripHbsComments (text) {
  return text.replace(/\{\{!--[\s\S]*?--\}\}/g, '').replace(/\{\{![\s\S]*?\}\}/g, '')
}

// `whats-new-${i}-title` -> `whats-new-{n}-title`
function normalizeKey (key) {
  return key.replace(/\$\{[^}]+\}/g, '{n}')
}

// For `{{#with <x>.attributes}}` opened at `open`, returns the text up to the
// matching `{{/with}}`, or undefined when the `with` has an `as |x|` alias or
// wraps more than the attributes object.
function withBlockBody (text, open, match) {
  const tagEnd = text.indexOf('}}', match.index)
  if (tagEnd < 0) return undefined
  if (!/^\{\{#with\s+[\w.]*\.attributes\s*\}\}$/.test(text.slice(open, tagEnd + 2))) return undefined
  const re = /\{\{#with\b|\{\{\/with\s*\}\}/g
  re.lastIndex = tagEnd + 2
  let depth = 1
  let m
  while ((m = re.exec(text))) {
    depth += m[0] === '{{#with' ? 1 : -1
    if (depth === 0) return text.slice(tagEnd + 2, m.index)
  }
  return undefined
}

function scan (srcDir = SRC) {
  const reads = new Map() // writer name -> Set of files
  const unclassified = []
  const add = (name, file) => {
    if (!reads.has(name)) reads.set(name, new Set())
    reads.get(name).add(file)
  }

  const templates = listFiles(path.join(srcDir, 'layouts'), ['.hbs']).concat(
    listFiles(path.join(srcDir, 'partials'), ['.hbs'])
  )
  for (const full of templates) {
    const file = path.relative(srcDir, full).split(path.sep).join('/')
    const text = stripHbsComments(fs.readFileSync(full, 'utf8'))
    let m
    const pageRe = new RegExp(`page\\.attributes\\.(?:\\[(${KEY})\\]|(${KEY}))`, 'g')
    while ((m = pageRe.exec(text))) add(`page-${m[1] || m[2]}`, file)
    const adocRe = new RegExp(`asciidoc\\.attributes\\.(?:\\[(${KEY})\\]|(${KEY}))`, 'g')
    while ((m = adocRe.exec(text))) add(m[1] || m[2], file)
    const helperRe = /\(page-attribute\s+["']([^"']+)["']/g
    while ((m = helperRe.exec(text))) add(m[1], file)
    // A whole attributes object handed to a helper or partial.
    const bareRe = /(?:page|asciidoc)\.attributes(?![.\w[-])/g
    while ((m = bareRe.exec(text))) {
      const before = text.slice(0, m.index)
      // The nearest enclosing `(helper ...)` or `{{helper ...}}`.
      const open = Math.max(before.lastIndexOf('('), before.lastIndexOf('{{'))
      const helper = open >= 0 ? (before.slice(open).match(/^(?:\(|\{\{[#^]?)([a-z][a-z-]*)\s/) || [])[1] : undefined
      const withBody = helper === 'with' ? withBlockBody(text, open, m) : undefined
      if (withBody !== undefined) {
        // {{#with page.attributes}} ... {{latest-x}} ... {{/with}}: bare keys
        // inside the block are attribute reads.
        const prefix = m[0].startsWith('page') ? 'page-' : ''
        const keyRe = new RegExp(`\\{\\{(?:[#^]?(?:if|unless)\\s+)?(${KEY})\\s*\\}\\}`, 'g')
        let k
        while ((k = keyRe.exec(withBody))) if (k[1] !== 'else' && k[1] !== 'this') add(prefix + k[1], file)
      } else if (!helper || !HELPERS_TAKING_ATTRIBUTES[helper]) {
        unclassified.push(`${file}: attributes object passed to ${helper || 'something'} the scanner does not know`)
      } else if (!INDIRECT[HELPERS_TAKING_ATTRIBUTES[helper]]) {
        unclassified.push(`${file}: helper ${helper} takes attributes but is missing from INDIRECT`)
      }
    }
  }

  const scripts = listFiles(path.join(srcDir, 'helpers'), ['.js']).concat(
    listFiles(path.join(srcDir, 'js'), ['.js', '.jsx'])
  )
  for (const full of scripts) {
    const file = path.relative(srcDir, full).split(path.sep).join('/')
    const text = stripJsComments(fs.readFileSync(full, 'utf8'))
    let m
    const access = `(?:(?:\\?\\.)?\\[${QUOTED}\\]|${DOT}(${KEY}))`
    const pageRe = new RegExp(`\\b(?:page|currentPage)${DOT}attributes${access}`, 'g')
    while ((m = pageRe.exec(text))) add(`page-${normalizeKey(m[1] || m[2])}`, file)
    const adocRe = new RegExp(`asciidoc${DOT}attributes${access}`, 'g')
    while ((m = adocRe.exec(text))) add(normalizeKey(m[1] || m[2]), file)

    const indirect = INDIRECT[file]
    if (indirect) {
      for (const v of indirect.vars) {
        const re = new RegExp(`(?<![.\\w])${v}(?:(?:\\?\\.)?\\[${QUOTED}\\]|\\??\\.(${KEY}))`, 'g')
        while ((m = re.exec(text))) {
          const key = normalizeKey(m[1] || m[2])
          if (key === 'length') continue
          for (const prefix of indirect.prefixes) add(prefix + key, file)
        }
      }
    }
    // An attributes object stored in a variable the scanner is not told about.
    const assignRe = /\b(?:const|let|var)\s+(\w+)\s*=\s*[^;\n]*\.attributes\s*(?:$|;|\n)/gm
    while ((m = assignRe.exec(text))) {
      if (!indirect || !indirect.vars.includes(m[1])) {
        unclassified.push(`${file}: attributes object assigned to ${m[1]}; add the file to INDIRECT`)
      }
    }
    // A computed key the scanner cannot resolve, e.g. attrs[key].
    if (indirect) {
      for (const v of indirect.vars) {
        const re = new RegExp(`(?<![.\\w])${v}(?:\\?\\.)?\\[(?!['"\`])([^\\]]+)\\]`, 'g')
        while ((m = re.exec(text))) {
          unclassified.push(`${file}: computed attribute key ${v}[${m[1]}]; use a string or template literal`)
        }
      }
    }
  }

  return { reads, unclassified }
}

// Every concrete name a manifest key covers: `popular-{n}-title` with range
// [1, 6] covers the pattern itself and popular-1-title to popular-6-title.
function expand (key, entry) {
  if (!key.includes('{n}')) return [key]
  const [lo, hi] = entry.range || [1, 0]
  const names = [key]
  for (let i = lo; i <= hi; i++) names.push(key.replace('{n}', String(i)))
  return names
}

// Compares a scan with the manifest. Returns three lists, all empty when they
// agree.
function compare (manifest, { reads }) {
  const owner = new Map() // concrete or pattern name -> manifest key
  for (const [key, entry] of Object.entries(manifest.attributes)) {
    for (const name of expand(key, entry)) owner.set(name, key)
  }
  const undeclared = [...reads.keys()].filter((name) => !owner.has(name)).sort()

  const unread = []
  const readByMismatch = []
  for (const [key, entry] of Object.entries(manifest.attributes)) {
    const names = expand(key, entry)
    const files = new Set()
    for (const name of names) for (const f of reads.get(name) || []) files.add(`src/${f}`)
    if (key.includes('{n}')) {
      // A loop read (the pattern itself) covers the whole range. Otherwise
      // every number in the range must be read, or the range is too wide.
      if (!reads.has(key)) {
        const missing = names.slice(1).filter((name) => !reads.has(name))
        if (missing.length) unread.push(`${key} (nothing reads ${missing.join(', ')})`)
      }
    } else if (!reads.has(key)) {
      unread.push(key)
    }
    const expected = [...files].sort()
    const actual = [...(entry.readBy || [])].sort()
    if (expected.join('\n') !== actual.join('\n')) {
      readByMismatch.push(`${key}: readBy should be ${JSON.stringify(expected)}`)
    }
  }
  return { undeclared, unread, readByMismatch }
}

module.exports = { scan, compare, expand, INDIRECT, HELPERS_TAKING_ATTRIBUTES }

if (require.main === module) {
  const { reads, unclassified } = scan()
  for (const name of [...reads.keys()].sort()) console.log(`${name}\t${[...reads.get(name)].sort().join(', ')}`)
  if (unclassified.length) console.error(unclassified.join('\n'))
}
