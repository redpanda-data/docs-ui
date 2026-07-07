import React, { useState, useEffect, useRef, Component } from 'react'
import { useChat } from '@kapaai/react-sdk'
import { ArrowRight, CircleStop, RefreshCcw, ClipboardCopy, Sparkles } from 'lucide-react'
import { safeHeap } from '../heap.js'
import { Answer, Toast } from './chatShared.jsx'

// Anonymous drawer, powered by the Chat SDK (not the Agent SDK). Renders into
// the same #chat-panel-kapa-root chrome with the same CSS classes as the
// signed-in Agent interface, so the two tiers look identical — the agent tier
// just adds tools, history, and account-scoped features on top. Needs no
// session backend (the Chat SDK uses its own bot protection).

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
  const inputRef = useRef(null)

  const showToast = (msg, type = 'success') => setToast({ message: msg, type })

  const {
    conversation,
    submitQuery,
    isPreparingAnswer,
    isGeneratingAnswer,
    stopGeneration,
    resetConversation,
  } = useChat()

  const isBusy = isPreparingAnswer || isGeneratingAnswer

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

  const doQuery = (q) => {
    if (!q.trim() || isBusy) return
    if (!hasInteracted) setHasInteracted(true)
    safeHeap('ask_question_docs_home', { question: q, tier: 'anonymous' })
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

  const handleReset = () => {
    resetConversation()
    setMessage('')
    setHasInteracted(false)
    setDropdownOpen(false)
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(
      conversation.map((qa) => `Question: ${qa.question}\nAnswer: ${qa.answer}`).join('\n---\n')
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

        {/* Slim upsell — chat works without signing in; this sells the agent tier */}
        <a
          className="chat-upsell"
          href={loginUrl ? `${loginUrl}${loginUrl.includes('?') ? '&' : '?'}return_to=${encodeURIComponent(window.location.pathname + window.location.search)}` : '/login'}
        >
          <Sparkles size={14} />
          <span>Sign in to save your conversations and unlock the AI agent</span>
          <ArrowRight size={14} />
        </a>

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
            {conversation.map((qa, idx) => {
              const isLast = idx === conversation.length - 1
              return (
                <div key={qa.id ?? idx} className="qa-pair">
                  <hr className="section-divider" />
                  <div className="question">{qa.question}</div>
                  <Answer md={qa.answer} />
                  {isLast && !isBusy && qa.answer && (
                    <div className="actions-feedback flex justify-between items-center">
                      <div className="action-buttons">
                        <button type="button" onClick={handleReset} className="action-button"><RefreshCcw /> Clear</button>
                        <button type="button" onClick={() => handleCopy().catch(() => showToast('Failed to copy', 'error'))} className="action-button"><ClipboardCopy /> Copy</button>
                      </div>
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
