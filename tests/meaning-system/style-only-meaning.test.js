'use strict'

// Every meaning is in HTML text or an accessible name/state, never only in
// CSS (content:, color, icon) or a title/data-* attribute. Agents, search
// indexers, the Markdown export, and screen readers read the HTML.
//
// - Admonitions, checklists, and menu carets: the production playbook turns
//   font icons off, so Asciidoctor writes the label, the marker, and the caret
//   as text. Both markups (icons=font and no icons) must look the same: the
//   browser test compares the computed styles of the two.
// - Templates and scripts: the words and states are in the markup.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const puppeteer = require('puppeteer')
const Asciidoctor = require('@asciidoctor/core')()

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const TYPES = ['note', 'tip', 'important', 'caution', 'warning']

function convert (src, icons) {
  const attributes = { experimental: '' }
  if (icons) attributes.icons = icons
  return Asciidoctor.convert(src, { safe: 'safe', attributes })
}

const ADOC = TYPES.map((t) => `${t.toUpperCase()}: The ${t} text.`).join('\n\n') +
  '\n\n* [x] Done item\n* [ ] To-do item\n\nmenu:File[Save]\n'

test('without font icons, Asciidoctor writes the admonition label, checklist marker, and menu caret as text', () => {
  const html = convert(ADOC)
  for (const t of TYPES) {
    const label = t.charAt(0).toUpperCase() + t.slice(1)
    assert.match(html, new RegExp(`<td class="icon">\\s*<div class="title">${label}</div>`), `${t} label`)
  }
  assert.match(html, /<p>&#10003; Done item<\/p>/)
  assert.match(html, /<p>&#10063; To-do item<\/p>/)
  assert.match(html, /<b class="caret">&#8250;<\/b>/)
})

test('the admonitions preview page shows the no-icons markup', () => {
  const preview = read('preview-src/admonitions-test.adoc')
  for (const t of TYPES) {
    assert.match(preview, new RegExp(`<div class="admonitionblock ${t}">[\\s\\S]*?<div class="title">`), `${t} no-icons block`)
  }
  assert.match(preview, /<b class="caret">/)
  assert.match(preview, /&#10003;/)
})

test('doc.css gives every no-icons admonition label its own icon', () => {
  const doc = read('src/css/doc.css')
  const icon = (t) => (doc.match(new RegExp(`\\.admonitionblock\\.${t} td\\.icon > \\.title \\{\\s*--admonition-icon:\\s*var\\((--[\\w-]+)\\)`)) || [])[1]
  assert.deepEqual(TYPES.map(icon), ['--icon-info', '--icon-check-circle', '--icon-important', '--icon-triangle', '--icon-octagon'])
})

test('pagination says Prev and Next in the markup, not in CSS', () => {
  const hbs = read('src/partials/pagination.hbs')
  assert.match(hbs, /<nav class="pagination" aria-label="[^"]+">/)
  assert.match(hbs, /<span class="pagination-label">Prev<\/span>/)
  assert.match(hbs, /<span class="pagination-label">Next<\/span>/)
  assert.doesNotMatch(read('src/css/pagination.css'), /content:\s*"(Prev|Next)"/)
})

test('the component type switcher has a real Type: label and marks the current variant', () => {
  const hbs = read('src/partials/context-switcher.hbs')
  assert.match(hbs, /<span class="context-dropdown-label">Type:<\/span>/)
  assert.match(hbs, /aria-current="page"/)
  const js = read('src/js/24-move-connector-metadata.js')
  assert.match(js, /label\.textContent = 'Type:'/)
  assert.match(js, /setAttribute\('aria-current', 'page'\)/)
  assert.doesNotMatch(read('src/css/doc.css'), /content:\s*'Type:'/)
})

test('the sidebar marks the current link and gives each toggle a state', () => {
  const hbs = read('src/partials/nav-tree.hbs')
  assert.match(hbs, /<a class="nav-link"\{\{#if \(eq \.\/url @root\.page\.url\)\}\} aria-current="page"\{\{\/if\}\}/)
  assert.match(hbs, /class="nav-item-toggle"/)
  assert.match(hbs, /aria-expanded="\{\{#if/)
})

test('-only availability badges say only; the plain Cloud badge stays Cloud', () => {
  const article = read('src/partials/article.hbs')
  assert.match(article, />BYOC only<\/span>/)
  assert.match(article, />Cloud only<\/span>/)
  assert.match(article, />Self-Managed only<\/span>/)
  assert.match(article, /\{\{else\}\}Available only in Redpanda Cloud\.\{\{\/if\}\}">Cloud only</)
  assert.match(article, /data-tooltip="Available in Redpanda Cloud\.">Cloud<\/a>/)
  const nav = read('src/partials/nav-tree.hbs')
  assert.match(nav, /is-byoc-feature[^\n]*>BYOC only<\/span>/)
  assert.match(nav, /is-cloud-feature[^\n]*data-tooltip="Available only in Redpanda Cloud\.">Cloud only<\/span>/)
})

test('the version selector marks the current version in text and state', () => {
  const hbs = read('src/partials/version-selector.hbs')
  assert.equal((hbs.match(/aria-current="page"/g) || []).length, 4)
  assert.equal((hbs.match(/<span class="visually-hidden"> \(current\)<\/span>/g) || []).length, 4)
  assert.doesNotMatch(hbs, /aria-label="Selected"/)
  const bucket = read('src/partials/bucket-header.hbs')
  assert.equal((bucket.match(/role="option" aria-selected="\{\{#if/g) || []).length, 3)
  const explore = read('src/partials/nav-explore.hbs')
  assert.doesNotMatch(explore, /aria-label="Select version"/, 'an aria-label would hide the version and its status')
  assert.match(explore, /<span class="visually-hidden">Select version\. Current: <\/span>/)
})

test('Ask AI: interim text says Thinking, and feedback buttons have names and pressed state', () => {
  assert.match(read('src/js/react/components/ChatInterface.jsx'), /<span className="visually-hidden">Thinking: <\/span>/)
  const sdk = read('src/js/react/components/ChatSdkInterface.jsx')
  assert.match(sdk, /aria-label="This was helpful" aria-pressed=\{given === 'upvote'\}/)
  assert.match(sdk, /aria-label="This wasn't helpful" aria-pressed=\{given === 'downvote'\}/)
})

// Browser checks: real CSS and real scripts in Chrome

// One browser for the whole file: every browser check is a subtest of one
// parent test, which launches the browser once and closes it in a finally
// block, so no failure or timeout in a check can leave Chrome running.
let browser
const browserChecks = []
const browserTest = (name, fn) => browserChecks.push([name, fn])

async function newPage () {
  const page = await browser.newPage()
  page.setDefaultTimeout(20000)
  page.setDefaultNavigationTimeout(20000)
  return page
}

// Runs fn with a fresh page and closes the page whatever happens
async function withPage (open, fn) {
  const page = await open()
  try {
    return await fn(page)
  } finally {
    // A close error must not hide the test's own failure
    await page.close().catch(() => {})
  }
}

async function cssPage (body, theme) {
  const page = await newPage()
  try {
    await loadCss(page, body, theme)
  } catch (err) {
    await page.close()
    throw err
  }
  return page
}

async function loadCss (page, body, theme) {
  // Local files only: a remote font or image the sandbox cannot reach would
  // hold the load event
  await page.setRequestInterception(true)
  page.on('request', (req) => (req.url().startsWith('file:') ? req.continue() : req.abort()))
  const file = path.join(os.tmpdir(), `style-only-${process.pid}-${Math.random().toString(36).slice(2)}.html`)
  const css = pathToFileURL(path.join(ROOT, 'src/css/site.css')).href
  fs.writeFileSync(file, `<!doctype html><html data-theme="${theme}"><head><link rel="stylesheet" href="${css}"></head><body><main class="article"><article class="doc">${body}</article></main></body></html>`)
  try {
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load' })
  } finally {
    fs.unlinkSync(file)
  }
}

for (const theme of ['light', 'dark']) {
  browserTest(`${theme}: no-icons admonition labels look the same as icons=font labels`, async () => {
    const styles = await withPage(() => cssPage(convert(ADOC, 'font') + convert(ADOC), theme), (page) => {
      return page.evaluate((types) => {
        const pick = (el, pseudo) => {
          const cs = window.getComputedStyle(el, pseudo)
          return {
            color: cs.color,
            fontSize: cs.fontSize,
            fontWeight: cs.fontWeight,
            marginTop: cs.marginTop,
            mask: cs.webkitMaskImage || cs.maskImage,
            width: cs.width,
            bg: cs.backgroundColor,
          }
        }
        return types.map((t) => {
          const [fontBlock, textBlock] = document.querySelectorAll(`.admonitionblock.${t}`)
          const i = fontBlock.querySelector('td.icon i')
          const title = textBlock.querySelector('td.icon > .title')
          return {
            type: t,
            fontLabel: pick(i),
            textLabel: pick(title),
            fontIcon: pick(i, '::before'),
            textIcon: pick(title, '::before'),
            drawn: window.getComputedStyle(i, '::after').content,
            textAfter: window.getComputedStyle(title, '::after').content,
            rowHeight: [fontBlock.querySelector('td.icon').getBoundingClientRect().height, textBlock.querySelector('td.icon').getBoundingClientRect().height],
          }
        })
      }, TYPES)
    })
    for (const s of styles) {
      assert.equal(s.drawn, `"${s.type.charAt(0).toUpperCase() + s.type.slice(1)}"`, `${s.type}: font markup still draws its label`)
      assert.equal(s.textAfter, 'none', `${s.type}: text markup does not draw a second label`)
      for (const k of ['color', 'fontSize', 'fontWeight', 'marginTop']) {
        assert.equal(s.textLabel[k], s.fontLabel[k], `${theme} ${s.type} label ${k}`)
      }
      assert.notEqual(s.textIcon.mask, 'none', `${s.type}: no-icons label has an icon`)
      assert.equal(s.textIcon.mask, s.fontIcon.mask, `${theme} ${s.type} icon`)
      assert.equal(s.textIcon.width, s.fontIcon.width, `${s.type} icon size`)
      assert.equal(s.textIcon.bg, s.fontIcon.bg, `${theme} ${s.type} icon color`)
      assert.equal(s.rowHeight[1], s.rowHeight[0], `${s.type} label row height`)
    }
  })
}

browserTest('menu caret text looks like the icons=font caret', async () => {
  const [font, text] = await withPage(() => cssPage(convert('menu:File[Save]', 'font') + convert('menu:File[Save]'), 'light'), (page) => {
    return page.evaluate(() => {
      const [i, b] = [document.querySelector('i.caret'), document.querySelector('b.caret')]
      const a = window.getComputedStyle(i, '::before')
      const c = window.getComputedStyle(b)
      return [[a.fontSize, a.fontFamily, a.content], [c.fontSize, c.fontFamily, b.textContent]]
    })
  })
  assert.equal(text[0], font[0])
  assert.equal(text[1], font[1])
  assert.equal(font[2], '"›"')
  assert.equal(text[2], '›')
})

async function scriptPage (html, script, setup, setupArg) {
  const page = await newPage()
  try {
    await page.setContent(`<!doctype html><html><body>${html}</body></html>`)
    if (setup) await page.evaluate(setup, setupArg)
    await page.addScriptTag({ content: read(script) })
  } catch (err) {
    await page.close()
    throw err
  }
  return page
}

const NAV = `<div class="nav-container"><nav class="nav"><div class="nav-panel-menu nav-menu" data-panel="menu">
<ul class="nav-list">
  <li class="nav-item" data-depth="0"><div class="item dropdown"><a class="nav-link" href="#a">Get started <span class="rp-badge rp-badge--sm rp-badge--beta">Beta</span></a>
    <div role="button" tabindex="0" aria-expanded="false" aria-label="Expand navigation" class="nav-item-toggle"></div></div>
    <ul class="nav-list"><li class="nav-item" data-depth="1"><div class="item"><a class="nav-link" href="#b">Child</a></div></li></ul>
  </li>
  <li class="nav-item" data-depth="0"><div class="item dropdown"><span class="nav-text">Section</span>
    <div role="button" tabindex="0" aria-expanded="false" aria-label="Expand navigation" class="nav-item-toggle"></div></div>
    <ul class="nav-list"><li class="nav-item" data-depth="1"><div class="item"><a class="nav-link" href="#c">Other</a></div></li></ul>
  </li>
</ul></div></nav></div>`

browserTest('nav toggles name their item and keep aria-expanded in step', async () => {
  await withPage(() => scriptPage(NAV, 'src/js/01-nav.js'), async (page) => {
    const state = () => page.evaluate(() => [...document.querySelectorAll('.nav-item-toggle')].map((t) => [t.getAttribute('aria-expanded'), t.getAttribute('aria-label')]))
    assert.deepEqual(await state(), [['false', 'Expand Get started'], ['false', 'Expand Section']])
    const click = () => page.evaluate(() => document.querySelector('.nav-item-toggle').click())
    await click()
    assert.deepEqual(await state(), [['true', 'Collapse Get started'], ['false', 'Expand Section']])
    // Enter on the second toggle, sent as a keydown event. Focusing the
    // toggle (page.focus or element.focus) right after the first click
    // intermittently crashed the bundled old headless Chrome renderer, which
    // then hung the run; the keydown handler is what is under test.
    await page.evaluate(() => {
      const toggle = document.querySelector('.nav-item:nth-child(2) .nav-item-toggle')
      toggle.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }))
    })
    assert.deepEqual(await state(), [['true', 'Collapse Get started'], ['true', 'Collapse Section']])
    await click()
    assert.deepEqual((await state())[0], ['false', 'Expand Get started'])
  })
})

browserTest('aria-current follows the current nav link on a hash change', async () => {
  const html = NAV.replace('<div class="item"><a class="nav-link" href="#b">', '<div class="item is-current-page"><a class="nav-link" aria-current="page" href="#b">')
  await withPage(() => scriptPage(html, 'src/js/01-nav.js'), async (page) => {
    await page.evaluate(() => { window.location.hash = '#c' })
    await page.waitForFunction(() => document.querySelector('a[href="#c"]').getAttribute('aria-current') === 'page')
    const current = await page.evaluate(() => [...document.querySelectorAll('[aria-current]')].map((a) => a.getAttribute('href')))
    assert.deepEqual(current, ['#c'])
  })
})

const CODE = '<div class="listingblock"><div class="content"><pre class="highlight"><code data-lang="bash">rpk version</code></pre></div></div>'

for (const touch of [false, true]) {
  browserTest(`copy button: named on ${touch ? 'touch' : 'pointer'} devices, copy announced through a status region`, async () => {
    await withPage(() => scriptPage(`<article class="doc">${CODE}</article><div data-chat-panel></div>`, 'src/js/06-copy-to-clipboard.js', (isTouch) => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.resolve() } })
      if (isTouch) window.ontouchstart = null
    }, touch), async (page) => {
      const before = await page.evaluate(() => {
        const copy = document.querySelector('.copy-button')
        const ask = document.querySelector('.ask-ai-button')
        const status = document.querySelector('[role="status"]')
        return {
          copy: copy.getAttribute('aria-label'),
          ask: ask.getAttribute('aria-label'),
          toastHidden: copy.querySelector('.copy-toast').getAttribute('aria-hidden'),
          status: status && status.textContent,
        }
      })
      assert.equal(before.copy, 'Copy to clipboard')
      assert.equal(before.ask, 'Ask AI about this code')
      assert.equal(before.toastHidden, 'true')
      assert.equal(before.status, '', 'the status region is in the page, empty, before any copy')
      await page.evaluate(() => document.querySelector('.copy-button').click())
      await page.waitForFunction(() => document.querySelector('[role="status"]').textContent === 'Copied to clipboard')
      assert.equal(await page.evaluate(() => document.querySelector('.copy-button').getAttribute('aria-label')), 'Copy to clipboard')
    })
  })
}

test('the active TOC link carries aria-current', () => {
  const js = read('src/js/02-on-this-page.js')
  assert.match(js, /link\.setAttribute\('aria-current', 'location'\)/)
  assert.doesNotMatch(js, /links\[[^\]]+\]\.classList\.(add|remove)\('is-active'\)/, 'every is-active change goes through markActive')
})

test('in Chrome', async (t) => {
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] })
  try {
    for (const [name, fn] of browserChecks) await t.test(name, { timeout: 20000 }, fn)
  } finally {
    // close() can hang when Chrome has already died; never leave it running
    const proc = browser.process()
    await Promise.race([browser.close().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 10000))])
    if (proc && proc.exitCode === null) proc.kill('SIGKILL')
  }
})
