#!/usr/bin/env node
'use strict'

// Cuts Redpanda's iceberg_mode type and its string parser and formatter out
// of the real model/metadata.h and model/model.cc fetched for one release,
// so the engine compiles that release's own code without the rest of
// model.cc (record batches, serde, iobuf), which needs most of Seastar.
//
// Nothing here restates the grammar. The output is the upstream text, item
// by item, in upstream order:
//
//   - From the header: every top-level declaration in `namespace model` that
//     names iceberg_mode (the class or enum, and the parse/operator
//     declarations).
//   - From model.cc: every top-level definition in `namespace model`, and in
//     its anonymous namespaces, that names iceberg_mode, plus the helpers
//     those definitions call (parse_section_opts, parse_config_options,
//     to_sv, ...). Wire-format code (write_nested, read_nested and the serde
//     envelope) is left out: it is not on the path that reads a topic
//     property.
//
// Usage: extract-iceberg-mode.js <metadata.h> <model.cc> <out-dir>
// Writes <out-dir>/iceberg_mode.h and <out-dir>/iceberg_mode.cc, and prints
// which items it kept. Exits non-zero when it finds no iceberg_mode, so a
// layout change upstream fails the build instead of producing an empty engine.
//
//        extract-iceberg-mode.js --tests <iceberg_mode_test.cc> <out-dir>
// Writes <out-dir>/iceberg_mode_test.cc: the release's own unit tests for the
// parser and formatter, minus the wire round-trip tests (and the helpers only
// they use), which need serde. build.sh compiles it against the extracted
// code with googletest, so each engine is checked by its release's tests.

const fs = require('fs')
const path = require('path')

// Split C++ text into top-level items. Tracks comments, string and char
// literals, braces and parentheses. An item ends at `;` at depth 0, or at a
// `}` that returns to depth 0 when the next significant character does not
// continue the expression (a function body or a namespace).
function splitItems (src) {
  const items = []
  let i = 0
  let start = 0
  let brace = 0
  let paren = 0
  const n = src.length
  const skipWsAndComments = (j) => {
    for (;;) {
      while (j < n && /\s/.test(src[j])) j++
      if (src.startsWith('//', j)) { while (j < n && src[j] !== '\n') j++; continue }
      if (src.startsWith('/*', j)) { const e = src.indexOf('*/', j + 2); j = e < 0 ? n : e + 2; continue }
      return j
    }
  }
  const push = (end) => {
    const text = src.slice(start, end)
    if (text.trim()) items.push(text)
    start = end
  }
  while (i < n) {
    const c = src[i]
    if (src.startsWith('//', i)) { while (i < n && src[i] !== '\n') i++; continue }
    if (src.startsWith('/*', i)) { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue }
    if (c === 'R' && src[i + 1] === '"') {
      const open = src.indexOf('(', i)
      const delim = src.slice(i + 2, open)
      const e = src.indexOf(')' + delim + '"', open)
      i = e < 0 ? n : e + delim.length + 2
      continue
    }
    if (c === '"' || c === "'") {
      // A digit separator (1'000) is not a char literal.
      if (c === "'" && /[0-9a-fA-F]/.test(src[i - 1] || '') && /[0-9a-fA-F]/.test(src[i + 1] || '')) { i++; continue }
      i++
      while (i < n && src[i] !== c) { if (src[i] === '\\') i++; i++ }
      i++
      continue
    }
    if (c === '#' && brace === 0 && paren === 0 && /(^|\n)[ \t]*$/.test(src.slice(Math.max(0, i - 200), i))) {
      // A preprocessor line at top level is an item of its own.
      while (i < n && src[i] !== '\n') { if (src[i] === '\\') i++; i++ }
      push(i)
      continue
    }
    if (c === '(') paren++
    else if (c === ')') paren--
    else if (c === '{') brace++
    else if (c === '}') {
      brace--
      if (brace === 0 && paren === 0) {
        const j = skipWsAndComments(i + 1)
        if (!/[;(),.]/.test(src[j] || '')) { push(i + 1); i++; continue }
      }
    } else if (c === ';' && brace === 0 && paren === 0) {
      push(i + 1)
    }
    i++
  }
  push(n)
  return items
}

// The item's code without comments and literals, for name matching.
function code (text) {
  return text
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
}

// The body of every `namespace <name> {` block at the top of `src`, as
// [{ name, body }], in order. `name` is '' for an anonymous namespace.
function namespaces (items) {
  const out = []
  for (const it of items) {
    const m = /^\s*(?:(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)*namespace\s*([A-Za-z_][\w:]*)?\s*\{/.exec(it)
    if (!m) continue
    const open = it.indexOf('{', m.index + m[0].length - 1)
    const close = it.lastIndexOf('}')
    out.push({ name: m[1] || '', body: it.slice(open + 1, close), text: it })
  }
  return out
}

// The name an item declares: the identifier before its first top-level '('
// (a function), or after class/struct/enum, or before '=' (a variable).
function declaredName (text) {
  const c = code(text).replace(/\s+/g, ' ').trim()
  let m = /^(?:template ?<[^>]*> ?)?(?:enum class|enum|class|struct) ([A-Za-z_]\w*)/.exec(c)
  if (m) return m[1]
  const eq = c.indexOf('=')
  const par = c.indexOf('(')
  if (par >= 0 && (eq < 0 || par < eq)) {
    m = /([A-Za-z_][\w:]*)\s*$/.exec(c.slice(0, par).replace(/operator\s*$/, ''))
    if (/operator\s*(<<|>>)\s*$/.test(c.slice(0, par))) return null
    return m ? m[1].split('::').pop() : null
  }
  if (eq >= 0) {
    m = /([A-Za-z_]\w*)\s*$/.exec(c.slice(0, eq))
    return m ? m[1] : null
  }
  return null
}

const isPreprocessor = (text) => /^#/.test(code(text).trim())
const mentions = (text, word) => new RegExp('\\b' + word + '\\b').test(code(text))
const WIRE = /\b(iobuf|iobuf_parser|serde)\b/

function extractHeader (src) {
  const kept = []
  for (const ns of namespaces(splitItems(src))) {
    if (ns.name !== 'model') continue
    for (const it of splitItems(ns.body)) {
      if (isPreprocessor(it)) continue
      if (mentions(it, 'iceberg_mode')) kept.push(it)
    }
  }
  return kept
}

function extractSource (src) {
  // Candidates: model-namespace items, and items of anonymous namespaces
  // inside it (kept together so they stay in an anonymous namespace).
  const groups = []
  for (const ns of namespaces(splitItems(src))) {
    if (ns.name !== 'model') continue
    for (const it of splitItems(ns.body)) {
      if (isPreprocessor(it)) continue
      const inner = namespaces([it])
      if (inner.length && inner[0].name === '') {
        groups.push({ anon: true, items: splitItems(inner[0].body).filter((x) => !isPreprocessor(x)) })
      } else if (!inner.length) {
        groups.push({ anon: false, items: [it] })
      }
    }
  }
  const all = []
  groups.forEach((g, gi) => g.items.forEach((text) => all.push({ g: gi, text, name: declaredName(text), keep: false })))
  // Seed: items that name iceberg_mode and are not wire format.
  for (const it of all) {
    if (mentions(it.text, 'iceberg_mode') && !WIRE.test(code(it.text))) it.keep = true
  }
  // Close over helpers the kept items call, unqualified (`fmt::format_to(`
  // is not a call to model's format_to). Another overload of a function
  // that is already kept is not a helper.
  const seeded = new Set(all.filter((x) => x.keep && x.name).map((x) => x.name))
  for (let changed = true; changed;) {
    changed = false
    const used = all.filter((x) => x.keep).map((x) => code(x.text)).join('\n')
    for (const it of all) {
      if (it.keep || !it.name || seeded.has(it.name) || WIRE.test(code(it.text))) continue
      if (new RegExp('(?<![:\\w])' + it.name + '\\b').test(used)) { it.keep = true; changed = true }
    }
  }
  return { groups, all }
}

const TEST_MACRO = /^(TEST|TEST_F|TEST_P|TYPED_TEST)$/

function extractTests (src) {
  // Top-level items and the items of top-level anonymous namespaces.
  const groups = []
  for (const it of splitItems(src)) {
    if (isPreprocessor(it)) continue
    const inner = namespaces([it])
    if (inner.length && inner[0].name === '') groups.push({ anon: true, items: splitItems(inner[0].body).filter((x) => !isPreprocessor(x)) })
    else if (!inner.length) groups.push({ anon: false, items: [it] })
  }
  const all = []
  groups.forEach((g, gi) => g.items.forEach((text) => all.push({ g: gi, text, name: declaredName(text), drop: WIRE.test(code(text)) })))
  // Drop what calls a dropped helper (wire_roundtrip), until nothing changes.
  for (let changed = true; changed;) {
    changed = false
    const gone = all.filter((x) => x.drop && x.name && !TEST_MACRO.test(x.name)).map((x) => x.name)
    for (const it of all) {
      if (it.drop) continue
      if (gone.some((nm) => new RegExp('(?<![:\\w])' + nm + '\\b').test(code(it.text)))) { it.drop = true; changed = true }
    }
  }
  return { groups, all }
}

function mainTests (testPath, outDir) {
  const { groups, all } = extractTests(fs.readFileSync(testPath, 'utf8'))
  const tests = all.filter((x) => !x.drop && x.name && TEST_MACRO.test(x.name))
  if (!tests.length) {
    console.error('ERROR: no tests found in ' + testPath)
    process.exit(1)
  }
  let cc = '// Generated by extract-iceberg-mode.js from ' + path.basename(testPath) + '. Do not edit.\n' +
    '#include "iceberg_mode.h"\n#include "iceberg_mode_prelude_cc.h"\n\n#include <gmock/gmock.h>\n#include <gtest/gtest.h>\n\n#include <sstream>\n'
  groups.forEach((g, gi) => {
    const items = all.filter((x) => x.g === gi && !x.drop)
    if (!items.length) return
    if (g.anon) cc += '\nnamespace {\n'
    items.forEach((x) => { cc += x.text.replace(/^\n+/, '\n') + '\n' })
    if (g.anon) cc += '} // namespace\n'
  })
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'iceberg_mode_test.cc'), cc)
  const dropped = all.filter((x) => x.drop).map((x) => (code(x.text).match(/TEST\(\s*(\w+),\s*(\w+)/) || [null, x.name, '']).slice(1).join('.'))
  console.log('tests kept: ' + tests.length + ', left out (wire format): ' + dropped.join(', '))
}

function main () {
  if (process.argv[2] === '--tests') return mainTests(process.argv[3], process.argv[4])
  const [hdrPath, srcPath, outDir] = process.argv.slice(2)
  if (!hdrPath || !srcPath || !outDir) {
    console.error('usage: extract-iceberg-mode.js <metadata.h> <model.cc> <out-dir>')
    process.exit(2)
  }
  const hdr = extractHeader(fs.readFileSync(hdrPath, 'utf8'))
  const { groups, all } = extractSource(fs.readFileSync(srcPath, 'utf8'))
  const keptSrc = all.filter((x) => x.keep)
  if (!hdr.some((t) => /\b(class|enum class)\s+iceberg_mode\b/.test(code(t))) || !keptSrc.some((x) => /operator\s*>>/.test(code(x.text)))) {
    console.error('ERROR: did not find the iceberg_mode type in ' + hdrPath + ' and its operator>> in ' + srcPath + '.')
    console.error('       Upstream layout may have changed; re-check extract-iceberg-mode.js.')
    process.exit(1)
  }
  let cc = '// Generated by extract-iceberg-mode.js from ' + path.basename(srcPath) + '. Do not edit.\n' +
    '#include "iceberg_mode.h"\n#include "iceberg_mode_prelude_cc.h"\n\nnamespace model {\n'
  groups.forEach((g, gi) => {
    const items = all.filter((x) => x.g === gi && x.keep)
    if (!items.length) return
    if (g.anon) cc += '\nnamespace {\n'
    items.forEach((x) => { cc += x.text.replace(/^\n+/, '\n') + '\n' })
    if (g.anon) cc += '} // namespace\n'
  })
  cc += '} // namespace model\n'
  const h = '// Generated by extract-iceberg-mode.js from ' + path.basename(hdrPath) + '. Do not edit.\n' +
    '#pragma once\n#include "iceberg_mode_prelude.h"\n\nnamespace model {\n' + hdr.join('\n') + '\n} // namespace model\n'
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'iceberg_mode.h'), h)
  fs.writeFileSync(path.join(outDir, 'iceberg_mode.cc'), cc)
  const names = (list) => list.map((t) => declaredName(t) || code(t).trim().split('\n')[0].slice(0, 60)).join(', ')
  console.log('header items: ' + names(hdr))
  console.log('source items: ' + names(keptSrc.map((x) => x.text)))
}

if (require.main === module) main()
module.exports = { splitItems, extractHeader, extractSource, extractTests, declaredName }
