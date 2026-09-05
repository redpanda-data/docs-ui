import React, { useState, useEffect, useRef, Component } from 'react'
import { useChat } from '@kapaai/react-sdk'
import { ArrowRight, CircleStop, RefreshCcw, ClipboardCopy, Sparkles, ThumbsUp, ThumbsDown, TriangleAlert } from 'lucide-react'
import { loadConversation, clearConversation } from '../chatPersistence.js'
import { safeHeap } from '../heap.js'
import { SCOPE_DROPPED_MESSAGE } from '../kapaScope.js'
import { Answer, Toast } from './chatShared.jsx'

// Anonymous drawer, powered by the Chat SDK (not the Agent SDK). Renders into
// the same #chat-panel-kapa-root chrome with the same CSS classes as the
// signed-in Agent interface, so the two tiers look identical — the agent tier
// just adds tools, history, and account-scoped features on top. Needs no
// session backend (the Chat SDK uses its own bot protection).

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
  const queryFailed = !isBusy && Boolean(latestQA?.question) && !latestQA?.answer
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
    if (!hasInteracted) setHasInteracted(true)
    submitQuery(q)
    setMessage('')
    setDropdownOpen(false)
  }

  // Same global entry point the agent interface exposes, so code-block and
  // playground "Ask AI" triggers work for anonymous users too.
  useEffect(() => {
    window.submitChatQuery = (query, autoSubmit = true) => {
      if (!query || !query.trim()) return
      if (autoSubmit) {
        doQuery(query)
      } else {
        setMessage(query)
        if (inputRef.current) inputRef.current.focus()
      }
    }
    return () => { delete window.submitChatQuery }
  }, [hasInteracted, isBusy])

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

        {/* Slim upsell — chat works without signing in; this sells the agent tier. */}
        {loginUrl && (
        <a
          className={`chat-upsell${signingIn ? ' is-signing-in' : ''}`}
          aria-disabled={signingIn}
          href={`${loginUrl}${loginUrl.includes('?') ? '&' : '?'}return_to=${encodeURIComponent(window.location.pathname + window.location.search)}`}
          onClick={(e) => {
            if (document.querySelector('[data-signin-modal]')) {
              e.preventDefault()
              window.dispatchEvent(new CustomEvent('docs-account:open-signin'))
              return
            }
            setSigningIn(true)
          }}
        >
          <Sparkles size={14} />
          <span>{signingIn ? 'Signing you in…' : 'Sign in to save your conversations and unlock the AI agent'}</span>
          <ArrowRight size={14} />
        </a>
        )}

        {!hasInteracted && (
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
      </div>
    </ErrorBoundary>
  )
}
