/* global localStorage, sessionStorage, CustomEvent */
/**
 * 34-solution-platform.js in a real browser, with the real tabs script
 * (@asciidoctor/tabs), Prism, 11-editable-placeholders.js,
 * 06-copy-to-clipboard.js and 28-solution-progress.js, because the
 * placeholder spans, the tab sync and the copy button all come from those.
 *
 * Covers: the platform pick is recorded, a newer platform from signed-in
 * progress selects its tab and an older one does not; the Your cluster form
 * (labels, hint, no password field), values filled into the Redpanda Cloud
 * code and env.cloud.example only, <password> and comment lines left alone,
 * the copy button copying the filled text, invalid input refused, markup in a
 * value staying text, Clear restoring the placeholders, and the values
 * surviving a reload.
 */
const puppeteer = require('puppeteer')
const express = require('express')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')
const STORE_KEY = 'docs-solutions-progress'
const TAB_KEY = 'preferred-tab-platform'
const BS = 'seed-1a2b.byoc.prd.cloud.redpanda.com:9092'
const SR = 'https://schema-registry-1a2b.byoc.prd.cloud.redpanda.com:30081'

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

    // ---- Your cluster: the form ------------------------------------------------
    await reset()
    await load()
    await page.click('#group-1 #_tabs_1_redpanda_cloud')
    const form = await page.evaluate(() => {
      const forms = [...document.querySelectorAll('form[data-sol-cluster]')]
      const f = forms[0]
      return {
        count: forms.length,
        inCloudTab: !!(f && f.closest('.platform-cloud')),
        beforeEnv: !!(f && f.nextElementSibling && f.nextElementSibling.id === 'env-block'),
        legend: f && f.querySelector('legend').textContent,
        labels: f ? [...f.querySelectorAll('label')].map((l) => l.textContent + '>' + (document.getElementById(l.htmlFor) || {}).tagName) : [],
        buttons: f ? [...f.querySelectorAll('button')].map((b) => b.textContent) : [],
        hint: f && f.querySelector('.sol-cluster-hint').textContent,
        passwordInputs: document.querySelectorAll('input[type="password"]').length,
        names: f ? [...f.querySelectorAll('input')].map((i) => i.name) : [],
      }
    })
    check('one form, in the Redpanda Cloud tab with placeholders, before the env.cloud.example listing', form.count === 1 && form.inCloudTab && form.beforeEnv, JSON.stringify(form))
    check('labels and buttons', form.legend === 'Your cluster' &&
      JSON.stringify(form.labels) === '["Bootstrap server URL>INPUT","Schema Registry URL>INPUT","Username>INPUT"]' &&
      JSON.stringify(form.buttons) === '["Save","Clear"]', JSON.stringify(form))
    check('hint text', form.hint === 'These values fill in the commands on this page. Never enter a password here.', form.hint)
    check('no password field anywhere', form.passwordInputs === 0 && !form.names.some((n) => /pass|secret|token/i.test(n)), JSON.stringify(form.names))

    // ---- Your cluster: save fills the Cloud code only ------------------------
    const type = async (field, value) => {
      await page.$eval(`[data-sol-cluster-input="${field}"]`, (el) => { el.value = '' })
      if (value) await page.type(`[data-sol-cluster-input="${field}"]`, value)
    }
    await type('bootstrap', BS)
    await type('schemaRegistry', SR)
    await type('user', 'ada')
    await page.click('form[data-sol-cluster] button[type="submit"]')
    const env = await codeText('env-block')
    const lines = env.split('\n')
    check('the bootstrap server is filled in', lines.includes('REDPANDA_BROKERS=' + BS), env)
    check('the Schema Registry URL is filled in', lines.includes('REDPANDA_SCHEMA_REGISTRY_URL=' + SR), env)
    check('the username is filled in', lines.includes('REDPANDA_SASL_USERNAME=ada'), env)
    check('<password> is left as it is', lines.includes('REDPANDA_SASL_PASSWORD=<password>'), env)
    check('a comment line keeps its placeholder', lines[0].includes('for example <user> below'), lines[0])
    check('a block type the editable pass skips is filled too', (await codeText('text-block')) === 'Log in as ada at ' + BS, await codeText('text-block'))
    check('a Docker Compose block is not touched', (await codeText('local-block')).includes('user=<user>'), await codeText('local-block'))
    check('a block outside any Cloud tab is not touched', (await codeText('outside-block')) === 'echo <user> <bootstrap-server-url>', await codeText('outside-block'))
    s = await stored()
    check('the values are stored in prefs.cloud', s.prefs.cloud.bootstrap === BS && s.prefs.cloud.schemaRegistry === SR && s.prefs.cloud.user === 'ada' && typeof s.prefs.cloud.at === 'number', JSON.stringify(s.prefs))
    check('the status says saved', (await page.$eval('[data-sol-cluster-status]', (el) => el.textContent)) === 'Saved.')

    // ---- copy ------------------------------------------------------------------
    await page.evaluate(() => { window.__copied = [] })
    await page.click('#env-block .copy-button')
    await new Promise((resolve) => setTimeout(resolve, 100))
    const copied = await page.evaluate(() => window.__copied[0] || '')
    check('the copy button copies the filled text', copied.includes('REDPANDA_BROKERS=' + BS) && copied.includes('REDPANDA_SASL_USERNAME=ada') && copied.includes('REDPANDA_SASL_PASSWORD=<password>'), JSON.stringify(copied))

    // ---- invalid input is refused ---------------------------------------------
    await type('user', '<img src=x onerror="window.__pwned=1">')
    await page.click('form[data-sol-cluster] button[type="submit"]')
    const bad = await page.evaluate(() => {
      const input = document.querySelector('[data-sol-cluster-input="user"]')
      const err = document.querySelector('[data-sol-cluster-error="user"]')
      return { invalid: input.getAttribute('aria-invalid'), error: err.hidden ? null : err.textContent, focused: document.activeElement === input }
    })
    s = await stored()
    check('an invalid username is refused with a message, and nothing changes', bad.invalid === 'true' && !!bad.error && bad.focused && s.prefs.cloud.user === 'ada', JSON.stringify(bad))
    await type('user', 'ada')
    await page.click('form[data-sol-cluster] button[type="submit"]')

    // ---- markup in a value is inert --------------------------------------------
    // The store refuses markup, so hand the fill a value directly: it must land
    // as text, never as an element.
    const inert = await page.evaluate(() => {
      const api = window.docsSolutions
      const real = api.getPrefs
      api.getPrefs = () => ({ cloud: { bootstrap: '<img src=x onerror="window.__pwned=1">', schemaRegistry: null, user: 'ada', at: 1 } })
      window.dispatchEvent(new CustomEvent('docs-solutions:change', { detail: {} }))
      const code = document.querySelector('#env-block pre > code')
      const out = { imgs: code.querySelectorAll('img').length, text: code.textContent }
      api.getPrefs = real
      window.dispatchEvent(new CustomEvent('docs-solutions:change', { detail: {} }))
      return out
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    check('markup in a value is shown as text, never parsed', inert.imgs === 0 && inert.text.includes('REDPANDA_BROKERS=<img src=x onerror="window.__pwned=1">') &&
      !(await page.evaluate(() => window.__pwned)), JSON.stringify(inert))
    check('the stored values come back after that', (await codeText('env-block')).includes('REDPANDA_BROKERS=' + BS))

    // ---- reload keeps the values (signed out: this browser only) --------------
    await load()
    const reloaded = await codeText('env-block')
    check('after a reload the values are filled in again', reloaded.includes('REDPANDA_BROKERS=' + BS) && reloaded.includes('REDPANDA_SASL_USERNAME=ada'), reloaded)
    check('and the form shows them', (await page.$eval('[data-sol-cluster-input="user"]', (el) => el.value)) === 'ada')

    // ---- Clear ------------------------------------------------------------------
    await page.click('#group-1 #_tabs_1_redpanda_cloud')
    await page.click('[data-sol-cluster-clear]')
    const cleared = await codeText('env-block')
    check('Clear restores every placeholder', cleared.includes('REDPANDA_BROKERS=<bootstrap-server-url>') && cleared.includes('REDPANDA_SASL_USERNAME=<user>') &&
      cleared.includes('REDPANDA_SCHEMA_REGISTRY_URL=<schema-registry-url>') && cleared.includes('REDPANDA_SASL_PASSWORD=<password>'), cleared)
    check('Clear restores the skipped block too', (await codeText('text-block')) === 'Log in as <user> at <bootstrap-server-url>')
    s = await stored()
    check('Clear is stored as an empty entry with a time', s.prefs.cloud.bootstrap === null && s.prefs.cloud.schemaRegistry === null && s.prefs.cloud.user === null && typeof s.prefs.cloud.at === 'number', JSON.stringify(s.prefs))
    check('Clear empties the form', (await page.$$eval('[data-sol-cluster-input]', (els) => els.map((e) => e.value).join(''))) === '')

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
