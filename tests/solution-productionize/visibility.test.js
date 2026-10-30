'use strict'
/**
 * The Take this to production card and its done-panel links, rendered from
 * the real partials with the repository's Handlebars helpers, then driven by
 * src/js/33-solution-productionize.js in a vm against a linkedom DOM.
 *
 * Covers the states the card can be in: signed out, signed in, the
 * productionize integration switched off, the companion fetch failing, a
 * split companion (its parts fetched and merged, a part failing, a part URL
 * off this origin), and the done-panel links from the last step, another
 * step and the overview.
 *
 * Needs linkedom (a devDependency); without it the suite is skipped.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const Handlebars = require('handlebars')

const ROOT = path.join(__dirname, '..', '..')
const SCRIPT = fs.readFileSync(path.join(ROOT, 'src/js/33-solution-productionize.js'), 'utf8')
const ORIGIN = 'https://deploy-preview-1--docs.example.test'
const SLUG = 'multiplayer-gaming'
const TITLE = 'Keep a live leaderboard current as game events stream in'
const STEPS = ['start-environment', 'create-topics', 'verify-end-to-end']
const stepUrl = (id) => `/solutions/${SLUG}/${id}/`
const LAST_ID = STEPS[STEPS.length - 1]
const LAST = stepUrl(LAST_ID)

let parseHTML = null
try { ({ parseHTML } = require('linkedom')) } catch { /* reported below */ }
const skip = parseHTML ? false : 'linkedom is not installed (npm ci)'

// The repository's helpers and partials, registered the way the UI build
// registers them: one helper per file, named after it.
const hbs = Handlebars.create()
for (const file of fs.readdirSync(path.join(ROOT, 'src/helpers'))) {
  if (file.endsWith('.js')) hbs.registerHelper(path.basename(file, '.js'), require(path.join(ROOT, 'src/helpers', file)))
}
for (const file of fs.readdirSync(path.join(ROOT, 'src/partials'))) {
  if (file.endsWith('.hbs')) hbs.registerPartial(path.basename(file, '.hbs'), fs.readFileSync(path.join(ROOT, 'src/partials', file), 'utf8'))
}

const SOLUTION = {
  id: SLUG,
  version: 'v1.0.0',
  title: TITLE,
  download: 'authenticated',
  files: [],
  steps: STEPS.map((id, i) => ({ id, url: stepUrl(id), title: 'Title of ' + id, order: i + 1 })),
}

// The step body the way layouts/solution-step.hbs builds it: on the last step
// the card goes directly after Production considerations, which is last
// here, as it is on the real pages, ahead of the footnotes. The aside is the
// step rail, with the quiz and production entries under Your progress.
const LAYOUT = fs.readFileSync(path.join(ROOT, 'src/layouts/solution-step.hbs'), 'utf8')
const CONTENTS = `<div class="sect1"><h2 id="clean-up">Clean up</h2><div class="sectionbody"><p>Stop it.</p></div></div>
<div class="sect1"><h2 id="production-considerations">Production considerations</h2><div class="sectionbody">
<div class="sect2"><h3 id="prod-security">Security</h3></div>
<div class="sect2"><h3 id="prod-recovery-point-and-time">Recovery point and recovery time</h3></div>
</div></div>
<div id="footnotes"><hr></div>`

const PAGE = hbs.compile(`<!DOCTYPE html>
<html><body class="article {{bodyClass}}" data-solution-id="{{solution.id}}" data-solution-version="{{solution.version}}" data-solution-title="{{solution.title}}" data-solution-tested-on="Docker"{{#if page.attributes.solution-step-id}} data-step-id="{{page.attributes.solution-step-id}}"{{/if}}>
<ol>{{#each solution.steps}}<li data-sol-nav-step="{{id}}" data-sol-nav-url="{{url}}"><span class="sol-nav-step-title">{{title}}</span></li>{{/each}}</ol>
<article class="doc sol-doc">
{{#if page.attributes.solution-step-id}}
{{#if page.attributes.solution-next-url}}
{{{page.contents}}}
{{else}}
{{#with (split-after-section page.contents 'production-considerations') as |parts|}}
{{{parts.before}}}
{{> solution-productionize solution=@root.solution}}
{{{parts.after}}}
{{/with}}
{{/if}}
{{> solution-step-actions solution=solution}}
{{else}}{{{page.contents}}}{{/if}}
</article>
<aside>{{> solution-progress solution=solution}}{{#if page.attributes.solution-step-id}}{{> solution-step-rail-actions solution=solution}}{{/if}}</aside>
</body></html>`)

function render (o) {
  const attributes = { 'solution-verified-version': '26.2.1' }
  let url = `/solutions/${SLUG}/`
  if (o.step) {
    const i = STEPS.indexOf(o.step)
    url = stepUrl(o.step)
    attributes['solution-step-id'] = o.step
    if (i > 0) attributes['solution-prev-url'] = stepUrl(STEPS[i - 1])
    if (i < STEPS.length - 1) attributes['solution-next-url'] = stepUrl(STEPS[i + 1])
  }
  Object.assign(attributes, o.attributes)
  return PAGE({ solution: SOLUTION, bodyClass: o.step ? 'solution-step' : 'solution', page: { url, title: 'T', attributes, contents: CONTENTS }, site: { path: '', ...o.site } }, {
    data: { root: { solution: SOLUTION, page: { url, title: 'T', attributes, contents: CONTENTS }, site: { path: '', ...o.site } } },
  })
}

const COMPANION = `# Agent companion: ${TITLE}

Generated from the ${SLUG} solution (v1.0.0). Human guide: https://docs.redpanda.com/solutions/${SLUG}/

## Rules

1. Rule one. (from [Start the environment](https://docs.redpanda.com/solutions/${SLUG}/start-environment/))
2. Rule two.
3. Rule three.

## Adapt

- [ ] Rule 1: Find it.

## Design contract

### 1. Start the environment

Entry one.

### 2. Create the topics

Entry two.

### 3. Verify the system end to end

Entry three.

## Acceptance

- [ ] Rule 1 holds.

## Production gaps

### Security

Use TLS.

### Recovery point and recovery time

Measure it.

### Rollback

Plan it.
`

function response (status, text) {
  return { ok: status >= 200 && status < 300, status, text: () => Promise.resolve(text) }
}

// The page with the card's script run on it. `o`: step, signedIn,
// integration (the productionize id; '' switches it off), fetch (a function
// returning a response), clipboard (false for none, 'reject' to fail).
function load (o) {
  const opts = Object.assign({ step: STEPS[STEPS.length - 1], signedIn: true, integration: 'prod-id' }, o)
  const { document } = parseHTML(render(opts))
  // A window of its own: properties set on linkedom's window land on the
  // test process's globalThis, so a stubbed fetch or __docsChatMode would leak
  // from one test into the next.
  const handlers = {}
  const window = {
    CustomEvent: class { constructor (type, init) { this.type = type; this.detail = init && init.detail } },
    addEventListener: (type, fn) => { (handlers[type] = handlers[type] || []).push(fn) },
    dispatchEvent: (e) => { (handlers[e.type] || []).slice().forEach((fn) => fn(e)); return true },
    navigator: {},
  }
  const calls = { fetch: [], open: [], panel: 0, events: [], tracked: [], copied: [] }
  window.location = { origin: ORIGIN, pathname: opts.step ? stepUrl(opts.step) : `/solutions/${SLUG}/`, search: '', hash: '' }
  window.KAPA_PRODUCTIONIZE_INTEGRATION_ID = opts.integration
  if (opts.uiPreview) window.isUiPreview = true
  let signedIn = opts.signedIn
  window.docsSolutions = {
    signedIn: () => signedIn,
    baseProps: (extra) => Object.assign({ solution_id: SLUG, solution_version: 'v1.0.0', step_id: opts.step }, extra),
    track: (name, props) => calls.tracked.push({ name, props }),
  }
  window.fetch = (url, init) => {
    calls.fetch.push(url)
    // Like the real fetch, a network error is a rejection, never a throw.
    return new Promise((resolve) => resolve((opts.fetch || (() => response(200, COMPANION)))(url, init)))
  }
  window.navigator.clipboard = opts.clipboard === false
    ? undefined
    : { writeText: (text) => { calls.copied.push(text); return opts.clipboard === 'reject' ? Promise.reject(new Error('denied')) : Promise.resolve() } }
  window.openChatWithQuery = (query, autoSubmit, modeOpts) => calls.open.push({ query, autoSubmit, modeOpts })
  window.openChatPanel = () => { calls.panel++ }
  window.endChatMode = (reason) => {
    const active = window.__docsChatMode
    window.__docsChatMode = null
    window.dispatchEvent(new window.CustomEvent('docs-chat:mode-end', { detail: { reason, mode: active && active.mode } }))
  }
  for (const name of ['docs-account:open-signin', 'docs-chat:mode']) {
    window.addEventListener(name, (e) => calls.events.push({ name, detail: e.detail }))
  }
  if (!opts.noScript) vm.runInNewContext(SCRIPT, { window, document, URL, console })
  const $ = (sel) => document.querySelector(sel)
  return {
    window,
    document,
    calls,
    $,
    card: $('[data-sol-productionize]'),
    plan: $('[data-sol-productionize-plan]'),
    label: $('[data-sol-productionize-plan-label]'),
    copy: $('[data-sol-productionize-copy]'),
    note: $('[data-sol-productionize-note]'),
    preview: $('[data-sol-productionize-preview]'),
    status: $('[data-sol-productionize-status]'),
    signin: $('[data-sol-productionize-signin]'),
    signIn: (value) => { signedIn = value; window.dispatchEvent(new window.CustomEvent('kapa-session', { detail: {} })) },
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

test('the card is on the last step only', { skip }, () => {
  assert.ok(load({}).card, 'last step')
  assert.equal(load({}).card.querySelector('h2').id, 'take-to-production')
  assert.equal(load({ step: STEPS[0] }).card, null, 'first step')
  assert.equal(load({ step: null }).card, null, 'overview')
})

test('the card follows Production considerations, ahead of the step actions, and On this page lists it', { skip }, () => {
  const { document } = load({})
  // The on-this-page TOC's own selector for h2 entries (02-on-this-page.js).
  const toc = Array.from(document.querySelectorAll('article.doc>.sect1>h2[id]')).map((h) => h.id)
  assert.deepEqual(toc, ['clean-up', 'production-considerations', 'take-to-production'])
  const order = Array.from(document.querySelector('article.doc').children).map((el) =>
    el.matches('[data-sol-productionize]') ? 'card' : el.matches('.sol-step-actions') ? 'actions' : el.id || el.querySelector('h2')?.id)
  assert.deepEqual(order.filter(Boolean), ['clean-up', 'production-considerations', 'card', 'footnotes', 'actions'])
  // The layout places it with the same helper and section id.
  assert.match(LAYOUT, /split-after-section page\.contents 'production-considerations'/)
  assert.match(LAYOUT, /\{\{> solution-productionize solution=/)
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'src/partials/solution-step-actions.hbs'), 'utf8'), /solution-productionize solution/)
})

test('the step rail offers the quiz and the way into production on every step', { skip }, () => {
  for (const [step, href] of [[STEPS[0], '../verify-end-to-end/#take-to-production'], [LAST_ID, '#take-to-production']]) {
    const { document } = load({ step })
    const rail = document.querySelector('aside [data-sol-rail-actions]')
    assert.ok(rail, step)
    assert.ok(rail.querySelector('[data-sol-quiz]'), 'the quiz button, with the same data attribute the script binds')
    const link = rail.querySelector('[data-sol-productionize-link]')
    assert.equal(link.getAttribute('href'), href)
    assert.equal(link.getAttribute('data-placement'), 'rail')
  }
  assert.equal(load({ step: null }).document.querySelector('[data-sol-rail-actions]'), null, 'not on the overview')
})

// The card's text a reader can see: every text node with no hidden element
// above it, and not inside a closed <details> past its <summary>.
function visibleText (root) {
  const out = []
  const walk = (el) => {
    if (el.nodeType === 3) { if (el.textContent.trim()) out.push(el.textContent.replace(/\s+/g, ' ').trim()); return }
    if (el.nodeType !== 1 || el.hasAttribute('hidden')) return
    const tag = el.tagName.toLowerCase()
    if (tag === 'script' || tag === 'template') return
    Array.from(el.childNodes).forEach((c) => {
      if (tag === 'details' && !el.open && !(c.nodeType === 1 && c.tagName.toLowerCase() === 'summary')) return
      walk(c)
    })
  }
  walk(root)
  return out
}
const visible = (el) => { for (let n = el; n && n.nodeType === 1; n = n.parentNode) if (n.hasAttribute('hidden')) return false; return true }
const SIGNED_OUT_TEXT = ['Take this to production',
  'Sign in to have Ask AI plan this design for your system, get a prompt for your coding agent, and see how to connect the docs MCP server.',
  'Sign in']
const GATED = ['[data-sol-productionize-plan]', '[data-sol-productionize-copy]', '[data-sol-productionize-preview]',
  '[data-sol-productionize-skill]', '[data-sol-productionize-mcp]']

function assertSignedOut (page, where) {
  assert.deepEqual(visibleText(page.card), SIGNED_OUT_TEXT, where)
  assert.ok(visible(page.signin), where + ': Sign in is visible')
  for (const sel of GATED) {
    const el = page.$(sel)
    if (el) assert.ok(!visible(el), `${where}: ${sel} is hidden`)
  }
  // No prompt in the page at all, visible or not.
  assert.doesNotMatch(page.card.textContent, /Take this design to production|curl -sf/, where)
}

test('signed out: only the title, the sentence and Sign in, and no prompt in the page', { skip }, () => {
  for (const site of [{}, { keys: { solutionsSkillInstall: 'true' } }]) {
    const page = load({ signedIn: false, site })
    assertSignedOut(page, site.keys ? 'skills on' : 'skills off')
    assert.equal(page.calls.fetch.length, 0)
  }
})

test('without the script, the card is in its signed-out state', { skip }, () => {
  for (const signedIn of [false, true]) assertSignedOut(load({ signedIn, noScript: true }), 'no script, signedIn ' + signedIn)
})

test('the UI preview, with no backend, shows the signed-out card and its Sign in opens the modal', { skip }, () => {
  const page = load({ signedIn: false, uiPreview: true })
  assertSignedOut(page, 'ui preview')
  page.signin.click()
  assert.ok(page.calls.events.some((e) => e.name === 'docs-account:open-signin'))
})

test('signed in: the whole card shows, and the sign-in block does not', { skip }, () => {
  const page = load({ site: { keys: { solutionsSkillInstall: 'true' } } })
  assert.ok(!visible(page.signin))
  assert.ok(!visible(page.$('[data-sol-productionize-signedout]')))
  for (const sel of GATED) assert.ok(visible(page.$(sel)), sel)
  const text = visibleText(page.card)
  assert.ok(text.includes('Turn the reference build into a plan for your own system: your deployment, your scale, your security model.'))
  assert.ok(text.includes('Plan it with Ask AI'))
  assert.ok(text.includes('Copy prompt for your coding agent'))
  assert.ok(text.includes('Preview prompt'))
  assert.ok(!text.includes('Sign in'), 'no Sign in for a signed-in reader')
  assert.match(page.$('[data-sol-productionize-prompt]').textContent, /^# Take this design to production: /)
})

test('signing in after load opens the whole card without a reload', { skip }, async () => {
  const page = load({ signedIn: false })
  assertSignedOut(page, 'before')
  page.signIn(true)
  for (const sel of GATED.filter((x) => x !== '[data-sol-productionize-skill]')) assert.ok(visible(page.$(sel)), sel)
  assert.ok(!visible(page.signin))
  assert.match(page.$('[data-sol-productionize-prompt]').textContent, /^# Take this design to production: /)
  page.plan.click()
  await flush()
  assert.equal(page.window.__docsChatMode.mode, 'productionize')
  // And back: a sign-out the page hears about closes the card again.
  page.signIn(false)
  assert.ok(visible(page.signin))
  for (const sel of GATED) { const el = page.$(sel); if (el) assert.ok(!visible(el), sel) }
})

test('signed out: Sign in opens the sign-in modal and returns to the card', { skip }, () => {
  const page = load({ signedIn: false })
  page.signin.click()
  const signin = page.calls.events.find((e) => e.name === 'docs-account:open-signin')
  assert.ok(signin, 'opened the sign-in modal')
  assert.equal(signin.detail.returnTo, LAST + '#take-to-production')
  // 26-docs-account.js accepts it as a same-site path and encodes it into
  // return_to, so the hash survives the sign-in round trip.
  assert.match(signin.detail.returnTo, /^\/(?![/\\])/)
  assert.ok(encodeURIComponent(signin.detail.returnTo).endsWith('%23take-to-production'))
  assert.equal(page.calls.fetch.length, 0, 'nothing fetched before sign-in')
  assert.equal(page.calls.open.length, 0)
})

test('signed in: a click fetches the companion from this origin and starts the planner', { skip }, async () => {
  const page = load({})
  assert.equal(page.label.textContent, 'Plan it with Ask AI')
  page.plan.click()
  await flush()
  assert.deepEqual(page.calls.fetch, [`${ORIGIN}/solutions/${SLUG}/agent-companion.md`])
  const mode = page.window.__docsChatMode
  assert.equal(mode.mode, 'productionize')
  assert.equal(mode.title, TITLE)
  assert.equal(mode.verifiedVersion, '26.2.1')
  assert.deepEqual([...mode.guide.topics], ['Security', 'Recovery point and recovery time', 'Rollback'])
  const url = (name) => mode.guide.sections.find((s) => s.section === name).guide_url
  assert.equal(url('Security'), `${ORIGIN}${LAST}#prod-security`)
  assert.equal(url('Recovery point and recovery time'), `${ORIGIN}${LAST}#prod-recovery-point-and-time`)
  assert.equal(url('Rollback'), `${ORIGIN}${LAST}#production-considerations`)
  assert.equal(url('step:2'), `${ORIGIN}${stepUrl(STEPS[1])}`)
  assert.ok(mode.guide.rules.includes(`${ORIGIN}/solutions/${SLUG}/start-environment/`), 'rules rewritten to this origin')
  assert.deepEqual(JSON.parse(JSON.stringify(page.calls.open)), [{
    query: `Help me take this design to production: ${TITLE}.`,
    autoSubmit: true,
    modeOpts: { mode: 'productionize', nonce: mode.nonce },
  }])
  assert.ok(page.calls.events.some((e) => e.name === 'docs-chat:mode' && e.detail.nonce === mode.nonce))
  assert.ok(page.calls.tracked.some((t) => t.name === 'solution_productionize_start' && t.props.topics === 3))
  // The drawer's guide link comes from this.
  assert.equal(mode.guideUrl, `${ORIGIN}/solutions/${SLUG}/`)
  assert.equal(mode.companionUrl, `${ORIGIN}/solutions/${SLUG}/agent-companion.md`)
  // Hand this plan to your coding agent carries from=handoff; the page's own
  // fetch above carries no marker.
  assert.ok(mode.agentPrompt.includes(`curl -sf '${ORIGIN}/solutions/${SLUG}/agent-companion.md?from=handoff'\``))
  assert.ok(!mode.agentPrompt.includes('from=prompt'))
})

test('a second click before the companion arrives starts one plan, not two', { skip }, async () => {
  const page = load({})
  page.plan.click()
  assert.equal(page.plan.disabled, true, 'the button is disabled while the companion loads')
  page.plan.click()
  await flush()
  await flush()
  assert.equal(page.calls.fetch.length, 1)
  assert.equal(page.calls.open.length, 1, 'one opener')
  assert.equal(page.calls.events.filter((e) => e.name === 'docs-chat:mode').length, 1, 'one mode start')
  assert.equal(page.plan.disabled, false)
})

test('sign-in, copy and opening the MCP block are tracked', { skip }, async () => {
  const out = load({ signedIn: false })
  out.signin.click()
  assert.ok(out.calls.tracked.some((t) => t.name === 'solution_productionize_signin'))
  const page = load({})
  page.copy.click()
  await flush()
  const copied = page.calls.tracked.find((t) => t.name === 'solution_productionize_copy')
  assert.ok(copied && copied.props.chars === page.calls.copied[0].length)
  const mcp = page.$('[data-sol-productionize-mcp]')
  mcp.open = true
  const Event = page.document.defaultView.Event
  mcp.dispatchEvent(new Event('toggle'))
  mcp.dispatchEvent(new Event('toggle'))
  assert.equal(page.calls.tracked.filter((t) => t.name === 'solution_productionize_mcp_open').length, 1, 'once per page')
})

test('a second click while the plan runs only reopens the drawer', { skip }, async () => {
  const page = load({})
  page.plan.click()
  await flush()
  page.plan.click()
  await flush()
  assert.equal(page.calls.open.length, 1)
  assert.equal(page.calls.panel, 1)
  assert.equal(page.calls.fetch.length, 1)
})

test('after the plan ends, a click starts a new one from the cached companion', { skip }, async () => {
  const page = load({})
  page.plan.click()
  await flush()
  const first = page.window.__docsChatMode.nonce
  page.window.endChatMode('back_to_ask')
  await new Promise((resolve) => setTimeout(resolve, 2))
  page.plan.click()
  await flush()
  assert.equal(page.calls.open.length, 2)
  assert.notEqual(page.window.__docsChatMode.nonce, first)
  assert.equal(page.calls.fetch.length, 1)
})

test('a running quiz ends before the planner starts', { skip }, async () => {
  const page = load({})
  page.window.__docsChatMode = { mode: 'quiz', nonce: 1 }
  const ended = []
  page.window.addEventListener('docs-chat:mode-end', (e) => ended.push(e.detail))
  page.plan.click()
  await flush()
  assert.deepEqual(ended, [{ reason: 'other_mode', mode: 'quiz' }])
  assert.equal(page.window.__docsChatMode.mode, 'productionize')
})

test('with the integration switched off the plan button is hidden and the prompt still offered', { skip }, () => {
  const page = load({ integration: '' })
  assert.equal(page.plan.hidden, true)
  assert.equal(page.copy.hidden, false)
  assert.equal(page.preview.hidden, false)
  assert.equal(page.note.hidden, true)
})

for (const [name, fetch] of [
  ['a 404', () => response(404, 'Not found')],
  ['a page that is not a companion', () => response(200, '<!DOCTYPE html><html>Not found</html>')],
  ['a network error', () => { throw new Error('offline') }],
]) {
  test(`a companion fetch that fails (${name}) hides the plan and says the prompt still works`, { skip }, async () => {
    const page = load({ fetch })
    page.plan.click()
    await flush()
    await flush()
    assert.equal(page.plan.hidden, true)
    assert.equal(page.note.hidden, false)
    assert.match(page.note.textContent, /The prompt for your coding agent still works\./)
    assert.equal(page.copy.hidden, false)
    assert.equal(page.calls.open.length, 0)
    assert.equal(page.window.__docsChatMode, undefined)
    assert.ok(page.calls.tracked.some((t) => t.name === 'solution_productionize_unavailable'))
  })
}

// The flagship as the docs extensions generate it (fixtures/, written by
// build-split-fixtures.js): split into a core and parts, and from the
// generator before the split, as one file.
const FIXTURES = path.join(__dirname, 'fixtures')
function fixture (name) {
  const dir = path.join(FIXTURES, name)
  const out = {}
  for (const f of fs.readdirSync(dir)) out[`${ORIGIN}/solutions/${SLUG}/${f}`] = fs.readFileSync(path.join(dir, f), 'utf8')
  return out
}
const CORE_URL = `${ORIGIN}/solutions/${SLUG}/agent-companion.md`
const partUrl = (n) => `${ORIGIN}/solutions/${SLUG}/agent-companion-part-${n}.md`

// A fetch that serves `files` by URL and 404s anything else.
const serve = (files) => (url) => (Object.prototype.hasOwnProperty.call(files, url) ? response(200, files[url]) : response(404, 'Not found'))

async function planned (o) {
  const page = load(o)
  page.plan.click()
  for (let i = 0; i < 4; i++) await flush()
  return page
}

function assertUnavailable (page) {
  assert.equal(page.plan.hidden, true)
  assert.equal(page.note.hidden, false)
  assert.equal(page.copy.hidden, false)
  assert.equal(page.calls.open.length, 0)
  assert.equal(page.window.__docsChatMode, undefined, 'no guide with sections missing')
  assert.ok(page.calls.tracked.some((t) => t.name === 'solution_productionize_unavailable'))
}

test('a split companion: the core and every part it lists are fetched and read as one', { skip }, async () => {
  const files = fixture('multiplayer-gaming')
  const inits = []
  const page = await planned({ fetch: (url, init) => { inits.push(init); return serve(files)(url) } })
  assert.deepEqual(page.calls.fetch, [CORE_URL, partUrl(1), partUrl(2)])
  for (const init of inits) assert.equal(init.credentials, 'same-origin')
  const mode = page.window.__docsChatMode
  assert.equal(mode.mode, 'productionize')
  const names = mode.guide.sections.map((s) => s.section)
  // Design contract entries and Reference build come from the parts.
  for (let n = 1; n <= mode.guide.steps; n++) assert.ok(names.includes('step:' + n), 'step:' + n)
  assert.ok(mode.guide.steps >= 8)
  // A Reference build too long for one result comes as sub-sections.
  assert.ok(names.includes('Reference build') || names.includes('Reference build: overview'))
  assert.ok(names.includes('Adapt') && names.includes('Acceptance') && names.includes('System map'))
  // The same guide the unsplit flagship gives.
  const whole = await planned({ fetch: serve(fixture('multiplayer-gaming-unsplit')) })
  assert.deepEqual(whole.calls.fetch, [CORE_URL], 'an unsplit companion is one fetch')
  assert.deepEqual(JSON.parse(JSON.stringify(mode.guide.sections)), JSON.parse(JSON.stringify(whole.window.__docsChatMode.guide.sections)))
})

for (const [name, fail] of [
  ['a 404', () => response(404, 'Not found')],
  ['a page that is not a part', () => response(200, '<!DOCTYPE html><html>Not found</html>')],
  ['a network error', () => { throw new Error('offline') }],
]) {
  test(`a split companion whose part fails (${name}) is unavailable, as when the core fails`, { skip }, async () => {
    const files = fixture('multiplayer-gaming')
    const page = await planned({ fetch: (url) => (url === partUrl(2) ? fail() : serve(files)(url)) })
    assert.ok(page.calls.fetch.includes(partUrl(2)))
    assertUnavailable(page)
  })
}

test('a part URL off this origin is never fetched, and the guide is not offered without that part', { skip }, async () => {
  const files = fixture('multiplayer-gaming')
  const evil = `https://attacker.example/solutions/${SLUG}/agent-companion-part-2.md`
  files[CORE_URL] = files[CORE_URL].split(`https://docs.redpanda.com/solutions/${SLUG}/agent-companion-part-2.md`).join(evil)
  const page = await planned({ fetch: serve(files) })
  assert.ok(!page.calls.fetch.includes(evil), 'the off-origin URL is not fetched')
  assert.ok(page.calls.fetch.every((u) => u.startsWith(ORIGIN + '/')))
  // Part 1 says it is one of two, so the guide is incomplete without part 2.
  assertUnavailable(page)
})

test('an extra part URL off this origin is ignored, and the listed parts still make the guide', { skip }, async () => {
  const files = fixture('multiplayer-gaming')
  const evil = `https://attacker.example/solutions/${SLUG}/agent-companion-part-3.md`
  files[CORE_URL] = files[CORE_URL].replace(/(\n {3}- Part 2 [^\n]*)/, `$1\n   - Part 3 (Extra): \`curl -sf ${evil}\``)
  assert.ok(files[CORE_URL].includes(evil), 'the fixture lists the extra part')
  const page = await planned({ fetch: serve(files) })
  assert.deepEqual(page.calls.fetch, [CORE_URL, partUrl(1), partUrl(2)])
  assert.equal(page.window.__docsChatMode.mode, 'productionize')
})

test('the prompt is shown in Preview prompt and copied as it is', { skip }, async () => {
  const page = load({})
  const shown = page.$('[data-sol-productionize-prompt]').textContent
  assert.ok(shown.startsWith(`# Take this design to production: ${TITLE}`))
  assert.ok(shown.includes(`curl -sf '${ORIGIN}/solutions/${SLUG}/agent-companion.md?from=prompt'\``))
  page.copy.click()
  await flush()
  assert.deepEqual(page.calls.copied, [shown])
  assert.equal(page.status.textContent, 'Copied the prompt.')
})

test('a copy that fails opens the preview instead', { skip }, async () => {
  for (const clipboard of ['reject', false]) {
    const page = load({ clipboard })
    page.copy.click()
    await flush()
    assert.equal(page.preview.open, true)
    assert.match(page.status.textContent, /Open Preview prompt/)
  }
})

test('the MCP block names the server, the Claude Code command and the VS Code one-click', { skip }, () => {
  const page = load({})
  const block = page.$('[data-sol-mcp-block]')
  const text = block.textContent.replace(/\s+/g, ' ')
  assert.ok(text.includes('Server URL: https://docs.redpanda.com/mcp'))
  assert.ok(text.includes('claude mcp add --scope user --transport http redpanda https://docs.redpanda.com/mcp'))
  assert.ok(text.includes('Check it with: claude mcp list'))
  assert.ok(text.includes('Without signing in you get 10 tool calls every 24 hours per network address.'))
  const vscode = page.$('[data-sol-mcp-vscode]').getAttribute('href')
  assert.ok(vscode.startsWith('vscode:mcp/install?'))
  // The same server config as Page options > Add MCP server to VS Code.
  assert.deepEqual(JSON.parse(decodeURIComponent(vscode.split('?')[1])), { name: 'Redpanda Documentation', url: 'https://docs.redpanda.com/mcp' })
  const dropdown = fs.readFileSync(path.join(ROOT, 'src/js/14-markdown-dropdown.js'), 'utf8')
  assert.ok(dropdown.includes("name: 'Redpanda Documentation'") && dropdown.includes("url: 'https://docs.redpanda.com/mcp'"))
  const other = Array.from(block.querySelectorAll('a')).find((a) => a.textContent === 'How to use these docs')
  assert.equal(other.getAttribute('href'), '../../../home/how-to-use-these-docs/')
})

test('the skills install shows only when the playbook turns it on, and retitles the MCP block', { skip }, () => {
  const off = load({})
  assert.equal(off.$('[data-sol-productionize-skill]'), null)
  assert.equal(off.$('[data-sol-productionize-mcp] > summary').textContent.trim(), 'Connect the docs MCP server')
  const on = load({ site: { keys: { solutionsSkillInstall: 'true' } } })
  const skill = on.$('[data-sol-productionize-skill]')
  assert.ok(skill)
  assert.ok(skill.textContent.includes('claude plugin marketplace add redpanda-data/skills && claude plugin install redpanda@redpanda-skills'))
  // Ahead of the MCP block, which the plugin makes the other agents' path.
  assert.ok(skill.compareDocumentPosition(on.$('[data-sol-productionize-mcp]')) & 4)
  assert.equal(on.$('[data-sol-productionize-mcp] > summary').textContent.trim(), 'Using another coding agent? Connect the docs MCP server')
})

test('done panels link to the card: a scroll on the last step, the last step elsewhere', { skip }, () => {
  const hrefs = (page) => Array.from(page.document.querySelectorAll('[data-sol-done] [data-sol-productionize-link]')).map((a) => a.getAttribute('href'))
  assert.deepEqual(hrefs(load({})), ['#take-to-production', '#take-to-production'], 'last step: inline and rail')
  assert.deepEqual(hrefs(load({ step: STEPS[0] })), ['../verify-end-to-end/#take-to-production', '../verify-end-to-end/#take-to-production'])
  assert.deepEqual(hrefs(load({ step: null })), ['verify-end-to-end/#take-to-production'], 'overview: rail only')
  for (const a of load({}).document.querySelectorAll('[data-sol-productionize-link]:not([data-placement])')) {
    assert.equal(a.textContent, 'Take this to production')
    assert.ok(a.closest('[data-sol-done]'), 'inside a done panel')
  }
})

test('the quiz button carries the step\'s rule and adapt line from the page attributes', { skip }, () => {
  const html = render({ step: STEPS[1], attributes: { 'solution-rule': 'Key by player.', 'solution-adapt': 'Find each topic key.' } })
  const { document } = parseHTML(html)
  const button = document.querySelector('[data-sol-quiz]')
  assert.ok(button, 'the quiz button renders')
  assert.equal(button.getAttribute('data-quiz-rule'), 'Key by player.')
  assert.equal(button.getAttribute('data-quiz-adapt'), 'Find each topic key.')
  // Without the attributes the button leaves them off rather than sending empty lines.
  const bare = parseHTML(render({ step: STEPS[1] })).document.querySelector('[data-sol-quiz]')
  assert.equal(bare.hasAttribute('data-quiz-rule'), false)
  assert.equal(bare.hasAttribute('data-quiz-adapt'), false)
})
