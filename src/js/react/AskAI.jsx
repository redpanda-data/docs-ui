import React, { useEffect, useState, Component } from 'react'
import { createRoot } from 'react-dom/client'
import { AgentProvider } from '@kapaai/agent-react'
import { KapaProvider } from '@kapaai/react-sdk'
import ChatInterface from './components/ChatInterface.jsx'
import ChatSdkInterface from './components/ChatSdkInterface.jsx'
import { agentTools } from './agentTools.js'
import { safeHeap } from './heap.js'
import { saveConversation } from './chatPersistence.js'
import { createPersistentApiService } from './persistentApiService.js'
import { readScopeIds, dropScope, isScopeRejection, SCOPE_DROPPED_EVENT } from './kapaScope.js'
import { getSessionToken, installSessionProbe } from './kapaSession.js'

// Singleton Chat SDK api service for the anonymous tier: injects the saved
// threadId so a conversation survives page navigation. The signed-in tier gets
// this from the Agent SDK's server-side history instead, so the anonymous tier
// is the only consumer — but it is the DEFAULT tier, so it can't go without.
const persistentApiService = createPersistentApiService()


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
  - Self-Managed Streaming: when "Current page" below names a docs version, your
    search results are already restricted to it, so use it and do not ask. When
    it says searches are not restricted to a version, the results may mix
    versions: read each result's url, and ask which version only if the answer
    actually differs by version.
  - Redpanda Connect (including any Bloblang question): if you do not know
    where they run Connect, ask whether it is on Redpanda Cloud or
    Self-Managed BEFORE answering. This applies even when the mapping or
    answer would be identical either way, because your citations must come
    from the user's context. "The answer is generic" is not a reason to skip
    it.
  - A NAMED product is the context, so do not ask past it. When the question
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
    or pipelines follows the Connect rule above. Naming the source
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
  deployment is unknown. Ask the clarifying question first.
- Do not cite multiple product variants of the same page.
- Do not reason your way out of the clarifying question with "the answer is
  generic" or "the same across products". If retrieved sources span several
  products and the user's product is unknown, asking comes first, always.
- Never include passwords, tokens, or other personal data in a feedback summary.
- Do not repeat sources or restate numbers you have already shown.`

// The docs page the widget is open on, appended to the agent instructions so it
// can infer the user's product (Cloud / Self-Managed / ADP) from context before
// asking. Antora sets <body data-component> to the docs component.
// Kapa source group scoping retrieval to the docs version of THIS page
// (DOC-1807, DOC-2450). The array is emitted per page by chat-panel.hbs via the
// get-kapa-source-groups helper, so it varies by URL without rebuilding the bundle.
//
// The two SDKs spell the same option differently, and Kapa documents the
// inconsistency deliberately (dev/agent/migrating-from-chat-sdk):
//
//   Agent SDK (signed in)  sourceGroupIdsInclude   lowercase d
//   Chat SDK  (anonymous)  sourceGroupIDsInclude   capital ID
//
// A typo in either fails silently -- an unknown prop is ignored, no filter is
// sent, and answers quietly come from every docs version. So the name is derived
// from one place rather than written out at each call site.
//
// Spread rather than passed directly so that an empty array omits the prop
// entirely instead of sending []. Kapa treats an explicit empty list as "clear
// filtering", which is the same outcome, but omitting keeps the provider props
// identical to their pre-DOC-2450 shape when scoping cannot be resolved.
const SOURCE_GROUP_PROP = { agent: 'sourceGroupIdsInclude', chat: 'sourceGroupIDsInclude' }

//
// `ids` is the scope App holds in state (see useKapaScopeIds), so a scope that
// Kapa rejected mid-session can be dropped by re-rendering the provider without
// the prop. With no argument it reads the page globals directly.
function sourceGroupProps (tier, ids) {
  const fromPage = Array.isArray(window.KAPA_SOURCE_GROUP_IDS) ? window.KAPA_SOURCE_GROUP_IDS : []
  const list = Array.isArray(ids) ? ids : fromPage
  const clean = list.filter(Boolean)
  if (!clean.length) return {}
  return { [SOURCE_GROUP_PROP[tier]]: clean }
}

// The scope as React state, so the providers can be re-rendered without it.
// Starts from the page globals and empties when kapaScope.dropScope() fires
// SCOPE_DROPPED_EVENT: Kapa answers a stale group id with a 400 (measured live,
// not the silent global-only fallback the design first assumed), so a group the
// dashboard no longer knows would otherwise fail every question on the page
// until the regenerated mapping ships through three repos.
function useKapaScopeIds () {
  const [ids, setIds] = useState(readScopeIds)
  useEffect(() => {
    const onDropped = () => setIds([])
    window.addEventListener(SCOPE_DROPPED_EVENT, onDropped)
    return () => window.removeEventListener(SCOPE_DROPPED_EVENT, onDropped)
  }, [])
  return ids
}

function currentPageContext () {
  try {
    const path = window.location.pathname
    const component = (document.body && document.body.getAttribute('data-component')) || null
    // Taken from the SAME resolution that chose the source group, never
    // re-derived. A URL regex here reads "26.2" out of /streaming/26.2/... while
    // the group actually sent is `current`, because the latest release publishes
    // at /streaming/current/ and its own number is not a segment. The prompt
    // below asserts a restriction and forbids asking, so a disagreement makes
    // the agent attribute an answer to a version it never searched.
    //
    // Empty or absent means no group was sent, so nothing is restricted.
    const version = (typeof window.KAPA_SOURCE_GROUP_SEGMENT === 'string' && window.KAPA_SOURCE_GROUP_SEGMENT) || null
    // The version the page is published under, when it is NOT the one searched.
    // Set by chat-panel.hbs only for a published version with no Kapa group of
    // its own (beta, or a release newer than the mapping), which falls back to
    // the default group. Absent on the /api/ pages, where docs-site injects the
    // ids and segment and there is no fallback, so a missing value means the two
    // agree.
    const requested = (typeof window.KAPA_SOURCE_GROUP_REQUESTED === 'string' && window.KAPA_SOURCE_GROUP_REQUESTED) || null
    const fellBack = Boolean(version && requested && requested !== version)
    return '\n\n## Current page\n' +
      `- The user has the docs open at: ${path}` +
      (component ? ` (docs component: ${component})` : '') + '\n' +
      // Without this the agent asks which version while the reader is standing
      // on the answer, and retrieval is ALREADY pinned to that version, so a
      // guess of "latest" contradicts the sections it just received.
      (fellBack
        // Retrieval ran against the default because the reader's version has
        // no search index yet. Say so, or the agent asserts current-version
        // facts about the beta docs with no caveat and no way to know better.
        ? `- Docs version: the user is on the ${requested} docs, which have no dedicated search index yet, ` +
          `so your search results are restricted to ${version}${version === 'current' ? ' (the latest release)' : ''} instead. ` +
          `Point out where ${requested} may differ from ${version}, and do not ask which version they are on.\n`
        : version
          ? `- Docs version: ${version}${version === 'current' ? ' (the latest release)' : ''}. ` +
            'Your search results are restricted to this version, so do not ask which version they are on.\n'
          // No group was sent, so retrieval spans every indexed version. Saying
          // so is what stops the model asserting a version it cannot support.
          : '- Searches are NOT restricted to a version, so results may mix versions. ' +
            'Check each result url before stating that something applies to a particular version.\n') +
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
      // The Agent SDK puts Kapa's response body in the message, so a rejected
      // source group is named outright. Drop the scope so the reader's next
      // question (and the retry the SDK offers) goes out unscoped.
      if (isScopeRejection(event.data.error)) dropScope(event.data.error)
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
  const scopeIds = useKapaScopeIds()
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
        {...sourceGroupProps('agent', scopeIds)}
        enableHistory
        onEvent={handleAgentEvent}
        theme={{ accentColor: '#444ce7', colorScheme }}
      >
        <ChatInterface />
      </AgentProvider>
    )
  }

  // Anonymous: same drawer, Chat SDK (no session backend, no agent quota).
  // This is the tier every visitor gets until the auth backend is live, so it
  // keeps the full pre-agent feature set: cross-page conversation persistence
  // (apiService + saveConversation) and the three Heap events. The agent tier
  // reports its own equivalents from handleAgentEvent; these callbacks are the
  // Chat SDK's only hook for threadId/answer/feedback, so tracking lives here
  // rather than in ChatSdkInterface (which would double-count submissions and
  // has no access to the thread id).
  if (authenticated === false) {
    return (
      <KapaProvider
        integrationId={window.KAPA_CHAT_INTEGRATION_ID}
        apiService={persistentApiService}
        {...sourceGroupProps('chat', scopeIds)}
        callbacks={{
          askAI: {
            onQuerySubmit: (data) => {
              safeHeap('ask_question_docs_home', {
                question: data.question,
                thread_id: data.threadId,
                tier: 'anonymous',
              })
            },
            onAnswerGenerationCompleted: (data) => {
              // Save after the answer completes so the stored exchange is whole
              if (data.threadId && data.conversation) {
                saveConversation(data.threadId, data.conversation)
              }
              safeHeap('answer_generated_docs_home', {
                question_id: data.questionAnswerId,
                answer_length: data.answer.length,
                tier: 'anonymous',
              })
            },
            onFeedbackSubmit: (data) => {
              safeHeap('feedback_submitted_docs_home', {
                question_id: data.questionAnswerId,
                reaction: data.reaction,
                tier: 'anonymous',
              })
            },
          },
        }}
      >
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
    // No-op when kapaSession.bundle.js already ran the probe for this page.
    installSessionProbe()
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
