'use strict'

// Computed styles of the explorer on the built preview page, in a real
// browser, at phone and desktop widths in both themes: nothing overflows its
// mount or the page, the docs theme's code styles do not reach the config
// string, and small text keeps 4.5:1 contrast against what is behind it.
//
// Needs the preview build: run `npx gulp preview:build` first. The
// iceberg-dsl-conformance workflow does both.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const http = require('http')
const path = require('path')
const puppeteer = require('puppeteer')

const PUBLIC = path.join(__dirname, '../../public')
const PAGE = 'iceberg-explorer-test.html'
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.wasm': 'application/wasm' }

let server
let browser
let origin

test.before(async () => {
  assert.ok(fs.existsSync(path.join(PUBLIC, PAGE)), `public/${PAGE} is missing; run npx gulp preview:build first`)
  server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '')
    const file = path.join(PUBLIC, rel)
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${server.address().port}`
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] })
})

test.after(async () => {
  if (browser) await browser.close()
  if (server) server.close()
})

// Runs in the page. Returns a list of problems.
function inspect () {
  const problems = []
  const parse = (c) => {
    let m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(c)
    if (m) return { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] }
    m = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/.exec(c)
    if (m) return { rgb: [m[1] * 255, m[2] * 255, m[3] * 255], a: m[4] === undefined ? 1 : +m[4] }
    return null
  }
  const blend = (fg, bg) => ({ rgb: fg.rgb.map((v, i) => v * fg.a + bg.rgb[i] * (1 - fg.a)), a: 1 })
  // The color actually behind an element: its own and its ancestors'
  // backgrounds, composited down to the page.
  const behind = (el) => {
    const layers = []
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor)
      if (c && c.a > 0) layers.push(c)
      if (c && c.a === 1) break
    }
    let bg = { rgb: [255, 255, 255], a: 1 }
    for (let i = layers.length - 1; i >= 0; i--) bg = blend(layers[i], bg)
    return bg
  }
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

  const vw = document.documentElement.clientWidth
  if (document.documentElement.scrollWidth > vw + 1) problems.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${vw}`)
  const mounts = [...document.querySelectorAll('[data-iceberg-explorer]')]
  mounts.forEach((m, i) => {
    const where = `mount ${i + 1}`
    if (m.getAttribute('data-hydrated') !== 'true') problems.push(`${where} did not hydrate: ${m.getAttribute('data-hydrated')}`)
    const box = m.getBoundingClientRect()
    if (box.right > vw + 1) problems.push(`${where} ends at ${box.right}, past the viewport ${vw}`)
    if (m.scrollWidth > m.clientWidth + 1) problems.push(`${where} overflows: ${m.scrollWidth} > ${m.clientWidth}`)
    // Only the trees may be wider than their card, and they scroll inside it.
    for (const el of m.querySelectorAll('*')) {
      if (el.closest('.ice-tree')) continue
      const r = el.getBoundingClientRect()
      if (r.width && r.right > box.right + 1) problems.push(`${where}: ${el.className || el.tagName} ends at ${r.right.toFixed(1)}, past the mount at ${box.right.toFixed(1)}`)
    }
    for (const tree of m.querySelectorAll('.ice-tree')) {
      const s = getComputedStyle(tree)
      if (tree.scrollWidth > tree.clientWidth + 1 && !/auto|scroll/.test(s.overflowX)) problems.push(`${where}: a tree overflows without scrolling`)
    }

    const cs = m.querySelector('.ice-configstr')
    const s = getComputedStyle(cs)
    const reset = { fontWeight: '400', borderTopWidth: '0px', borderLeftWidth: '0px', paddingLeft: '0px', paddingTop: '0px', borderTopLeftRadius: '0px', backgroundColor: 'rgba(0, 0, 0, 0)' }
    for (const [k, v] of Object.entries(reset)) if (s[k] !== v) problems.push(`${where}: config string ${k} is ${s[k]}, expected ${v}`)
    if (s.wordBreak === 'break-all') problems.push(`${where}: config string breaks inside words`)

    const small = m.querySelectorAll('.ice-card h3, .ice-label, .ice-textrow label, .ice-configlabel, .ice-help:not(:empty), .ice-hint:not([hidden]), .ice-tag:not(:empty), .ice-copy, .ice-error:not([hidden]), .field-req, .struct-brace, .field-name, .field-type')
    for (const el of small) {
      if (el.offsetParent === null) continue
      const fg = parse(getComputedStyle(el).color)
      if (!fg) { problems.push(`${where}: cannot read the color of ${el.className}`); continue }
      const bg = behind(el)
      // Disabled controls are exempt from contrast (WCAG 1.4.3).
      if (el.closest('.ice-radio') && el.closest('.ice-radio').querySelector('input:disabled')) continue
      const r = ratio(blend(fg, bg).rgb, bg.rgb)
      if (r < 4.5) problems.push(`${where}: ${el.className || el.tagName} "${el.textContent.slice(0, 30)}" is ${r.toFixed(2)}:1`)
    }
  })
  const alerts = mounts.map((m) => { const a = m.querySelector('[data-out="config-alert"]'); return a && !a.hidden ? a.textContent : null })
  return { problems, alerts, theme: document.documentElement.getAttribute('data-theme'), mounts: mounts.length }
}

for (const width of [390, 1440]) {
  for (const theme of ['light', 'dark']) {
    test(`no overflow, reset config string and readable text at ${width}px, ${theme}`, async () => {
      const page = await browser.newPage()
      try {
        await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }])
        await page.setViewport({ width, height: 900 })
        await page.goto(`${origin}/${PAGE}`, { waitUntil: 'load' })
        await page.waitForFunction(() => {
          const ms = [...document.querySelectorAll('[data-iceberg-explorer]')]
          return ms.length && ms.every((m) => m.getAttribute('data-hydrated'))
        }, { timeout: 10000 })
        // Fonts change widths; measure after they settle.
        await page.evaluate(() => document.fonts && document.fonts.ready)
        const out = await page.evaluate(inspect)
        assert.strictEqual(out.theme, theme)
        assert.strictEqual(out.mounts, 6)
        assert.deepStrictEqual(out.problems, [])
        // Only the preview's deliberately invalid config is flagged.
        assert.deepStrictEqual(out.alerts.map((x) => x && /schema_lastest/.test(x)), [null, null, null, null, true, null])
      } finally {
        await page.close()
      }
    })
  }
}
