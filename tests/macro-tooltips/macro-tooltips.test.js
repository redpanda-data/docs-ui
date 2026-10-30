'use strict'

// Verifies src/js/28-macro-tooltips.js against the REAL scripts (it and
// 16-bloblang-interactive.js, whose Connect data loading and Bloblang renderer
// it shares) in a real browser page, against the preview fixtures trimmed from
// the real data: preview-src/_data/connect.json (connect-4.115.1.json) and
// preview-src/_data/rpk.json (docs-data/rpk-v26.2.2.json, in the published
// rpk-<version>.json shape). The marked elements are the macros' real output
// (docs-extensions-and-macros macros/blobl.js, connect.js, rpkcmd.js through
// Antora's converter).
//
// tippy is a recording stub, because the page loads tippy from a CDN and the
// test must not need the network. The stub records every instance's reference
// and config; what the reader would see is the config's content.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const puppeteer = require('puppeteer')

const ROOT = path.join(__dirname, '..', '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const BLOBLANG_JS = read('src/js/16-bloblang-interactive.js')
const MACRO_JS = read('src/js/28-macro-tooltips.js')
const FIXTURES = {
  '/data/connect-4.115.1.json': read('preview-src/_data/connect.json'),
  '/data/rpk-v26.2.2.json': read('preview-src/_data/rpk.json'),
}

// The macros' real output (see the header).
const MARKUP = {
  now: '<a href="/connect/guides/bloblang/functions/#now" class="xref page"><code class="bloblang-call" data-bloblang-function="now">now()</code></a>',
  counter: '<a href="/connect/guides/bloblang/functions/#counter" class="xref page"><code class="bloblang-call" data-bloblang-function="counter">counter(min)</code></a>',
  uppercase: '<a href="/connect/guides/bloblang/methods/#uppercase" class="xref page"><code class="bloblang-call" data-bloblang-method="uppercase">.uppercase()</code></a>',
  contains2: '<a href="/connect/guides/bloblang/methods/#contains-2" class="xref page"><code class="bloblang-call" data-bloblang-method="contains">.contains()</code></a>',
  kafkaFranz: '<a href="/connect/components/inputs/kafka_franz/" class="xref page"><code class="connect-component" data-connect-component="inputs/kafka_franz">kafka_franz</code> input</a>',
  retry: '<a href="/connect/components/processors/retry/" class="xref page"><code class="connect-component" data-connect-component="processors/retry">retry</code> processor</a>',
  consumerGroup: '<a href="/connect/components/inputs/kafka_franz/#consumer_group" class="xref page"><code class="connect-component" data-connect-component="inputs/kafka_franz" data-connect-field="consumer_group">consumer_group</code></a>',
  saslMechanism: '<a href="/connect/components/inputs/kafka_franz/#sasl-mechanism" class="xref page"><code class="connect-component" data-connect-component="inputs/kafka_franz" data-connect-field="sasl.mechanism">sasl.mechanism</code></a>',
  tlsEnabled: '<a href="/connect/components/inputs/kafka_franz/#tls-enabled" class="xref page"><code class="connect-component" data-connect-component="inputs/kafka_franz" data-connect-field="tls.enabled">tls.enabled</code></a>',
  topicCreate: '<a href="/streaming/reference/rpk/rpk-topic/rpk-topic-create/" class="xref page"><code class="rpk-command" data-rpk-command="rpk topic create">rpk topic create</code></a>',
  partitions: '<a href="/streaming/reference/rpk/rpk-topic/rpk-topic-create/" class="xref page"><code class="rpk-command" data-rpk-command="rpk topic create" data-rpk-flag="partitions">rpk topic create --partitions</code></a>',
  profile: '<a href="/streaming/reference/rpk/rpk/" class="xref page"><code class="rpk-command" data-rpk-command="rpk" data-rpk-flag="profile">rpk --profile</code></a>',
  missingFunction: '<a href="/connect/guides/bloblang/functions/#nope" class="xref page"><code class="bloblang-call" data-bloblang-function="not_in_data">not_in_data()</code></a>',
  missingField: '<a href="/connect/components/inputs/kafka_franz/#client_id" class="xref page"><code class="connect-component" data-connect-component="inputs/kafka_franz" data-connect-field="client_id">client_id</code></a>',
  missingComponent: '<a href="/connect/components/outputs/kafka/" class="xref page"><code class="connect-component" data-connect-component="outputs/kafka">kafka</code> output</a>',
  missingCommand: '<a href="/streaming/reference/rpk/rpk-topic/rpk-topic-delete/" class="xref page"><code class="rpk-command" data-rpk-command="rpk topic delete">rpk topic delete</code></a>',
  missingFlag: '<a href="/streaming/reference/rpk/rpk-topic/rpk-topic-create/" class="xref page"><code class="rpk-command" data-rpk-command="rpk topic create" data-rpk-flag="not-a-flag">rpk topic create --not-a-flag</code></a>',
}

const METAS = [
  '<meta name="connect-json-url" content="/data/connect-4.115.1.json">',
  '<meta name="rpk-json-url" content="/data/rpk-v26.2.2.json">',
]

let browser

test.before(async () => {
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  })
})

test.after(async () => {
  if (browser) await browser.close()
})

/**
 * Load a page with the given metas and article body, run the real scripts,
 * and return what the reader would get: every tippy instance's reference,
 * content and config, plus the fetches made.
 */
async function decorate ({ metas = METAS, body, fixtures = FIXTURES }) {
  const page = await browser.newPage()
  await page.setContent(`<!doctype html><html><head>${metas.join('')}</head><body><article class="doc">${body}</article></body></html>`)
  await page.evaluate((files) => {
    window.uiRootPath = '/_'
    window.__fetches = []
    window.fetch = (url) => {
      window.__fetches.push(String(url))
      const text = files[url]
      return Promise.resolve(text === undefined
        ? { ok: false, status: 404, json: () => Promise.reject(new Error('404')), text: () => Promise.resolve('') }
        : { ok: true, status: 200, json: () => Promise.resolve(JSON.parse(text)), text: () => Promise.resolve(text) })
    }
    window.__instances = []
    const tippy = (el, config) => {
      const instance = { reference: el, config, shown: 0, show () { this.shown++ }, hide () {} }
      el._tippy = instance
      window.__instances.push(instance)
      return instance
    }
    tippy.hideAll = () => {}
    tippy.currentInput = { isTouch: false }
    window.tippy = tippy
  }, fixtures)
  await page.addScriptTag({ content: BLOBLANG_JS })
  await page.addScriptTag({ content: MACRO_JS })
  await page.waitForFunction(() => window.redpandaMacroTooltips && window.redpandaMacroTooltips.ready)
  await page.evaluate(() => window.redpandaMacroTooltips.ready)
  const result = await page.evaluate(() => ({
    fetches: window.__fetches,
    instances: window.__instances.map((i) => ({
      tag: i.reference.tagName,
      href: i.reference.getAttribute('href'),
      text: i.reference.textContent,
      html: i.config.content,
      hideOnClick: i.config.hideOnClick,
      trigger: i.config.trigger,
      touch: i.config.touch,
      interactive: i.config.interactive,
      hasOnShow: typeof i.config.onShow === 'function',
    })),
    underlined: [...document.querySelectorAll('code.has-macro-tooltip')].map((el) => el.textContent),
  }))
  return { page, ...result }
}

const textOf = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&rarr;|→/g, '->').replace(/\s+/g, ' ').trim()
const byText = (instances, text) => instances.find((i) => i.text === text)

test('Bloblang: the shared renderer shows signature, description and parameters with defaults', async () => {
  const { page, instances } = await decorate({ body: `<p>${MARKUP.now}</p><p>${MARKUP.counter}</p><p>${MARKUP.uppercase}</p><p>${MARKUP.contains2}</p>` })
  await page.close()
  assert.equal(instances.length, 4)

  const now = byText(instances, 'now()')
  assert.equal(now.tag, 'A', 'the tooltip belongs on the link the macro made')
  assert.match(now.html, /class="bloblang-doc-tooltip"/, 'not the 16-bloblang-interactive.js renderer')
  assert.match(textOf(now.html), /^now\(\) Returns the current timestamp as an RFC 3339 formatted string/)
  assert.doesNotMatch(now.html, /Returns:/, 'the data has no return type; none may be made up')
  assert.doesNotMatch(now.html, /doc-example/, 'inline tooltips leave the example out')
  assert.match(now.html, /href="\/connect\/guides\/bloblang\/functions\/#now"/, 'footer link must be the link the macro made')

  const counter = textOf(byText(instances, 'counter(min)').html)
  assert.match(counter, /counter\(min, max, set\)/)
  assert.match(counter, /min \(query expression, default: 1 \)/)
  assert.match(counter, /set \(query expression, optional\)/)

  assert.match(textOf(byText(instances, '.uppercase()').html), /^uppercase\(\) Converts all letters in a string to uppercase/)
  // A method in several categories: the macro marks the name, and the link
  // carries the category's anchor.
  const contains = byText(instances, '.contains()')
  assert.match(textOf(contains.html), /contains\(value\) Tests if an array or object contains a value/)
  assert.match(contains.html, /#contains-2"/)
})

test('Connect: component name, type, status and summary; fields with path, type, default and first sentence', async () => {
  const body = [MARKUP.kafkaFranz, MARKUP.retry, MARKUP.consumerGroup, MARKUP.saslMechanism, MARKUP.tlsEnabled].map((m) => `<p>${m}</p>`).join('')
  const { page, instances } = await decorate({ body })
  await page.close()
  assert.equal(instances.length, 5)

  const franz = textOf(byText(instances, 'kafka_franz input').html)
  assert.equal(franz, 'kafka_franz input deprecated A Kafka input using the Franz Kafka client library. View full documentation ->')
  assert.match(textOf(byText(instances, 'retry processor').html), /^retry processor beta Attempts to execute a series of child processors until success\./)

  const group = textOf(byText(instances, 'consumer_group').html)
  assert.equal(group, 'consumer_group : string An optional consumer group. Field of the kafka_franz input View full documentation ->',
    'first sentence only, and no default line: the data has none')
  assert.match(textOf(byText(instances, 'sasl.mechanism').html), /^sasl\.mechanism : string The SASL mechanism to use for authentication\./)
  const tls = textOf(byText(instances, 'tls.enabled').html)
  assert.match(tls, /^tls\.enabled : bool Whether to enable TLS for secure connections\. Default: false/)
})

test('rpk: command usage and description; flag, shorthand, type, default and description', async () => {
  const { page, instances } = await decorate({ body: `<p>${MARKUP.topicCreate}</p><p>${MARKUP.partitions}</p><p>${MARKUP.profile}</p>` })
  await page.close()
  assert.equal(instances.length, 3)
  assert.equal(
    textOf(byText(instances, 'rpk topic create').html),
    'rpk topic create [TOPICS...] [flags] Create one or more Kafka topics with configurable partitions, replication factor, and topic-level settings. View full documentation ->'
  )
  const partitions = textOf(byText(instances, 'rpk topic create --partitions').html)
  assert.match(partitions, /^--partitions , -p : int32 Number of partitions for the topic\./)
  assert.match(partitions, /Default: -1 Flag of rpk topic create/)
  // A global flag, whose default is the empty string: no default line.
  const profile = textOf(byText(instances, 'rpk --profile').html)
  assert.equal(profile, '--profile : string rpk profile to use Flag of rpk View full documentation ->')
})

test('a marked entry the data does not have gets no tooltip', async () => {
  const body = [MARKUP.missingFunction, MARKUP.missingField, MARKUP.missingComponent, MARKUP.missingCommand, MARKUP.missingFlag].map((m) => `<p>${m}</p>`).join('')
  const { page, instances, underlined } = await decorate({ body })
  await page.close()
  assert.deepEqual(instances, [])
  assert.deepEqual(underlined, [])
})

test('no data means no tooltips, and the hand-written Bloblang fallback is never used inline', async () => {
  // Both data files 404. 16-bloblang-interactive.js falls back to
  // bloblang-docs.json for code blocks; that file is older than the data and
  // says different things, so inline tooltips must not use it.
  const fixtures = { '/_/bloblang-docs.json': read('src/static/bloblang-docs.json') }
  const { page, instances, fetches } = await decorate({ body: `<p>${MARKUP.now}</p><p>${MARKUP.kafkaFranz}</p><p>${MARKUP.topicCreate}</p>`, fixtures })
  await page.close()
  assert.deepEqual(instances, [])
  assert.ok(fetches.includes('/_/bloblang-docs.json'), `the fallback was not exercised; fetches: ${fetches}`)
  assert.ok(fetches.includes('/data/connect-4.115.1.json') && fetches.includes('/data/rpk-v26.2.2.json'), `fetches: ${fetches}`)
})

test('no meta tag means no fetch and no tooltip', async () => {
  const { page, instances, fetches } = await decorate({ metas: [], body: `<p>${MARKUP.topicCreate}</p>` })
  await page.close()
  assert.deepEqual(instances, [])
  assert.deepEqual(fetches, [])
})

test('a page with no marked element fetches nothing; plain backticks are never decorated', async () => {
  const body = '<p><code>now()</code> <code>.uppercase()</code> <code>kafka_franz</code> <code>inputs/kafka_franz</code> <code>rpk topic create</code> <code>--partitions</code></p>'
  const { page, instances, fetches } = await decorate({ body })
  await page.close()
  assert.deepEqual(instances, [])
  assert.deepEqual(fetches, [], 'the multi-megabyte Connect JSON must not load on a page that does not need it')
})

test('only the first mention in a paragraph gets a tooltip', async () => {
  const { page, instances, underlined } = await decorate({ body: `<p>${MARKUP.topicCreate} and ${MARKUP.topicCreate}</p><p>${MARKUP.topicCreate}</p>` })
  await page.close()
  assert.equal(instances.length, 2)
  assert.deepEqual(underlined, ['rpk topic create', 'rpk topic create'])
})

test('each off switch turns off its own family only', async () => {
  const body = `<p>${MARKUP.now}</p><p>${MARKUP.kafkaFranz}</p><p>${MARKUP.topicCreate}</p>`
  for (const [family, left] of [['bloblang', ['kafka_franz input', 'rpk topic create']], ['connect', ['now()', 'rpk topic create']], ['rpk', ['now()', 'kafka_franz input']]]) {
    const { page, instances } = await decorate({ metas: [...METAS, `<meta name="disable-${family}-tooltips" content="true">`], body })
    await page.close()
    assert.deepEqual(instances.map((i) => i.text).sort(), left.sort(), `disable-${family}-tooltips`)
  }
})

test('tippy settings match the other tooltips: hover and focus, touch, hideOnClick true, one open at a time', async () => {
  const { page, instances } = await decorate({ body: `<p>${MARKUP.now}</p><p>${MARKUP.kafkaFranz}</p><p>${MARKUP.partitions}</p>` })
  await page.close()
  assert.equal(instances.length, 3)
  for (const i of instances) {
    assert.equal(i.hideOnClick, true, 'tippy compares hideOnClick with === true; see 12-activate-tooltips.js')
    assert.equal(i.trigger, 'mouseenter focus')
    assert.equal(i.touch, true)
    assert.equal(i.interactive, true)
    assert.equal(i.hasOnShow, true)
  }
})

test('keyboard and touch: the link stays the one focusable reference, Escape closes, a touch tap opens instead of navigating', async () => {
  const { page } = await decorate({ body: `<p>${MARKUP.now}</p>` })
  const state = await page.evaluate(() => {
    const link = document.querySelector('a')
    const code = link.querySelector('code')
    let hidden = 0
    link._tippy.hide = () => { hidden++ }
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    const mouse = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(mouse)
    window.tippy.currentInput.isTouch = true
    const tap = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(tap)
    return {
      codeTabindex: code.getAttribute('tabindex'),
      codeRole: code.getAttribute('role'),
      hidden,
      mouseFollowsLink: !mouse.defaultPrevented,
      tapPrevented: tap.defaultPrevented,
    }
  })
  await page.close()
  assert.equal(state.codeTabindex, null, 'no second tab stop inside the link')
  assert.equal(state.codeRole, null, 'no button inside a link')
  assert.equal(state.hidden, 1, 'Escape hides the tooltip')
  assert.equal(state.mouseFollowsLink, true, 'a mouse click must follow the link')
  assert.equal(state.tapPrevented, true, 'a touch tap opens the tooltip instead of navigating')
})

test('pure lookups: types normalize, nested fields walk children, shorthands and global flags resolve', async () => {
  const page = await browser.newPage()
  await page.evaluate(() => { window.tippy = undefined })
  await page.addScriptTag({ content: MACRO_JS })
  const out = await page.evaluate((connectText, rpkText) => {
    const t = window.redpandaMacroTooltips
    const connect = JSON.parse(connectText)
    const rpk = JSON.parse(rpkText)
    const franz = t.findConnectComponent(connect, 'inputs/kafka_franz')
    const create = t.findRpkCommand(rpk.tree, 'rpk topic create')
    return {
      franz: franz && franz.name,
      singular: (t.findConnectComponent(connect, 'input/kafka_franz') || {}).name,
      wrongType: t.findConnectComponent(connect, 'outputs/kafka_franz'),
      nested: (t.findConnectField(franz, 'sasl[].mechanism') || {}).name,
      belowLeaf: t.findConnectField(franz, 'consumer_group.x'),
      root: t.findRpkCommand(rpk.tree, 'rpk') === rpk.tree,
      create: create && create.name,
      byShorthand: (t.findRpkFlag(rpk.tree, create, '-p') || {}).name,
      byDashes: (t.findRpkFlag(rpk.tree, create, '--partitions') || {}).name,
      global: (t.findRpkFlag(rpk.tree, create, 'verbose') || {}).name,
      unknown: t.findRpkFlag(rpk.tree, create, 'nope'),
      sentence: t.firstSentence('Uses `a.b` here. Then more.'),
      abbreviation: t.firstSentence('Pick one, e.g. this one. Next.'),
      paragraph: t.firstParagraph('\nOne\nline.\n\nTwo.'),
    }
  }, FIXTURES['/data/connect-4.115.1.json'], FIXTURES['/data/rpk-v26.2.2.json'])
  await page.close()
  assert.deepEqual(out, {
    franz: 'kafka_franz',
    singular: 'kafka_franz',
    wrongType: null,
    nested: 'mechanism',
    belowLeaf: null,
    root: true,
    create: 'create',
    byShorthand: 'partitions',
    byDashes: 'partitions',
    global: 'verbose',
    unknown: null,
    sentence: 'Uses `a.b` here.',
    abbreviation: 'Pick one, e.g. this one.',
    paragraph: 'One line.',
  })
})
