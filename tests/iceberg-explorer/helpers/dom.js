'use strict'

// Runs the explorer module in a jsdom page, the way site.js runs it in a
// browser: the script is evaluated in the window with mounts already in the
// body, and hydration happens on DOMContentLoaded.
const fs = require('fs')
const path = require('path')
const { JSDOM } = require('jsdom')
const fakeEngine = require('./fake-engine')

const SRC = fs.readFileSync(path.join(__dirname, '../../../src/js/iceberg-explorer.js'), 'utf8')

const FALLBACK = '<p class="iceberg-explorer-fallback">Interactive Iceberg Mode Explorer.</p>'

// A mount as the macro writes it. `attrs` are extra attributes.
function mount (attrs = {}) {
  const a = Object.assign({ 'data-iceberg-explorer': '2', 'data-property': 'redpanda.iceberg.mode' }, attrs)
  const html = Object.entries(a).filter(([, v]) => v !== null).map(([k, v]) => ` ${k}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('')
  return `<div class="iceberg-explorer-mount"${html}>${FALLBACK}</div>`
}

// Serve engine scripts the explorer asks for. `engines` maps a file name
// (iceberg-engine-26.2.js, iceberg-engine.js) to a module or null (404).
// Unlisted versioned names get the stand-in for that release, and the
// unversioned name gets v26.2.1. `requested` collects the paths asked for.
function serveEngines (window, engines = {}, requested = []) {
  const head = window.document.head
  const append = head.appendChild.bind(head)
  head.appendChild = (el) => {
    if (el.tagName === 'SCRIPT' && /iceberg-engine[^/]*\.js$/.test(el.src)) {
      const url = new URL(el.src).pathname
      requested.push(url)
      const file = url.split('/').pop()
      const v = /^iceberg-engine-(.+)\.js$/.exec(file)
      const mod = file in engines ? engines[file] : file === 'iceberg-engine.js' ? fakeEngine.sections() : v && fakeEngine.forVersion(v[1])
      setTimeout(() => {
        if (!mod) return el.onerror()
        window.createIcebergEngine = () => Promise.resolve(mod)
        el.onload()
      })
      return el
    }
    return append(el)
  }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

async function page (body, { src = SRC, beforeEval, engines, requested } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`, {
    runScripts: 'outside-only',
    url: 'https://docs.example.test/streaming/current/manage/iceberg.html',
  })
  const { window } = dom
  const warnings = []
  window.console.warn = (m) => warnings.push(String(m))
  serveEngines(window, engines, requested)
  if (beforeEval) beforeEval(window)
  window.eval(src)
  if (window.document.readyState === 'loading') {
    await new Promise((resolve) => window.document.addEventListener('DOMContentLoaded', () => setTimeout(resolve)))
  }
  // Engines load asynchronously, like script tags in a browser.
  await settle()
  const doc = window.document
  const mounts = [...doc.querySelectorAll('[data-iceberg-explorer]')]
  return { dom, window, doc, mounts, warnings, ui: (root) => ui(window, root) }
}

// Small driver for one hydrated mount.
function ui (window, root) {
  const q = (s) => root.querySelector(s)
  return {
    root,
    q,
    config: () => q('[data-out="config"]').textContent,
    configHtml: () => q('[data-out="config"]').innerHTML,
    tag: () => q('[data-out="format"]').textContent,
    alert: () => { const a = q('[data-out="config-alert"]'); return a.hidden ? null : a.textContent },
    radios: (p) => [...root.querySelectorAll(`input[type="radio"][data-path="${p}"]`)],
    checked: (p) => { const r = [...root.querySelectorAll(`input[type="radio"][data-path="${p}"]`)].find((x) => x.checked); return r && r.value },
    input: (p) => q(`input[type="text"][data-path="${p}"]`),
    pick (p, v) {
      const r = this.radios(p).find((x) => x.value === v)
      if (!r) throw new Error(`no ${p}=${v}`)
      r.click()
    },
    type (p, v) {
      const i = this.input(p)
      i.value = v
      i.dispatchEvent(new window.Event('input', { bubbles: true }))
    },
    copyButtons: () => [...root.querySelectorAll('[data-copy]')],
  }
}

module.exports = { page, mount, settle, FALLBACK, SRC }
