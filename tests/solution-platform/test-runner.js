/* global localStorage, sessionStorage */
/**
 * 34-solution-platform.js in a real browser, with the real tabs script
 * (@asciidoctor/tabs), Prism, 11-editable-placeholders.js,
 * 06-copy-to-clipboard.js and 28-solution-progress.js, because the tab sync
 * and the code blocks come from those.
 *
 * Covers: the platform pick is recorded, a newer platform from signed-in
 * progress selects its tab and an older one does not, and the code on a
 * Redpanda Cloud tab keeps its placeholders.
 */
const puppeteer = require('puppeteer')
const express = require('express')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')
const STORE_KEY = 'docs-solutions-progress'
const TAB_KEY = 'preferred-tab-platform'

const failures = []
function check (name, ok, detail) {
  if (ok) {
    console.log(`  PASS  ${name}`)
  } else {
    console.log(`  FAIL  ${name}${detail ? ' -> ' + detail : ''}`)
    failures.push(name)
  }
}

async function main () {
  // What GET /solutions/progress answers for the signed-in scenarios.
  let remote = { v: 2, updatedAt: 0, solutions: {} }
  const app = express()
  app.use(express.json())
  app.get('/solutions/progress', (req, res) => res.json({ progress: remote }))
  app.put('/solutions/progress', (req, res) => res.json({ progress: req.body }))
  app.post('/docs-activity', (req, res) => res.status(204).end())
  app.use('/src', express.static(path.join(ROOT, 'src')))
  app.use('/node_modules', express.static(path.join(ROOT, 'node_modules')))
  app.use('/', express.static(__dirname))
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1100, height: 900 })
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(String(e)))
    // The copy button writes here instead of the system clipboard.
    await page.evaluateOnNewDocument(() => {
      window.__copied = []
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (text) => { window.__copied.push(text); return Promise.resolve() } },
      })
    })

    const load = async () => {
      await page.goto(`${origin}/fixture.html`, { waitUntil: 'load' })
      await page.evaluate(async () => {
        for (const el of document.querySelectorAll('pre > code')) {
          el.scrollIntoView()
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        await new Promise((resolve) => setTimeout(resolve, 400))
      })
    }
    const reset = async (local) => {
      await page.goto(`${origin}/fixture.html`, { waitUntil: 'load' })
      await page.evaluate((entries) => {
        localStorage.clear()
        sessionStorage.clear()
        for (const [k, v] of Object.entries(entries || {})) localStorage.setItem(k, v)
      }, local || {})
    }
    const selected = () => page.evaluate(() => ['group-1', 'group-2'].map((id) => {
      const tab = document.querySelector(`#${id} .tablist li[aria-selected="true"]`)
      return tab ? tab.textContent.trim() : null
    }))
    const stored = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), STORE_KEY)
    const codeText = (id) => page.evaluate((i) => document.querySelector(`#${i} pre > code`).textContent, id)

    // ---- platform: a click is recorded -------------------------------------
    await reset()
    await load()
    await page.click('#group-1 #_tabs_1_kubernetes')
    let s = await stored()
    check('a platform tab click is recorded in the store', s && s.prefs && s.prefs.platform && s.prefs.platform.value === 'kubernetes', JSON.stringify(s && s.prefs))
    check('the tabs script still syncs both groups', JSON.stringify(await selected()) === '["Kubernetes","Kubernetes"]', JSON.stringify(await selected()))
    check('the tabs script still writes its own key', (await page.evaluate((k) => localStorage.getItem(k), TAB_KEY)) === 'Kubernetes')

    // ---- platform: signed-in progress with a newer pick selects it -----------
    const signedIn = async (localAt, remoteAt) => {
      await reset({
        [STORE_KEY]: JSON.stringify({ v: 2, updatedAt: 0, solutions: {}, prefs: { platform: { value: 'local', at: localAt } } }),
        [TAB_KEY]: 'Docker Compose',
        'docs-solutions-progress-hint': 'true',
      })
      await page.setCookie({ name: 'rp_docs_auth', value: '1', url: origin })
      remote = { v: 2, updatedAt: 0, solutions: {}, prefs: { platform: { value: 'cloud', at: remoteAt } } }
      await load()
      const result = { tabs: await selected(), key: await page.evaluate((k) => localStorage.getItem(k), TAB_KEY), pref: (await stored()).prefs.platform }
      await page.deleteCookie({ name: 'rp_docs_auth', url: origin })
      return result
    }
    const now = Date.now()
    let r = await signedIn(now - 60000, now - 1000)
    check('a newer platform from signed-in progress selects that tab in every group', JSON.stringify(r.tabs) === '["Redpanda Cloud","Redpanda Cloud"]', JSON.stringify(r))
    check('and becomes the tabs script\'s choice for other pages', r.key === 'Redpanda Cloud', r.key)
    r = await signedIn(now - 1000, now - 60000)
    check('an older platform from signed-in progress changes nothing', JSON.stringify(r.tabs) === '["Docker Compose","Docker Compose"]' && r.pref.value === 'local', JSON.stringify(r))
    remote = { v: 2, updatedAt: 0, solutions: {} }

    // ---- the Redpanda Cloud code is left as written ---------------------------
    await reset()
    await load()
    await page.click('#group-1 #_tabs_1_redpanda_cloud')
    const env = await codeText('env-block')
    check('no form is added to the page', (await page.$$('form')).length === 0)
    check('the env.cloud.example placeholders are left as written', env.includes('REDPANDA_BROKERS=<bootstrap-server-url>') &&
      env.includes('REDPANDA_SASL_USERNAME=<user>') && env.includes('REDPANDA_SCHEMA_REGISTRY_URL=<schema-registry-url>'), env)

    check('no uncaught page errors', pageErrors.length === 0, pageErrors.join('; '))
  } finally {
    await browser.close()
    server.close()
  }

  if (failures.length) {
    console.log(`\n${failures.length} solution-platform check(s) failed.`)
    process.exit(1)
  }
  console.log('\nAll solution-platform checks passed.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
