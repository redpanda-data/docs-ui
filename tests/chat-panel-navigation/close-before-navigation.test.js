/**
 * The Ask AI agent can navigate the reader in the same tab. 19-chat-panel.js
 * persists the drawer's open state in localStorage and restores it on load, so
 * without an explicit close the drawer reopens on top of the very page the
 * agent was asked to show.
 *
 * Two halves are covered here: agentTools.js asking for the close BEFORE it
 * navigates (ordering is the whole point — after location.assign is too late),
 * and 19-chat-panel.js clearing the persisted flag when asked.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const TOOLS = path.join(__dirname, '../../src/js/react/agentTools.js')
const PANEL = path.join(__dirname, '../../src/js/19-chat-panel.js')

// agentTools.js is an ES module, but this repo has no "type": "module" and CI
// runs Node 18, which will not reparse a .js file as ESM the way newer Node
// does — a dynamic import() here passes locally and throws
// "Unexpected token 'export'" in CI. Load it through vm instead, rewriting its
// single export into a global assignment (top-level const/let stay in the
// script's lexical scope and never reach the context object, so the rewrite has
// to be an assignment). Version independent, and it matches the vm approach the
// other suites in this repo use.
//
// agentTools.js touches the DOM only inside execute(), so stubbed globals are
// enough to drive the two navigation tools.
function loadTools () {
  const calls = []
  const source = fs.readFileSync(TOOLS, 'utf8')
  const rewritten = source.replace(/^export const agentTools =/m, 'globalThis.agentTools =')
  assert.notEqual(rewritten, source, 'the agentTools export shape changed; update this harness')

  const context = {
    console,
    URL,
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    window: {
      location: {
        origin: 'https://docs.redpanda.com',
        href: 'https://docs.redpanda.com/home/',
        assign: (url) => calls.push({ type: 'assign', url }),
      },
      CustomEvent: class { constructor (type) { this.type = type } },
      dispatchEvent: (e) => { calls.push({ type: 'dispatch', event: e.type }); return true },
      addEventListener: () => {},
      open: () => null,
    },
    document: {
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener: () => {},
    },
  }
  context.globalThis = context
  vm.runInNewContext(rewritten, context)
  return { calls, tools: context.agentTools, context }
}

test('navigate_to_page closes the drawer before it navigates', async () => {
  const { calls, tools } = loadTools()
  const navigate = tools.find((t) => t.name === 'navigate_to_page')
  assert.ok(navigate, 'navigate_to_page tool is registered')

  const result = await navigate.execute({ url: '/home/how-to-use-these-docs/' })

  assert.equal(result.navigated, true)
  const kinds = calls.map((c) => c.type)
  assert.deepEqual(kinds, ['dispatch', 'assign'], 'close is requested, then navigation happens')
  assert.equal(calls[0].event, 'docs-chat:close')
})

test('an invalid URL neither closes the drawer nor navigates', async () => {
  const { calls, tools } = loadTools()
  const navigate = tools.find((t) => t.name === 'navigate_to_page')

  const result = await navigate.execute({ url: 'https://evil.example.com/phish' })

  assert.equal(result.error, 'invalid_url')
  assert.deepEqual(calls, [], 'a rejected navigation must not close the reader\'s drawer')
})

test('switch_product closes the drawer before it navigates', async () => {
  const { calls, tools, context } = loadTools()
  context.document.querySelectorAll = (sel) => {
    if (!String(sel).includes('sb-product-opt')) return []
    return [{
      getAttribute: () => '/agentic-data-plane/',
      classList: { contains: () => false },
      querySelector: () => ({ textContent: 'Agentic Data Plane' }),
    }]
  }
  const sw = tools.find((t) => t.name === 'switch_product')

  const result = await sw.execute({ product: 'agentic-data-plane' })

  assert.equal(result.switched, true)
  assert.deepEqual(calls.map((c) => c.type), ['dispatch', 'assign'])
  assert.equal(calls[0].event, 'docs-chat:close')
})

// --- the panel side of the contract ---

// 19-chat-panel.js is an IIFE, so drive it through a stub DOM and read back
// what it does to storage.
function runPanel ({ storedOpen }) {
  const store = storedOpen ? { 'redpanda-chat-panel-open': 'true' } : {}
  const listeners = {}
  const panel = {
    classList: { add () {}, remove () {}, toggle: () => false, contains: () => false },
    setAttribute () {},
    querySelectorAll: () => [],
    querySelector: () => null,
    inert: false,
  }
  const context = {
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v) },
      removeItem: (k) => { delete store[k] },
    },
    document: {
      querySelector: (sel) => (String(sel).includes('data-chat-panel') ? panel : null),
      querySelectorAll: () => [],
      addEventListener () {},
    },
    window: {
      innerWidth: 1400,
      addEventListener: (t, fn) => { listeners[t] = fn },
      dispatchEvent: () => true,
      CustomEvent: class { constructor (type) { this.type = type } },
    },
  }
  vm.runInNewContext(fs.readFileSync(PANEL, 'utf8'), context)
  return { store, listeners }
}

test('docs-chat:close clears the persisted open flag so the next page does not reopen', () => {
  const { store, listeners } = runPanel({ storedOpen: true })
  assert.ok(listeners['docs-chat:close'], 'the panel listens for the close request')

  listeners['docs-chat:close']()

  assert.equal(store['redpanda-chat-panel-open'], undefined)
})

// Mobile skips the restore, so the panel is closed while the flag is still set.
// Clearing it regardless stops a stale flag reopening the drawer on the
// reader's next desktop visit.
test('docs-chat:close clears a stale flag even when the panel is not open', () => {
  const { store, listeners } = runPanel({ storedOpen: false })
  store['redpanda-chat-panel-open'] = 'true'

  listeners['docs-chat:close']()

  assert.equal(store['redpanda-chat-panel-open'], undefined)
})
