/* globals window, document, fetch, WebAssembly */
/**
 * Client-side tools for the Kapa Agent SDK (registered on AgentProvider in
 * AskAI.jsx). The agent decides when to call these; `execute` runs in the
 * browser and its return value is streamed back into the conversation, so
 * always return a plain object the model can narrate (include `url` fields so
 * the agent can render a link when a popup is blocked).
 *
 * Tools that move the user (navigation, product switch) or contact the docs
 * team require explicit approval — the chat UI renders approve/reject buttons
 * via the SDK's ToolCallCard.
 */

const DOCS_ORIGIN = 'https://docs.redpanda.com'

// UTF-8-safe base64, matching the Bloblang playground's share-link encoding
function encodeBase64 (str) {
  const utf8Bytes = new TextEncoder().encode(str)
  let binaryStr = ''
  for (let i = 0; i < utf8Bytes.length; i++) {
    binaryStr += String.fromCharCode(utf8Bytes[i])
  }
  return window.btoa(binaryStr)
}

// Accept relative doc paths or absolute docs.redpanda.com URLs; reject the rest
function resolveDocsUrl (url) {
  try {
    const resolved = new URL(url, window.location.origin)
    if (resolved.origin === window.location.origin || resolved.origin === DOCS_ORIGIN) {
      return resolved.toString()
    }
  } catch (err) { /* fall through */ }
  return null
}

// Open in a new tab; a blocked popup returns null so callers can degrade to a link
function openTab (url) {
  const win = window.open(url, '_blank', 'noopener')
  return Boolean(win)
}

// ——— Bloblang WASM (lazy) ———————————————————————————————————————————————
// Same engine and load paths as the mini playground (16-bloblang-interactive.js):
// wasm_exec.js from the UI root, blobl.wasm from the site root (or UI root in
// the docs-ui preview). Exposes window.blobl(mapping, input[, metadata]).
let bloblWasmPromise = null

function loadScript (src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = resolve
    s.onerror = () => reject(new Error(`failed to load ${src}`))
    document.head.appendChild(s)
  })
}

function loadBloblWasm () {
  if (window.blobl) return Promise.resolve()
  if (bloblWasmPromise) return bloblWasmPromise

  const rootPath = typeof window.uiRootPath !== 'undefined' ? window.uiRootPath : '/_'
  const siteRoot = typeof window.siteRootPath !== 'undefined' ? window.siteRootPath : ''
  const isPreview = typeof window.isUiPreview !== 'undefined' ? window.isUiPreview : false
  const wasmPath = isPreview ? `${rootPath}/blobl.wasm` : `${siteRoot}/blobl.wasm`

  bloblWasmPromise = (typeof window.Go === 'undefined'
    ? loadScript(`${rootPath}/js/vendor/wasm_exec.js`)
    : Promise.resolve()
  )
    .then(() => {
      const go = new window.Go()
      return fetch(wasmPath)
        .then((response) => {
          if (!response.ok) throw new Error(`WASM not found at ${wasmPath}`)
          const clone = response.clone()
          return WebAssembly.instantiateStreaming(response, go.importObject).catch(async () => {
            const bytes = await clone.arrayBuffer()
            return WebAssembly.instantiate(bytes, go.importObject)
          })
        })
        .then((result) => {
          go.run(result.instance)
        })
    })
    .catch((err) => {
      bloblWasmPromise = null // allow a retry
      throw err
    })
  return bloblWasmPromise
}

const runBloblang = {
  name: 'run_bloblang',
  displayName: 'Run Bloblang mapping',
  description:
    'Execute a Bloblang mapping against sample input JSON using the real Redpanda Connect interpreter, ' +
    'and return the output or the exact parse/runtime error. ' +
    'ALWAYS run a mapping through this tool before presenting it to the user or opening the playground — ' +
    'if it errors, fix the mapping and run it again until it works, then show the user the verified mapping ' +
    'together with the sample input and output.',
  // Deliberately not approval-gated: pure sandboxed computation in page-local
  // WASM — no network, DOM, or navigation side effects — and the agent may
  // need several iterations to converge on a correct mapping.
  needsApproval: false,
  parameters: {
    type: 'object',
    properties: {
      mapping: {
        type: 'string',
        description: 'The Bloblang mapping to execute.',
      },
      input: {
        type: 'string',
        description: 'Sample input JSON to run the mapping against.',
      },
    },
    required: ['mapping', 'input'],
  },
  execute: async ({ mapping, input }) => {
    try {
      await loadBloblWasm()
    } catch (err) {
      return { error: 'wasm_unavailable', message: String(err?.message || err) }
    }
    let result
    try {
      result = window.blobl(String(mapping), String(input))
    } catch (err) {
      return { valid: false, error: String(err?.message || err) }
    }
    if (typeof result === 'string' && result.startsWith('Error:')) {
      return { valid: false, error: result }
    }
    return { valid: true, output: result }
  },
}

const navigateToPage = {
  name: 'navigate_to_page',
  displayName: 'Open documentation page',
  description:
    'Navigate the user to a Redpanda documentation page in the current tab, for example a page you just cited. ' +
    'Only use docs.redpanda.com URLs or absolute paths on the docs site. ' +
    'Use this when the user asks to go to, open, or be shown a page.',
  needsApproval: false, // same-tab, same-site navigation — reversible, no gate
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The documentation page URL or absolute path (for example /current/get-started/quick-start/).',
      },
    },
    required: ['url'],
  },
  execute: async ({ url }) => {
    const resolved = resolveDocsUrl(url)
    if (!resolved) {
      return { error: 'invalid_url', message: 'Only docs.redpanda.com pages can be opened.' }
    }
    window.location.assign(resolved)
    return { navigated: true, url: resolved }
  },
}

const switchProduct = {
  name: 'switch_product',
  displayName: 'Switch product',
  description:
    'Switch the docs site to a different Redpanda product (for example the Data Platform or Agentic Data Plane) ' +
    'using the sidebar product switcher. Call with the product name the user asked about. ' +
    'If the result lists available products, retry with one of those exact labels. If the switcher is ' +
    'unavailable on the current page (some landing pages omit it), fall back to navigate_to_page.',
  needsApproval: false, // same-tab, same-site navigation — reversible, no gate
  parameters: {
    type: 'object',
    properties: {
      product: {
        type: 'string',
        description: 'The product to switch to, by name or id (for example "agentic-data-plane").',
      },
    },
    required: ['product'],
  },
  execute: async ({ product }) => {
    // The sidebar switcher renders options as .sb-product-opt with a
    // data-product-url (see partials/product-switcher.hbs + 20-product-switcher.js).
    // It is NOT present on every page — product landing/home pages omit it.
    const els = Array.from(document.querySelectorAll('[data-product-switcher] .sb-product-opt'))
    if (els.length === 0) {
      return {
        error: 'unavailable',
        message: 'The product switcher is not on this page (some landing pages omit it). ' +
          'Use navigate_to_page to open the target product’s docs directly instead.',
      }
    }
    const options = els
      .map((el) => ({
        label: (el.querySelector('.sb-product-opt-name') || el).textContent.trim(),
        url: el.getAttribute('data-product-url'),
        current: el.classList.contains('is-current'),
      }))
      .filter((o) => o.url)
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    const wanted = norm(product)
    const match = options.find((o) => {
      const label = norm(o.label)
      return label === wanted || label.includes(wanted) || wanted.includes(label) || norm(o.url).includes(wanted)
    })
    if (!match) {
      return { error: 'not_found', available: options.map((o) => o.label) }
    }
    if (match.current) {
      return { alreadyCurrent: true, product: match.label }
    }
    window.location.assign(match.url)
    return { switched: true, product: match.label, url: match.url }
  },
}

const openBloblangPlayground = {
  name: 'open_bloblang_playground',
  displayName: 'Open Bloblang playground',
  description:
    'Open the interactive Bloblang playground in a new tab, preloaded with a mapping (and optionally sample input JSON) ' +
    'so the user can run and edit it. Only open mappings you have already verified with the run_bloblang tool.',
  needsApproval: false, // opens a new tab; degrades to a link if the popup is blocked
  parameters: {
    type: 'object',
    properties: {
      mapping: {
        type: 'string',
        description: 'The Bloblang mapping to preload.',
      },
      input: {
        type: 'string',
        description: 'Optional sample input JSON to preload.',
      },
    },
    required: ['mapping'],
  },
  execute: async ({ mapping, input }) => {
    const base = window.BLOBLANG_PLAYGROUND_URL || `${DOCS_ORIGIN}/connect/guides/bloblang/playground/`
    const url = new URL(base)
    url.searchParams.set('map', encodeBase64(mapping))
    if (input) url.searchParams.set('input', encodeBase64(input))
    const opened = openTab(url.toString())
    return {
      opened,
      url: url.toString(),
      note: opened ? 'Playground opened in a new tab.' : 'Popup blocked — give the user this link instead.',
    }
  },
}

const submitDocsFeedback = {
  name: 'submit_docs_feedback',
  displayName: 'Send feedback to the docs team',
  description:
    'Send user feedback (bug reports, documentation gaps, incorrect or missing information, feature requests) ' +
    'to the Redpanda docs team. Ask the user before calling this and summarize their feedback clearly — ' +
    'never include passwords, tokens, or other personal data in the summary. ' +
    'The submission includes the signed-in user\'s email and a reference to this conversation so the team can ' +
    'follow up; mention that to the user when asking for consent. Never submit without their consent.',
  needsApproval: true,
  parameters: {
    type: 'object',
    properties: {
      feedback: {
        type: 'string',
        description: 'The feedback to submit, in clear prose. Summarize the bug, gap, or request.',
      },
      category: {
        type: 'string',
        enum: ['bug', 'documentation_gap', 'feature_request', 'other'],
        description: 'The type of feedback.',
      },
      page_url: {
        type: 'string',
        description: 'The documentation page the feedback is about. Ask the user if it is not clear from context.',
      },
    },
    required: ['feedback', 'category', 'page_url'],
  },
  execute: async ({ feedback, category, page_url: pageUrl }) => {
    const text = String(feedback || '').trim().slice(0, 5000)
    if (!text) return { error: 'missing_feedback' }
    // Same Netlify form the docs MCP server uses (see docs-site mcp.mjs);
    // /home/ serves without redirecting, which Netlify forms require.
    // Same-origin so it also works on deploy previews and Bump.sh pages.
    // Referer and User-Agent are added by the browser automatically.
    // The signed-in user's email (from the session endpoint) and the thread ID
    // give the docs team a contact and conversation context without copying
    // the conversation text (which may contain pasted configs or PII) into
    // the form.
    const user = window.__KAPA_USER || {}
    // On a first-turn tool call the SDK may not have committed the thread ID
    // to state yet — wait briefly rather than submit without the reference
    let threadId = window.__KAPA_THREAD_ID
    for (let i = 0; !threadId && i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      threadId = window.__KAPA_THREAD_ID
    }
    const body = new URLSearchParams({
      'form-name': 'api-feedback',
      feedback: text,
      category: category || 'other',
      'page-path': pageUrl || window.location.href,
      'user-email': user.email || '',
      'user-domain': user.domain || '',
      source: 'ask-ai-widget',
      'thread-id': threadId || '',
      'bot-field': '',
    })
    const res = await fetch('/home/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      redirect: 'error',
    })
    if (!res.ok) {
      return { error: 'submission_failed', status: res.status }
    }
    return { submitted: true }
  },
}

// ——— Config property lookup (grounded in the shipped reference) ———————————
// redpanda-properties.json ships in the UI bundle (the same file the property
// tooltips read). Cache the fetch so repeated lookups in a session are free.
let propertiesPromise = null
function loadProperties () {
  if (propertiesPromise) return propertiesPromise
  // redpanda-properties.json is a UI static_file, so (like blobl.wasm) Antora
  // emits it to the SITE root in a normal build and to the UI root in the
  // docs-ui preview. Mirror the WASM loader's resolution.
  const rootPath = typeof window.uiRootPath !== 'undefined' ? window.uiRootPath : '/_'
  const siteRoot = typeof window.siteRootPath !== 'undefined' ? window.siteRootPath : ''
  const isPreview = typeof window.isUiPreview !== 'undefined' ? window.isUiPreview : false
  const url = isPreview ? `${rootPath}/redpanda-properties.json` : `${siteRoot}/redpanda-properties.json`
  propertiesPromise = fetch(url)
    .then((r) => { if (!r.ok) throw new Error(`properties reference not found (${r.status})`); return r.json() })
    .then((data) => data.properties || {})
    .catch((err) => { propertiesPromise = null; throw err }) // allow retry
  return propertiesPromise
}

const lookupConfigProperty = {
  name: 'lookup_config_property',
  displayName: 'Look up a config property',
  description:
    'Look up a Redpanda configuration property in the docs reference and return its type, ' +
    'default, scope (cluster/broker/topic), whether it needs a restart, whether it is ' +
    'supported on Redpanda Cloud, and its description. Use this to answer questions about a ' +
    'specific property with grounded values instead of guessing. If the property is not in ' +
    'the reference, say so and fall back to searching the docs.',
  needsApproval: false, // read-only, no navigation
  parameters: {
    type: 'object',
    properties: {
      property: { type: 'string', description: 'The exact property name, for example log_segment_size.' },
    },
    required: ['property'],
  },
  execute: async ({ property }) => {
    const name = String(property || '').trim()
    if (!name) return { found: false, error: 'No property name provided.' }
    let properties
    try {
      properties = await loadProperties()
    } catch (err) {
      return { found: false, property: name, error: `Could not load the property reference: ${err.message}` }
    }
    const rec = properties[name]
    if (!rec) {
      return { found: false, property: name, note: 'Not in the property reference — fall back to searching the docs.' }
    }
    return {
      found: true,
      name: rec.name,
      type: rec.type,
      default: rec.default,
      description: rec.description,
      scope: rec.config_scope,
      needsRestart: rec.needs_restart,
      cloudSupported: rec.cloud_supported,
      enterprise: rec.is_enterprise,
      deprecated: rec.is_deprecated,
      minimum: rec.minimum,
      maximum: rec.maximum,
    }
  },
}

// ——— Latest version (from the page meta + current doc context) ————————————
const getLatestVersion = {
  name: 'get_latest_version',
  displayName: 'Get the latest version',
  description:
    'Return the latest released Redpanda version (published on the docs site) and the ' +
    'product and version of the page the user is currently viewing. Use for "what is the ' +
    'latest version" and to pick the right version before giving version-specific steps.',
  needsApproval: false,
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async () => {
    const meta = document.querySelector('meta[name="latest-redpanda-version"]')
    const latest = meta && meta.content ? meta.content : null
    const component =
      document.body.getAttribute('data-component') ||
      document.querySelector('[data-component]')?.getAttribute('data-component') ||
      null
    const version = document.querySelector('[data-version]')?.getAttribute('data-version') || null
    return {
      latestRedpandaVersion: latest,
      currentPage: { product: component, version },
      note: latest ? undefined : 'Latest Redpanda version is not published on this page.',
    }
  },
}

// ——— Open Redpanda Cloud (curated, id-independent destinations) ———————————
// The docs agent has no access to the user's org/cluster IDs, so only general,
// id-independent pages belong here. Edit this single map to add/adjust routes;
// deep paths beyond the base should be verified against the Cloud app first.
const CLOUD_BASE = 'https://cloud.redpanda.com'
const CLOUD_ROUTES = {
  home: CLOUD_BASE,
  clusters: `${CLOUD_BASE}/clusters`,
  create_cluster: `${CLOUD_BASE}/clusters/create`,
  sign_up: `${CLOUD_BASE}/sign-up`,
}

const openConsole = {
  name: 'open_console',
  displayName: 'Open Redpanda Cloud',
  description:
    'Open a page in the Redpanda Cloud console in a new tab. Supported destinations: ' +
    Object.keys(CLOUD_ROUTES).join(', ') + '. Cannot open a specific cluster, topic, or ' +
    'other resource (no access to the user’s IDs) — open the general area and tell the ' +
    'user what to do next.',
  needsApproval: false, // opens a new tab; degrades to a link if the popup is blocked
  parameters: {
    type: 'object',
    properties: {
      destination: {
        type: 'string',
        enum: Object.keys(CLOUD_ROUTES),
        description: 'Which Cloud page to open.',
      },
    },
    required: ['destination'],
  },
  execute: async ({ destination }) => {
    const url = CLOUD_ROUTES[destination]
    if (!url) {
      return { opened: false, error: `Unknown destination "${destination}". Valid: ${Object.keys(CLOUD_ROUTES).join(', ')}.` }
    }
    const opened = openTab(url)
    return {
      opened,
      url,
      destination,
      note: opened ? 'Opened in a new tab.' : 'Popup blocked — give the user the link.',
    }
  },
}

// ——— Copy to clipboard (local; no navigation, no approval) ————————————————
const copyToClipboard = {
  name: 'copy_to_clipboard',
  displayName: 'Copy to clipboard',
  description:
    'Copy a command or code snippet to the user’s clipboard. Use right after presenting ' +
    'a command the user is expected to run. Pass the exact text to copy.',
  needsApproval: false,
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The exact text to copy.' },
      label: { type: 'string', description: 'Optional short label for what was copied, e.g. "rpk command".' },
    },
    required: ['text'],
  },
  execute: async ({ text, label }) => {
    const value = String(text || '')
    if (!value) return { copied: false, error: 'Nothing to copy.' }
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(value)
      return { copied: true, label: label || null }
    } catch (err) {
      // Degrade: hand the text back so the agent can show it for manual copy
      return { copied: false, text: value, error: err.message }
    }
  },
}

export const agentTools = [
  navigateToPage,
  switchProduct,
  runBloblang,
  openBloblangPlayground,
  submitDocsFeedback,
  lookupConfigProperty,
  getLatestVersion,
  openConsole,
  copyToClipboard,
]
