'use strict'

// Reads the UI templates and preview pages as tags, for the meaning-system
// checks. Handlebars expressions and quoted values are skipped over, so a
// {{...}} or an attribute value cannot end a tag early.

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

// Every tag in order: { close, name, tag }
function tags (src) {
  const out = []
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '<') continue
    const close = src[i + 1] === '/'
    if (!/[a-zA-Z]/.test(src[close ? i + 2 : i + 1] || '')) continue
    let j = i + 1
    let quote = null
    while (j < src.length) {
      if (src.startsWith('{{', j)) { const end = src.indexOf('}}', j); j = end < 0 ? src.length : end + 2; continue }
      const c = src[j]
      if (quote) { if (c === quote) quote = null } else if (c === '"' || c === "'") quote = c
      else if (c === '>') break
      j++
    }
    const tag = src.slice(i, j + 1)
    const name = (tag.match(/^<\/?([a-zA-Z][\w-]*)/) || [])[1].toLowerCase()
    out.push({ close, name, tag })
    i = j
  }
  return out
}

const openingTags = (src) => tags(src).filter((t) => !t.close).map((t) => t.tag)

// Opening tags with the opening tags of their ancestors. A close pops back to
// its matching open, so a tag left open in one Handlebars branch cannot
// leave the rest of the file nested inside it.
function withAncestors (src) {
  const stack = []
  const out = []
  for (const t of tags(src)) {
    if (t.close) {
      const at = stack.map((s) => s.name).lastIndexOf(t.name)
      if (at >= 0) stack.length = at
      continue
    }
    out.push({ tag: t.tag, ancestors: stack.map((s) => s.tag) })
    if (!VOID.has(t.name) && !t.tag.endsWith('/>')) stack.push(t)
  }
  return out
}

const isBadge = (tag) => /\bclass\s*=\s*["'][^"']*\brp-badge\b/.test(tag)

function files (dirs, ext) {
  const out = []
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (ext.some((e) => ent.name.endsWith(e))) out.push(p)
    }
  }
  dirs.forEach((d) => walk(path.join(ROOT, d)))
  return out
}

module.exports = { ROOT, tags, openingTags, withAncestors, isBadge, files }
