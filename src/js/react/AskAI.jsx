import React, { useEffect, useState } from 'react'
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
function announceSession (authenticated, user, loginUrl) {
  window.__KAPA_AUTHENTICATED = authenticated
  window.__KAPA_USER = user || null
  window.__KAPA_LOGIN_URL = loginUrl || null
  window.dispatchEvent(
    new CustomEvent('kapa-session', {
      detail: { authenticated, user: user || null, loginUrl: loginUrl || null },
    })
  )
  try {
    sessionStorage.setItem(
      'kapa-session-state',
      JSON.stringify({ authenticated, user: user || null, loginUrl: loginUrl || null })
    )
  } catch (err) { /* private browsing */ }
}

async function getSessionToken () {
  const endpoint = window.KAPA_SESSION_ENDPOINT || '/kapa/session'
  const res = await fetch(endpoint, { method: 'POST', credentials: 'include' })
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
  // Establish the tier. getSessionToken announces true (200) or false (clean
  // 401). Any other failure — missing backend, network error, 5xx — should
  // still land the user on the anonymous Chat SDK tier rather than hang the
  // drawer on the loading state.
  getSessionToken().catch(() => {
    if (window.__KAPA_AUTHENTICATED === undefined) announceSession(false, null, null)
  })
}

// Custom instructions are injected into the agent's system prompt server-side
// (never shown to users) and are, per Kapa's guidance, the single biggest
// quality lever. Structured into the three areas Kapa recommends: domain
// context, tool strategy, and preventing bad patterns. GROW THIS EMPIRICALLY —
// add a line each time the agent is observed doing the wrong thing.
const CUSTOM_INSTRUCTIONS = `## Domain context
- Answers often depend on which Redpanda deployment the user is on:
  - Self-Managed — docs live under "Streaming", versioned (e.g. 25.2, 24.3).
  - Redpanda Cloud — cluster types: BYOC, Dedicated, or Serverless.
  - Agentic Data Plane (ADP) — runs on a cloud platform (e.g. AWS).
- Bloblang is Redpanda Connect's mapping language. The run_bloblang tool runs a
  mapping against sample input using the real interpreter and returns the output
  or the exact error.

## Clarifying the user's context
- When a question is deployment-specific and the user hasn't said, first ask
  just one simple question: are they on Redpanda Cloud or Self-Managed?
- Then ask a follow-up ONLY when the answer actually depends on it; otherwise
  proceed with a sensible default:
  - Self-Managed → assume the latest Streaming version unless the answer
    differs by version, in which case ask which Streaming version (e.g. 25.2).
  - Cloud → assume the general case unless the answer differs by cluster type,
    in which case ask which: BYOC, Dedicated, or Serverless.
- Ask at most one follow-up. Skip all of this when they've already stated their
  deployment, or when the answer is the same across deployments.
- Agentic Data Plane (ADP) is a separate product; if the question is about ADP
  and the platform matters, ask which (e.g. AWS).

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
- Never include passwords, tokens, or other personal data in a feedback summary.
- Do not repeat sources or restate numbers you have already shown.`

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

function App () {
  const colorScheme = useSiteColorScheme()
  const { authenticated, user, loginUrl } = useSession()

  // Signed-in: full Agent SDK experience (tools, history, email attribution)
  if (authenticated === true) {
    return (
      <AgentProvider
        projectId={window.KAPA_PROJECT_ID}
        integrationId={window.UI_INTEGRATION_ID}
        model="kapa-agent-1.0"
        getSessionToken={getSessionToken}
        tools={agentTools}
        customInstructions={CUSTOM_INSTRUCTIONS}
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
    createRoot(mountEl).render(<App />)
  }
}

// Handle both normal page load and late loading (e.g., widgets loaded via fetch)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount)
} else {
  // DOM already loaded, mount immediately
  mount()
}
