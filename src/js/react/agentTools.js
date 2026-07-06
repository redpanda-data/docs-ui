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
  needsApproval: true,
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
    'using the site product switcher. Call with the product name the user asked about. ' +
    'If the result lists available products, retry with one of those exact ids.',
  needsApproval: true,
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
    const options = Array.from(document.querySelectorAll('[data-product-menu] [data-product-id]')).map((btn) => ({
      id: btn.getAttribute('data-product-id'),
      label: btn.textContent.trim(),
      url: btn.getAttribute('data-product-url'),
      current: btn.classList.contains('is-current'),
    }))
    if (options.length === 0) {
      return { error: 'unavailable', message: 'No product switcher on this page.' }
    }
    const wanted = String(product || '').toLowerCase()
    const match = options.find(
      (o) => o.id.toLowerCase() === wanted ||
        o.id.toLowerCase().includes(wanted) ||
        o.label.toLowerCase().includes(wanted)
    )
    if (!match) {
      return { error: 'not_found', available: options.map((o) => ({ id: o.id, label: o.label })) }
    }
    if (match.current) {
      return { alreadyCurrent: true, product: match.id }
    }
    window.location.assign(match.url)
    return { switched: true, product: match.id, url: match.url }
  },
}

const openBloblangPlayground = {
  name: 'open_bloblang_playground',
  displayName: 'Open Bloblang playground',
  description:
    'Open the interactive Bloblang playground in a new tab, preloaded with a mapping (and optionally sample input JSON) ' +
    'so the user can run and edit it. Only open mappings you have already verified with the run_bloblang tool.',
  needsApproval: true,
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

const askCommunity = {
  name: 'ask_community',
  displayName: 'Ask the Redpanda community',
  description:
    'Open the Redpanda community Slack in a new tab so the user can ask other engineers. ' +
    'Use when a question needs human help, opinions, or is beyond the documentation. ' +
    'Pass a suggested message the user could post.',
  needsApproval: true,
  parameters: {
    type: 'object',
    properties: {
      suggested_message: {
        type: 'string',
        description: 'A short message the user could post in the community Slack.',
      },
    },
    required: [],
  },
  execute: async ({ suggested_message: suggestedMessage }) => {
    const url = 'https://redpanda.com/slack'
    const opened = openTab(url)
    return {
      opened,
      url,
      suggestedMessage: suggestedMessage || null,
      note: opened
        ? 'Slack invite opened in a new tab. Show the user the suggested message to post.'
        : 'Popup blocked — give the user the link and the suggested message.',
    }
  },
}

export const agentTools = [
  navigateToPage,
  switchProduct,
  runBloblang,
  openBloblangPlayground,
  submitDocsFeedback,
  askCommunity,
]
