import React, { useState, useEffect, useRef, Component } from 'react'
import { useChat } from '@kapaai/react-sdk'
import { ArrowRight, CircleStop, RefreshCcw, ClipboardCopy, Sparkles, ThumbsUp, ThumbsDown, TriangleAlert } from 'lucide-react'
import { loadConversation, clearConversation } from '../chatPersistence.js'
import { safeHeap } from '../heap.js'
import { schedulePeek, forgetQuota, getQuota, quotaExhausted, QUOTA_EVENT } from '../anonQuota.js'
import { SCOPE_DROPPED_MESSAGE } from '../kapaScope.js'
import { Answer, Toast } from './chatShared.jsx'

// Anonymous drawer, powered by the Chat SDK (not the Agent SDK). Renders into
// the same #chat-panel-kapa-root chrome with the same CSS classes as the
// signed-in Agent interface, so the two tiers look identical — the agent tier
// just adds tools, history, and account-scoped features on top. Needs no
// session backend (the Chat SDK uses its own bot protection).
//
// This tier is metered: a visitor gets DOCS_ANON_ASK_LIMIT questions per window
// (default 3/24h) and then sees the sign-in wall below. The count is decided
// server-side and spent by the api service, not here, this component only
// renders what's left and stays out of the way once it's gone. See
// ../anonQuota.js and docs-site netlify/functions/kapa-quota.mjs.

// "in 20 minutes" / "in 3 hours" / "tomorrow" for the wall's reset line. An
// absolute timestamp would force the reader to do timezone arithmetic to learn
// the one thing they want to know: whether waiting is an option at all. Falls
// back to a vague phrase rather than a wrong one when we have no reset time.
function resetLabel (resetAt) {
  const at = resetAt ? Date.parse(resetAt) : NaN
  if (!Number.isFinite(at)) return 'later'
  const mins = Math.max(1, Math.round((at - Date.now()) / 60000))
  if (mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`
  return 'tomorrow'
}

// Out of free questions. Two shapes of the same message:
//   hero:   no conversation yet. Fills the drawer body where the welcome screen
//           would be, at the agent tier's signin-screen sizing.
//   footer: answers on screen. Replaces only the composer, so every answer
//           already given stays visible and scrollable. Taking those away would
//           punish the reader for reaching the limit instead of giving them a
//           reason to sign in.
// Both reuse .signin-badge / .signin-button / .signin-privacy-note so this and
// the agent tier's wall (ChatInterface.jsx) read as one feature.
function QuotaWall ({ quota, loginUrl, signingIn, setSigningIn, hero = false }) {
  // Refused by the shared per-network ceiling rather than by this reader's own
  // budget. The counts in the verdict are always the visitor's (kapa-quota.mjs
  // does not publish the ceiling's size), so without this branch someone who
  // has asked one question, or none, is told they have used all three. The
  // sign-in pitch below still applies unchanged: signing in lifts both limits.
  const byNetwork = quota?.blockedBy === 'ip'

  const title = byNetwork
    ? 'Too many questions from this network today'
    : quota?.limit === 1
      ? 'That was your free question'
      : quota?.limit
        ? `You've used your ${quota.limit} free questions`
        : "You've used your free questions"

  // disclosed=1: the privacy note below carries the disclosure the server
  // interstitial exists for, so /login goes straight to Auth0 (docs-site
  // docs-login.mjs). Same construction as the agent tier's wall.
  const href = loginUrl
    ? `${loginUrl}${loginUrl.includes('?') ? '&' : '?'}disclosed=1&return_to=${encodeURIComponent(window.location.pathname + window.location.search)}`
    : null

  const onSignIn = (e) => {
    // Prefer the header's sign-in modal when the page has one (same behaviour
    // as the upsell bar); otherwise let the link navigate to /login.
    // Anything we remember about their allowance is about to be wrong.
    forgetQuota()
    if (document.querySelector('[data-signin-modal]')) {
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('docs-account:open-signin'))
      return
    }
    setSigningIn(true)
  }

  return (
    <div className={hero ? 'signin-screen quota-wall-hero' : 'quota-wall'} role="region" aria-label="Question limit reached">
      <span className="signin-badge">
        <Sparkles size={14} />
        Free with Redpanda Cloud
      </span>
      <h2 className={hero ? 'welcome-title' : 'quota-wall-title'}>{title}</h2>
      <p className={hero ? 'welcome-description' : 'quota-wall-text'}>
        {byNetwork && 'Anonymous questions are limited per network, and this one has reached today\'s. '}
        Sign in with a free Redpanda Cloud account to keep asking, and get the docs AI agent:
        saved conversations, Bloblang it can verify for you, and answers that open the exact page you need.
      </p>
      {href ? (
        <>
          <a
            className={`signin-button${signingIn ? ' is-signing-in' : ''}`}
            aria-disabled={signingIn}
            href={href}
            onClick={onSignIn}
          >
            {signingIn ? 'Signing in…' : 'Sign in to keep asking'}
          </a>
          {/* Say the wall lifts on its own, so it reads as a limit rather than a
              permanent lockout. */}
          {quota?.resetAt && <p className="quota-wall-reset">Or come back {resetLabel(quota.resetAt)}.</p>}
          {/* Keep in sync with the header modal note, ChatInterface's wall, and
              docs-site loginInterstitialHtml (lib/oauth/pages.mjs). */}
          <p className="signin-privacy-note">
            When you sign in, we collect your verified work email to track documentation usage and attribute it to
            your organization, and we share it with service providers that help us run and analyze the service.
            See our <a href="https://www.redpanda.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy Policy</a> for details.
          </p>
        </>
      ) : (
        // Sign-in is switched off site-wide (no login_url: the same kill switch
        // kapa-session honours). No dead button; say when they can ask again.
        <p className="signin-coming-soon">You can ask again {resetLabel(quota?.resetAt)}.</p>
      )}
    </div>
  )
}

// Thumbs up/down on the latest answer. The Chat SDK's addFeedback posts the
// reaction to Kapa, which is where the docs team's answer-quality signal comes
// from — the Agent SDK has no equivalent, so this tier is the only source.
// Reported to Heap by the provider's onFeedbackSubmit callback (AskAI.jsx).
function FeedbackButtons ({ questionAnswerId, showToast }) {
  const { addFeedback } = useChat()

  const handleFeedback = async (reaction) => {
    try {
      await addFeedback(questionAnswerId, reaction)
      showToast(reaction === 'upvote' ? 'Thanks for the feedback!' : 'Feedback received', 'success')
    } catch (err) {
      console.error('Feedback error', err)
      showToast('Could not send feedback', 'error')
    }
  }

  return (
    <div className="feedback-container">
      <div className="feedback-group">
        <button className="feedback-button" type="button" onClick={() => handleFeedback('upvote')} title="This was helpful">
          <ThumbsUp className="feedback-icon" />
        </button>
        <button className="feedback-button" type="button" onClick={() => handleFeedback('downvote')} title="This wasn't helpful">
          <ThumbsDown className="feedback-icon" />
        </button>
      </div>
    </div>
  )
}

class ErrorBoundary extends Component {
  constructor (props) { super(props); this.state = { hasError: false } }
  static getDerivedStateFromError () { return { hasError: true } }
  componentDidCatch (err, info) { console.error('Render error in ChatSdkInterface:', err, info) }
  render () {
    if (this.state.hasError) {
      return <div className="error-boundary">Something went wrong. Try refreshing the page.</div>
    }
    return this.props.children
  }
}

export default function ChatSdkInterface ({ loginUrl }) {
  const [message, setMessage] = useState('')
  const [dots, setDots] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [hasInteracted, setHasInteracted] = useState(false)
  const [toast, setToast] = useState(null)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1150)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [restoredConversation, setRestoredConversation] = useState(null)
  // Anonymous question budget. Seeded from the module snapshot so a remount
  // (drawer reopened) doesn't flash the composer before re-learning the state.
  const [quota, setQuota] = useState(() => getQuota())
  const inputRef = useRef(null)

  const showToast = (msg, type = 'success') => setToast({ message: msg, type })

  const {
    conversation,
    submitQuery,
    isPreparingAnswer,
    isGeneratingAnswer,
    stopGeneration,
    resetConversation,
    error,
  } = useChat()

  const isBusy = isPreparingAnswer || isGeneratingAnswer

  // Learn the budget before the user types, so the wall is already in place if
  // they're out (rather than appearing after a question is swallowed), and
  // follow every later verdict the api service publishes. The peek also resumes
  // the backend's scale-to-zero database while the user is still typing, so the
  // consume that runs in front of their first question doesn't pay the
  // multi-second cold start (the same trick /auth/warm plays for sign-in).
  //
  // schedulePeek decides WHEN, and it is not on mount: this component mounts on
  // every pageview whether or not the drawer is ever opened, so peeking here
  // would put a request behind every page view rather than behind every reader
  // who actually opens Ask AI. See the note on schedulePeek in anonQuota.js.
  useEffect(() => {
    const onQuota = (e) => setQuota(e.detail)
    window.addEventListener(QUOTA_EVENT, onQuota)
    const cancelPeek = schedulePeek()
    return () => {
      window.removeEventListener(QUOTA_EVENT, onQuota)
      cancelPeek()
    }
  }, [])

  // Out of questions: a refused consume, or the last permitted one once its
  // answer has finished streaming (the backend answers that one with
  // allowed + remaining 0, so Kapa can still reply). Degraded and unlimited
  // verdicts are never exhausted: no wall on a guess. See quotaExhausted.
  const exhausted = quotaExhausted(quota, !isBusy)
  const quotaRemaining = quota && !quota.degraded && !quota.unlimited ? quota.remaining : null
  const quotaLoginUrl = quota?.loginUrl || loginUrl

  // Cross-page persistence: the saved exchange renders until the user asks
  // something new in this drawer, at which point the live conversation (which
  // the api service resumes on the same threadId) takes over.
  const displayConversation =
    restoredConversation && conversation.length === 0 ? restoredConversation : conversation
  const latestQA = conversation[conversation.length - 1]

  // A query can die before a single byte streams back — most often when the Chat
  // SDK's bot protection can't obtain a captcha token, which aborts client-side
  // without issuing any request at all. The SDK doesn't reliably populate `error`
  // in that case, so treat a settled exchange with a question and no answer as
  // failed too. Without this the drawer renders the question above an empty
  // bubble and the user cannot tell the difference between "no answer came back"
  // and "the AI had nothing to say".
  // A REFUSED exchange is excluded: that question settles with no answer too,
  // and "the browser check may still be loading" would be a wrong and confusing
  // explanation for "you're out of free questions". The wall below is that
  // exchange's explanation.
  //
  // Deliberately narrower than `exhausted`, which also covers the LAST
  // permitted question (allowed, remaining 0). That one was admitted and really
  // was sent to Kapa, so when it dies client-side the reader deserves the
  // normal explanation and the failure deserves its Heap event, rather than a
  // bare question under a wall whose copy implies it was answered.
  const refused = quota?.allowed === false
  const queryFailed = !isBusy && Boolean(latestQA?.question) && !latestQA?.answer && !refused
  // Deliberately NOT the SDK's `error` string. The most common failure here
  // reports itself as "Error in verifying browser for feedback submission.
  // Captcha token could not be obtained." — which names feedback for what was
  // a question, and means nothing to a reader. The raw text goes to Heap and
  // the console (below); the panel shows something a user can act on.
  //
  // One exception: a dropped version scope (kapaScope.js). That failure is ours
  // to explain, is not the captcha, and is retried below without waiting for a
  // click, so the panel says what actually happened.
  const scopeDropped = error === SCOPE_DROPPED_MESSAGE
  const failureMessage = scopeDropped
    ? SCOPE_DROPPED_MESSAGE
    : 'No answer came back. The browser check may still be loading, so try again in a moment.'


  // Report failures the way the agent tier reports its own (handleAgentEvent's
  // response_error), so the rate of silent drops is visible in Heap rather than
  // only in the console. Once per failed exchange, not once per render.
  const reportedFailure = useRef(null)
  useEffect(() => {
    if (!queryFailed) {
      reportedFailure.current = null
      return
    }
    const signature = `${conversation.length}:${latestQA?.question || ''}`
    if (reportedFailure.current === signature) return
    reportedFailure.current = signature
    safeHeap('chat_error_docs_home', {
      error: error || 'no_answer_returned',
      tier: 'anonymous',
    })
  }, [queryFailed, error, conversation.length])

  // Restore the saved conversation on mount (24h expiry, handled by the module)
  useEffect(() => {
    const saved = loadConversation()
    if (saved?.conversation?.length > 0) {
      setRestoredConversation(saved.conversation)
      setHasInteracted(true)
    }
  }, [])

  useEffect(() => {
    let s = window.AI_SUGGESTIONS
    if (typeof s === 'string') {
      try { s = JSON.parse(s) } catch (e) { /* ignore */ }
    }
    if (Array.isArray(s)) setSuggestions(s)
  }, [])

  useEffect(() => {
    const onResize = () => {
      const nowMobile = window.innerWidth < 1150
      setIsMobile(nowMobile)
      if (!nowMobile) setDropdownOpen(false)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    let timer
    if (isPreparingAnswer) {
      timer = setInterval(() => setDots((d) => (d.length < 3 ? d + '.' : '')), 500)
    } else {
      setDots('')
    }
    return () => clearInterval(timer)
  }, [isPreparingAnswer])

  // Heap's ask_question_docs_home is reported by the provider's onQuerySubmit
  // callback (AskAI.jsx), which also carries the thread id — tracking here too
  // would double-count every submission.
  const doQuery = (q) => {
    if (!q.trim() || isBusy) return
    // Out of questions: the api service would refuse this anyway (it holds the
    // authoritative check). Stopping here keeps the SDK from recording a
    // question that never gets an answer, which would leave an empty bubble
    // sitting above the wall.
    if (exhausted) {
      setMessage('')
      setDropdownOpen(false)
      return
    }
    if (!hasInteracted) setHasInteracted(true)
    submitQuery(q)
    setMessage('')
    setDropdownOpen(false)
  }

  // Held in a ref so the global below always reaches the CURRENT doQuery. A dep
  // list on that effect froze whatever doQuery closed over when it last ran:
  // with [hasInteracted, isBusy] it captured `exhausted` at mount, so a reader
  // who had spent their questions on a previous day loaded a page, the peek
  // returned 429 and raised the wall, neither dep changed, and a code-block
  // "Ask AI" click still went through this path with exhausted frozen false,
  // recording a question whose consume was then refused: an orphan bubble above
  // the wall, with the retry row suppressed. The same staleness ran the other
  // way after a fail-open verdict. Updated after every render rather than on a
  // dep list, so there is no next value to forget.
  const doQueryRef = useRef(doQuery)
  useEffect(() => { doQueryRef.current = doQuery })

  // Same global entry point the agent interface exposes, so code-block and
  // playground "Ask AI" triggers work for anonymous users too.
  useEffect(() => {
    window.submitChatQuery = (query, autoSubmit = true) => {
      if (!query || !query.trim()) return
      if (autoSubmit) {
        doQueryRef.current(query)
      } else {
        setMessage(query)
        if (inputRef.current) inputRef.current.focus()
      }
    }
    return () => { delete window.submitChatQuery }
  }, [])

  const handleSubmit = (e) => { e.preventDefault(); doQuery(message) }

  // Re-ask the question that failed. The SDK owns the conversation array and
  // gives us no way to drop the dead exchange, so this appends a fresh one —
  // the same thing the user would do by retyping, minus the retyping.
  const handleRetry = (question) => {
    if (!question || isBusy) return
    doQuery(question)
  }

  // Re-ask automatically, once per failed exchange, after the scope was dropped.
  // By the time this effect runs the App has re-rendered KapaProvider without
  // sourceGroupIDsInclude (same batched update as the SDK's error state), so the
  // retry goes out unscoped with a fresh captcha token. A second failure shows
  // the message and the manual Try again button like any other error.
  const autoRetried = useRef(null)
  useEffect(() => {
    if (!scopeDropped || !queryFailed || !latestQA?.question) return
    const signature = `${conversation.length}:${latestQA.question}`
    if (autoRetried.current === signature) return
    autoRetried.current = signature
    handleRetry(latestQA.question)
  }, [scopeDropped, queryFailed, conversation.length])

  const handleReset = () => {
    clearConversation() // drop the cross-page copy too, or it reappears on nav
    resetConversation()
    setRestoredConversation(null)
    setMessage('')
    setHasInteracted(false)
    setDropdownOpen(false)
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(
      displayConversation.map((qa) => `Question: ${qa.question}\nAnswer: ${qa.answer}`).join('\n---\n')
    )
    showToast('Copied to clipboard', 'success')
  }

  const renderChips = () => {
    if (!Array.isArray(suggestions) || suggestions.length === 0) return null
    const first = isMobile ? suggestions.slice(0, 1) : suggestions.slice(0, 2)
    const rest = isMobile ? suggestions.slice(1) : suggestions.slice(2)
    return (
      <div className={isMobile ? 'chip-group-mobile' : 'chip-group-desktop'} style={{ display: 'flex', position: 'relative', flexWrap: isMobile ? 'wrap' : 'nowrap', gap: isMobile ? '8px' : '3px', width: '100%' }}>
        {first.map((s, i) => <div key={i} className="chip" onClick={() => doQuery(s)}>{s}</div>)}
        {rest.length > 0 && (
          <>
            <div className="chip more-chip" onClick={() => setDropdownOpen((o) => !o)}>Show more</div>
            {dropdownOpen && (
              <div className={isMobile ? 'pulldown-menu-mobile' : 'pulldown-menu-desktop'}>
                {rest.map((s, i) => <div key={i} className="pulldown-item" onClick={() => doQuery(s)}>{s}</div>)}
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <div className="chat-container">
        {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}

        {/* Slim upsell, chat works without signing in; this sells the agent
            tier and counts down the free questions. Suppressed once the wall is
            up, which carries the same call to action at full size. */}
        {loginUrl && !exhausted && (
        <a
          className={`chat-upsell${signingIn ? ' is-signing-in' : ''}`}
          aria-disabled={signingIn}
          href={`${loginUrl}${loginUrl.includes('?') ? '&' : '?'}return_to=${encodeURIComponent(window.location.pathname + window.location.search)}`}
          onClick={(e) => {
            // Anything we remember about their allowance is about to be wrong.
    forgetQuota()
    if (document.querySelector('[data-signin-modal]')) {
              e.preventDefault()
              window.dispatchEvent(new CustomEvent('docs-account:open-signin'))
              return
            }
            setSigningIn(true)
          }}
        >
          <Sparkles size={14} />
          <span>
            {signingIn
              ? 'Signing you in…'
              : quotaRemaining === null
                // Budget unknown (endpoint absent or degraded): sell the tier,
                // never imply a count we can't stand behind.
                ? 'Sign in to save your conversations and unlock the AI agent'
                : quotaRemaining <= 0
                  // Only visible while the last permitted answer is still
                  // streaming; the wall takes over once it settles.
                  ? 'That was your last free question. Sign in for unlimited questions and the AI agent'
                  : quotaRemaining === 1
                    ? '1 free question left. Sign in for unlimited questions and the AI agent'
                    : `${quotaRemaining} free questions left. Sign in for unlimited questions and the AI agent`}
          </span>
          <ArrowRight size={14} />
        </a>
        )}

        {/* "How can I help?" above a wall that says you can't ask would contradict
            itself, and the suggestion cards would be dead. Out of questions with
            no conversation to keep, the wall takes the welcome screen's place. */}
        {exhausted && displayConversation.length === 0 && (
          <QuotaWall hero quota={quota} loginUrl={quotaLoginUrl} signingIn={signingIn} setSigningIn={setSigningIn} />
        )}

        {!hasInteracted && !exhausted && (
          <div className="welcome-screen">
            <div className="welcome-icon"><Sparkles size={28} /></div>
            <h2 className="welcome-title">How can I help?</h2>
            <p className="welcome-description">
              I can answer questions about Redpanda docs, write quickstarts, and help you troubleshoot.
            </p>
            {suggestions.length > 0 && (
              <div className="suggestion-cards">
                {suggestions.map((s, i) => (
                  <button key={i} type="button" className="suggestion-card" onClick={() => doQuery(s)}>{s}</button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="conversation-area" style={hasInteracted ? undefined : { display: 'none' }}>
          <div className="conversation">
            {displayConversation.map((qa, idx) => {
              const isLast = idx === displayConversation.length - 1
              // Feedback needs a live Kapa questionAnswerId: a restored exchange
              // is replayed from localStorage, so voting on it would post against
              // an id from a previous page's session.
              const canFeedback = conversation.length > 0 && latestQA?.id === qa.id
              return (
                <div key={qa.id ?? `temp-${idx}`} className="qa-pair">
                  <hr className="section-divider" />
                  <div className="question">{qa.question}</div>
                  {/* Render the bubble only when there is text, or while this
                      exchange is actively streaming into it. An empty bubble
                      otherwise reads as an answer that arrived and said
                      nothing — including for an earlier failed exchange the
                      user has since retried past. */}
                  {(qa.answer || (isLast && isBusy)) && <Answer md={qa.answer} />}
                  {isLast && !isBusy && qa.answer && (
                    <div className="actions-feedback flex justify-between items-center">
                      <div className="action-buttons">
                        <button type="button" onClick={handleReset} className="action-button"><RefreshCcw /> Clear</button>
                        <button type="button" onClick={() => handleCopy().catch(() => showToast('Failed to copy', 'error'))} className="action-button"><ClipboardCopy /> Copy</button>
                      </div>
                      {canFeedback && <FeedbackButtons questionAnswerId={qa.id} showToast={showToast} />}
                    </div>
                  )}
                  {/* Complement of the row above: the exchange settled with no
                      answer, so say so and offer a retry instead of leaving a
                      blank bubble. Only for the live conversation — a restored
                      exchange always carries the answer it was saved with. */}
                  {isLast && queryFailed && conversation.length > 0 && (
                    <div className="chat-error" role="alert">
                      <TriangleAlert className="chat-error-icon" aria-hidden="true" />
                      <span className="chat-error-text">{failureMessage}</span>
                      <button
                        type="button"
                        className="action-button chat-error-retry"
                        onClick={() => handleRetry(qa.question)}
                      >
                        <RefreshCcw /> Try again
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
            {isPreparingAnswer && <div className="loading">{`Preparing answer${dots}`}</div>}
          </div>
        </div>

        {/* Out of free questions with answers on screen: the wall replaces only
            the composer (see QuotaWall). With no answers yet, the hero variant
            renders in the body instead, so nothing is drawn here. */}
        {exhausted ? (
          displayConversation.length > 0 && (
            <div className="chat-footer-wrapper fixed-bottom">
              <QuotaWall quota={quota} loginUrl={quotaLoginUrl} signingIn={signingIn} setSigningIn={setSigningIn} />
            </div>
          )
        ) : (
        <div className={`chat-footer-wrapper ${hasInteracted ? 'fixed-bottom' : ''}`}>
          <form onSubmit={handleSubmit} className="chat-input-form">
            <div className="chat-input-wrapper">
              <label htmlFor="chat-message" className="visually-hidden">Ask a question about Redpanda</label>
              <textarea
                ref={inputRef}
                id="chat-message"
                name="chat-message"
                className="chat-input"
                autoComplete="off"
                rows={1}
                placeholder="Ask anything about Redpanda docs..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e) }
                }}
                disabled={isBusy}
              />
              {isBusy ? (
                <button type="button" onClick={stopGeneration} className="submit-button stop-button" aria-label="Stop"><CircleStop size={18} /></button>
              ) : (
                <button type="submit" className="submit-button" aria-label="Submit" disabled={!message.trim()}><ArrowRight size={18} /></button>
              )}
            </div>
          </form>
          <div className="disclaimer">
            <p>
              <a href="https://www.redpanda.com/legal/privacy-policy" target="_blank" rel="noopener">Privacy policy</a>
              {' · '}Powered by <a href="https://kapa.ai" target="_blank" rel="noopener noreferrer">kapa.ai</a>
            </p>
          </div>
        </div>
        )}
      </div>
    </ErrorBoundary>
  )
}
