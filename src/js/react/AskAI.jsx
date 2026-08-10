import React, { useEffect, useState, Component } from 'react'
import { createRoot } from 'react-dom/client'
import { AgentProvider } from '@kapaai/agent-react'
import { KapaProvider } from '@kapaai/react-sdk'
import ChatInterface from './components/ChatInterface.jsx'
import ChatSdkInterface from './components/ChatSdkInterface.jsx'
import { agentTools } from './agentTools.js'
import { safeHeap } from './heap.js'

/**
 * Fetches a Kapa Agent SDK session token from the docs backend
 * (netlify/functions/kapa-session.mjs in docs-site). The agent tier is
 * signed-in only: anonymous visitors get 401 auth_required, ChatInterface
 * shows a sign-in prompt, and the Ask AI experience falls back to the stock
 * Kapa widget. Session state is broadcast via the `kapa-session` window event
 * and mirrored on window.__KAPA_AUTHENTICATED / window.__KAPA_USER so
 * components mounting after the broadcast (and the feedback tool) can read it.
 */
// authoritative: true when the session state comes from a definitive backend
// answer (a 200, or a clean 401 that carries — or deliberately omits — a
// login_url). false when we're ASSUMING signed-out after a transient/opaque
// probe failure. Consumers that take destructive action on "signed out" (e.g.
// the header clearing a stale auth hint) must act only on authoritative signals,
// so a network blip can't flip a genuinely-signed-in user to signed-out.
function announceSession (authenticated, user, loginUrl, authoritative = true) {
  window.__KAPA_AUTHENTICATED = authenticated
  window.__KAPA_USER = user || null
  window.__KAPA_LOGIN_URL = loginUrl || null
  window.dispatchEvent(
    new CustomEvent('kapa-session', {
      detail: { authenticated, user: user || null, loginUrl: loginUrl || null, authoritative },
    })
  )
  try {
    // Persist only authoritative states. A cached transient-assumption must not
    // replay as if it were a definitive answer on the next pageview.
    if (authoritative) {
      sessionStorage.setItem(
        'kapa-session-state',
        JSON.stringify({ authenticated, user: user || null, loginUrl: loginUrl || null })
      )
    }
  } catch (err) { /* private browsing */ }
}

async function getSessionToken () {
  const endpoint = window.KAPA_SESSION_ENDPOINT || '/kapa/session'
  // Client-side timeout: a hung connection (LB/proxy accepts TCP but never
  // responds) would otherwise neither resolve nor reject, leaving the drawer
  // stuck on the loading spinner forever. On abort we throw, so probeSession's
  // .catch degrades to the anonymous tier — matching the network-error fallback.
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), Number(window.KAPA_SESSION_TIMEOUT_MS || 8000))
  let res
  try {
    res = await fetch(endpoint, { method: 'POST', credentials: 'include', signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
  if (res.status === 401) {
    const data = await res.json().catch(() => ({}))
    announceSession(false, null, data.login_url)
    throw new Error('Sign in to use the Redpanda AI agent')
  }
  if (!res.ok) {
    throw new Error(`Chat session request failed (${res.status})`)
  }
  const data = await res.json()
  announceSession(Boolean(data.authenticated), data.user, null)
  return { token: data.session_token, expiresAt: Date.parse(data.expires_at) }
}

// The SDK only fetches a session token on the first message, so ChatInterface
// wouldn't know whether to show the agent UI or the sign-in prompt until the
// user typed something. Probe once per browser session (cached) to learn the
// session state early. The cache is revalidated whenever the JS-readable
// rp_docs_auth hint cookie (set/cleared by the docs login flow alongside the
// HttpOnly session cookie) disagrees with it — i.e. right after login/logout.
function probeSession () {
  const hasAuthHint = /(?:^|;\s*)rp_docs_auth=1(?:;|$)/.test(document.cookie)
  let cached = null
  try {
    cached = sessionStorage.getItem('kapa-session-state')
  } catch (err) { /* private browsing */ }
  if (cached !== null) {
    try {
      const { authenticated, user, loginUrl } = JSON.parse(cached)
      if (Boolean(authenticated) === hasAuthHint) {
        announceSession(Boolean(authenticated), user, loginUrl)
        return
      }
      // Login state changed since the cache was written — fall through
    } catch (err) { /* fall through to a fresh probe */ }
  }
  // Establish the tier. getSessionToken announces on a 200 (authenticated) or a
  // clean 401 (signed-out; carries the real login_url, or null when auth is
  // deliberately turned off / "coming soon"). Any OTHER failure — network error,
  // 5xx, abort — lands here having announced nothing (__KAPA_AUTHENTICATED still
  // undefined). That is a transient blip, NOT the coming-soon signal: the auth
  // backend ships in the same deploy as this bundle, so a truly "absent" backend
  // isn't a real production state. Degrade to the anonymous Chat SDK tier, but
  // keep the sign-in affordance visible pointing at the default /login rather
  // than hiding it as if auth were off — only an authoritative 401 with
  // login_url===null should hide sign-in. Self-heals on the next probe.
  getSessionToken().catch(() => {
    if (window.__KAPA_AUTHENTICATED === undefined) {
      announceSession(false, null, window.__KAPA_LOGIN_URL || '/login', false)
    }
  })
}

// Custom instructions are injected into the agent's system prompt server-side
// (never shown to users) and are, per Kapa's guidance, the single biggest
// quality lever. Structured into the three areas Kapa recommends: domain
// context, tool strategy, and preventing bad patterns. GROW THIS EMPIRICALLY —
// add a line each time the agent is observed doing the wrong thing.
const CUSTOM_INSTRUCTIONS = `## Domain context
- Answers often depend on which Redpanda product the user is on:
  - Redpanda Cloud: managed. Cluster types BYOC, Dedicated, or Serverless.
  - Self-Managed: the user runs it. Streaming is core Redpanda, versioned
    (e.g. 25.2 or 24.3).
  - Redpanda Connect (data pipelines, Bloblang mappings) runs BOTH ways: managed
    on Redpanda Cloud and self-hosted on Self-Managed. The setup and available
    features differ between the two, so treat "where they run Connect" as its own
    dimension, not a sub-area of Self-Managed.
  - Agentic Data Plane (ADP): a separate product that runs on a cloud platform
    (e.g. AWS).
  - "Streaming" or "Redpanda" alone is NOT a deployment: both Redpanda Cloud
    and Self-Managed run Redpanda streaming. A user who says "Redpanda
    Streaming" has NOT told you whether they are on Cloud or Self-Managed.
- Bloblang is Redpanda Connect's mapping language. The run_bloblang tool runs a
  mapping against sample input using the real interpreter and returns the output
  or the exact error.

## Clarifying the user's context
- FIRST infer the product from context yourself before asking: the page the user
  is currently viewing (see "Current page" below) and the conversation so far.
  Only ask when context does not make it clear.
- If you cannot tell from context, ask ONE simple question: which product,
  Redpanda Cloud, Self-Managed, or Agentic Data Plane (ADP)?
- Ask a follow-up ONLY when the answer actually depends on it:
  - Cloud: assume the general case unless it differs by cluster type, then ask
    which (BYOC, Dedicated, or Serverless).
  - Self-Managed Streaming: assume the latest version unless it differs by
    version, then ask which (e.g. 25.2).
  - Redpanda Connect (including any Bloblang question): if you do not know
    where they run Connect, ask whether it is on Redpanda Cloud or
    Self-Managed BEFORE answering. This applies even when the mapping or
    answer would be identical either way, because your citations must come
    from the user's context. "The answer is generic" is not a reason to skip
    it.
  - A NAMED product is the context — do not ask past it. When the question
    names Redpanda Cloud, Serverless, BYOC, Dedicated, or Self-Managed
    (e.g. "CDC pipeline from Postgres to Redpanda Cloud"), assume Connect
    runs there, answer for that product, and note the assumption in one short
    line (e.g. "This assumes a managed Connect pipeline on Redpanda Cloud;
    if you self-host Connect, tell me."). Ask only when there is no product
    signal anywhere in the conversation. "Streaming" alone is not a product
    signal (see above); "Cloud" is.
  - Data-integration questions are Connect questions even when the user only
    mentions Streaming or Redpanda: anything about writing to / reading from
    another system (Snowflake, S3, Postgres, …), sinks, sources, connectors,
    or pipelines follows the Connect rule above — naming the source
    ("Redpanda Streaming") does not answer where Connect runs.
  - ADP: ask the platform (e.g. AWS) only when it matters.
- Ask at most one clarifying question. Skip it when context or the user already
  makes the product clear. Do NOT skip just because the technical answer is the
  same across products: when your retrieved sources span several products and
  you do not know the user's, ask, so your answer and its citations come from
  the user's context.

## Offering choices
- When you ask the user to choose among a small set of known options (product,
  cluster type, where they run Connect, version), end the message with ONE
  final line in exactly this form, nothing else on the line:
  OPTIONS: First choice | Second choice | Third choice
- 2 to 5 options, each under 40 characters, no markdown inside the line. The
  UI renders them as buttons the user can click, and the click sends the
  option text back as their reply.
- Only use it for closed choices you can enumerate. Never use it for open
  questions, and never put the OPTIONS line anywhere but the very end.

## Citing sources
- Most docs pages exist in several product contexts (Cloud, Self-Managed /
  Streaming, Connect) with near-identical content. Cite ONLY the variant that
  matches the user's product context.
- When search returns the same or equivalent page from several products and the
  user's product is unknown, ask the clarifying question before answering.
- Never cite more than one product variant of the same page, and never cite the
  same page twice (different sections of one page are one source).

## Writing style
- Follow Redpanda docs style. No em dashes. Avoid "please" and "once" (use
  "after" or "when"). Keep confirmations neutral and concise rather than
  first-person (e.g. "Sent your feedback to the docs team." not "I'll pass that
  along for you."). This applies to every response, including feedback
  confirmations.

## Tool strategy
- Bloblang: only use functions and methods that appear in the docs you
  retrieved. ALWAYS verify a mapping with run_bloblang against sample input
  before presenting it or opening the playground; if it errors, fix it and
  verify again. Show the verified mapping with its sample input and output.
- Navigation / product switch: use when the user asks to go to, open, or be
  shown a page or product.
- Feedback: call submit_docs_feedback only with the user's explicit consent;
  summarize their feedback clearly first.

## Do not
- Do not present a Bloblang mapping you have not verified with run_bloblang.
- Do not invent Bloblang functions or methods that are not in the docs.
- Do not answer a deployment-specific question with a generic guess when the
  deployment is unknown — ask the clarifying question first.
- Do not cite multiple product variants of the same page.
- Do not reason your way out of the clarifying question with "the answer is
  generic" or "the same across products". If retrieved sources span several
  products and the user's product is unknown, asking comes first, always.
- Never include passwords, tokens, or other personal data in a feedback summary.
- Do not repeat sources or restate numbers you have already shown.`

// The docs page the widget is open on, appended to the agent instructions so it
// can infer the user's product (Cloud / Self-Managed / ADP) from context before
// asking. Antora sets <body data-component> to the docs component.
function currentPageContext () {
  try {
    const path = window.location.pathname
    const component = (document.body && document.body.getAttribute('data-component')) || null
    return '\n\n## Current page\n' +
      `- The user has the docs open at: ${path}` +
      (component ? ` (docs component: ${component})` : '') + '\n' +
      '- Use this together with the conversation so far to infer their product before asking.'
  } catch (e) {
    return ''
  }
}

function handleAgentEvent (event) {
  switch (event.type) {
    case 'response_completed':
      safeHeap('answer_generated_docs_home', {
        thread_id: event.data.threadId,
        tool_call_count: event.data.toolCallCount,
      })
      break
    case 'response_error':
      safeHeap('chat_error_docs_home', {
        thread_id: event.data.threadId,
        error: event.data.error,
      })
      break
    case 'thread_resumed':
      safeHeap('thread_resumed_docs_home', { thread_id: event.data.threadId })
      break
    case 'thread_deleted':
      safeHeap('thread_deleted_docs_home', { thread_id: event.data.threadId })
      break
    case 'tool_executed':
      safeHeap('agent_tool_executed_docs_home', {
        tool_name: event.data.toolName,
        status: event.data.status,
        duration_ms: event.data.durationMs,
      })
      break
    case 'tool_denied':
      safeHeap('agent_tool_denied_docs_home', { tool_name: event.data.toolName })
      break
    default:
      break
  }
}

// Follow the site's theme toggle (html[data-theme]) rather than the OS
// preference, so the SDK-rendered history view matches the rest of the page.
function useSiteColorScheme () {
  const read = () =>
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
  const [scheme, setScheme] = useState(read)

  useEffect(() => {
    const observer = new MutationObserver(() => setScheme(read()))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [])

  return scheme
}

// Session state drives which SDK/drawer we mount:
//   authenticated === null  → still probing (brief loading state)
//   authenticated === false → anonymous: Chat SDK drawer (no agent quota)
//   authenticated === true  → Agent SDK drawer (tools, history, email)
// The kapa-session event (from getSessionToken/probeSession) carries the flag,
// the user, and the login URL. window.__KAPA_* mirror it for late mounts.
function useSession () {
  const [session, setSession] = useState(() => ({
    authenticated: window.__KAPA_AUTHENTICATED === undefined ? null : Boolean(window.__KAPA_AUTHENTICATED),
    user: window.__KAPA_USER || null,
    loginUrl: window.__KAPA_LOGIN_URL || null,
  }))
  useEffect(() => {
    const handle = (e) => setSession({
      authenticated: Boolean(e.detail?.authenticated),
      user: e.detail?.user || null,
      loginUrl: e.detail?.loginUrl || null,
    })
    window.addEventListener('kapa-session', handle)
    return () => window.removeEventListener('kapa-session', handle)
  }, [])
  return session
}

// Top-level boundary ABOVE the Kapa SDK providers: the per-interface boundaries
// live inside ChatInterface/ChatSdkInterface and can't catch a render-phase throw
// from AgentProvider/KapaProvider or the useAgentChat/useChat hooks. Without this,
// such a throw unmounts the whole drawer root. Contained to the drawer either way
// (separate React root), but this degrades to a message instead of a blank panel.
class ErrorBoundary extends Component {
  constructor (props) { super(props); this.state = { hasError: false } }
  static getDerivedStateFromError () { return { hasError: true } }
  componentDidCatch (err, info) { console.error('AskAI render error:', err, info) }
  render () {
    if (this.state.hasError) {
      return (
        <div className="chat-container">
          <div className="error-boundary">Ask AI is temporarily unavailable. Please refresh the page.</div>
        </div>
      )
    }
    return this.props.children
  }
}

function App () {
  const colorScheme = useSiteColorScheme()
  const { authenticated, user, loginUrl } = useSession()

  // Signed-in: full Agent SDK experience (tools, history, email attribution).
  // NOTE on identity: the `user={{ email }}` prop below is EMAIL ATTRIBUTION — it's
  // what appears in the Kapa dashboard and what sales searches by. It's separate
  // from the conversation-history key, which the server mints as an opaque hashed
  // external_owner_id (docs-site lib/kapa-owner.mjs) and never carries the email.
  // So the email is searchable while the history key stays opaque.
  if (authenticated === true) {
    return (
      <AgentProvider
        projectId={window.KAPA_PROJECT_ID}
        integrationId={window.UI_INTEGRATION_ID}
        model="kapa-agent-1.0"
        getSessionToken={getSessionToken}
        tools={agentTools}
        customInstructions={CUSTOM_INSTRUCTIONS + currentPageContext()}
        user={user?.email ? { email: user.email } : undefined}
        enableHistory
        onEvent={handleAgentEvent}
        theme={{ accentColor: '#444ce7', colorScheme }}
      >
        <ChatInterface />
      </AgentProvider>
    )
  }

  // Anonymous: same drawer, Chat SDK (no session backend, no agent quota)
  if (authenticated === false) {
    return (
      <KapaProvider integrationId={window.KAPA_CHAT_INTEGRATION_ID}>
        <ChatSdkInterface loginUrl={loginUrl} />
      </KapaProvider>
    )
  }

  // Probing — brief; avoids flashing the wrong tier
  return (
    <div className="chat-container">
      <div className="welcome-screen"><div className="chat-tier-loading" aria-hidden="true" /></div>
    </div>
  )
}

function mount () {
  // Mount to exactly one root to prevent duplicate App instances
  const homeEl = document.getElementById('kapa-chat-root')
  const panelEl = document.getElementById('chat-panel-kapa-root')
  const mountEl = homeEl || panelEl
  if (mountEl && !mountEl.dataset.mounted) {
    mountEl.dataset.mounted = 'true'
    probeSession()
    createRoot(mountEl).render(<ErrorBoundary><App /></ErrorBoundary>)
  }
}

// Handle both normal page load and late loading (e.g., widgets loaded via fetch)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount)
} else {
  // DOM already loaded, mount immediately
  mount()
}
