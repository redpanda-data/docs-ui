import React, { useState, useEffect, useRef, Component } from 'react'
import { useChat, useDeepThinking } from '@kapaai/react-sdk'
import {
  ArrowUp,
  ArrowDown,
  ThumbsUp,
  ThumbsDown,
  RefreshCcw,
  ClipboardCopy,
  CircleStop,
  FileSearch,
  Check,
  AlertCircle,
} from 'lucide-react'
import DOMPurify from 'dompurify'
import { Marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js'
import { loadConversation, clearConversation } from '../chatPersistence.js'

// ——— ErrorBoundary ——————————————————————————————————————————————————
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(err, info) {
    console.error('Render error in ChatInterface:', err, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          Something went wrong. Try refreshing the page.
        </div>
      )
    }
    return this.props.children
  }
}

const marked = new Marked(
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix:     'hljs language-',
    highlight(code, info = '') {
      try {
        return hljs.highlightAuto(code).value
      } catch {
        return code
      }
    },
  })
)


// ——— Toast component ————————————————————————————————————————————————————
function Toast({ message, type = 'success', onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      if (onDismiss) onDismiss()
    }, 3000)
    return () => clearTimeout(timer)
  }, [onDismiss])

  const isError = type === 'error'

  return (
    <div className={`chat-toast ${isError ? 'chat-toast-error' : 'chat-toast-success'}`}>
      <span className="chat-toast-icon">
        {isError ? <AlertCircle size={16} /> : <Check size={16} />}
      </span>
      <span className="chat-toast-message">{message}</span>
    </div>
  )
}

// ——— Answer component ———————————————————————————————————————————————————
function Answer({ md }) {
  const containerRef = useRef(null)

  useEffect(() => {
    try {
      const rawHtml = marked.parse(md || '')
      const clean   = DOMPurify.sanitize(rawHtml)
      if (containerRef.current) {
        containerRef.current.innerHTML = clean
      }
    } catch (err) {
      console.error('Markdown render error:', err)
      if (containerRef.current) {
        containerRef.current.textContent = md
      }
    }
  }, [md])

  return <div ref={containerRef} className="answer" />
}

// ——— FeedbackButtons —————————————————————————————————————————————————————
function FeedbackButtons({ questionAnswerId, showToast }) {
  const { addFeedback } = useChat()

  const handleFeedback = async (reaction) => {
    try {
      await addFeedback(questionAnswerId, reaction)
      showToast(
        reaction === 'upvote'
          ? 'Thanks for the feedback!'
          : 'Feedback received',
        'success'
      )
    } catch (err) {
      console.error('Feedback error', err)
      showToast('Could not send feedback', 'error')
    }
  }

  return (
    <div className="feedback-container">
      <div className="feedback-group">
        <button
          className="feedback-button"
          type="button"
          onClick={() => handleFeedback('upvote')}
          title="This was helpful"
        >
          <ThumbsUp className="feedback-icon" />
        </button>
        <button
          className="feedback-button"
          type="button"
          onClick={() => handleFeedback('downvote')}
          title="This wasn't helpful"
        >
          <ThumbsDown className="feedback-icon" />
        </button>
      </div>
    </div>
  )
}

// ——— ActionButtons ———————————————————————————————————————————————————————
function ActionButtons({ onReset, onCopy, showToast }) {
  const safeCopy = async () => {
    try {
      await onCopy()
      showToast('Copied to clipboard', 'success')
    } catch (e) {
      console.error('Copy error:', e)
      showToast('Failed to copy', 'error')
    }
  }

  return (
    <div className="action-buttons">
      <button type="button" onClick={onReset} className="action-button">
        <RefreshCcw /> Clear
      </button>
      <button type="button" onClick={safeCopy} className="action-button">
        <ClipboardCopy /> Copy
      </button>
    </div>
  )
}

/**
 * Renders the main chat interface, providing a conversational UI with markdown-rendered answers, feedback and copy/reset actions, animated loading states, and responsive suggestion chips.
 *
 * Manages user input, conversation state, and UI responsiveness for both desktop and mobile. Handles dynamic textarea resizing, scroll-to-bottom behavior, and conditional display of header/footer elements based on user interaction. Integrates with the chat backend via the `useChat` hook to submit queries, stop or reset conversations, and display AI-generated suggestions. Also manages inline toast notifications for copy and feedback actions.
 */
export default function ChatInterface() {
  const [message, setMessage]               = useState('')
  const [dots, setDots]                     = useState('')
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [stoppedIds, setStoppedIds]         = useState(new Set())
  const [suggestions, setSuggestions]       = useState([])
  const [hasInteracted, setHasInteracted]   = useState(false)
  const [toast, setToast]                   = useState(null)
  const [restoredConversation, setRestoredConversation] = useState(null)
  const textareaRef = useRef(null)

  const showToast = (message, type = 'success') => {
    setToast({ message, type })
  }

  const dismissToast = () => {
    setToast(null)
  }

  const resetTextareaHeight = () => {
    if (!textareaRef.current) return
    textareaRef.current.style.height = 'unset'
  }

  // Detect mobile vs. desktop breakpoint
  const [isMobile, setIsMobile]         = useState(window.innerWidth < 1150)
  // Track whether dropdown is open (both mobile & desktop share this)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  useEffect(() => {
    let s = window.AI_SUGGESTIONS;
    // if it's a string, try parsing it
    if (typeof s === 'string') {
      try {
        s = JSON.parse(s);
      } catch (e) {
        console.warn('Could not parse AI_SUGGESTIONS JSON', e);
      }
    }
    if (Array.isArray(s)) {
      setSuggestions(s);
    } else {
      console.error('window.AI_SUGGESTIONS must be an array', s);
    }
  }, []);

  // Restore conversation from localStorage on mount (cross-page persistence)
  useEffect(() => {
    const saved = loadConversation()
    if (saved?.conversation?.length > 0) {
      setRestoredConversation(saved.conversation)
      setHasInteracted(true)
    }
  }, [])

  // Update isMobile on resize. Close dropdown if switching breakpoints.
  useEffect(() => {
    const handleResize = () => {
      const nowMobile = window.innerWidth < 1150
      setIsMobile(nowMobile)
      if (!nowMobile) {
        // closing dropdown when going to desktop ensures we can recalc properly
        setDropdownOpen(false)
      }
    }
    window.addEventListener('resize', handleResize)
    handleResize()
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const {
    conversation,
    submitQuery,
    isGeneratingAnswer,
    stopGeneration,
    resetConversation,
    isPreparingAnswer,
  } = useChat()

  const deepThinking = useDeepThinking()

  // Merge restored conversation with live conversation for display
  // Show restored conversation when live is empty, otherwise show live
  // (live conversation will include new queries that continue the thread)
  const displayConversation = restoredConversation && conversation.length === 0
    ? restoredConversation
    : conversation

  const latestQA = conversation.length > 0 ? conversation.getLatest() : null

  // Show/hide "scroll down" button
  useEffect(() => {
    if (!hasInteracted || isPreparingAnswer) return
    const THRESHOLD = 300

    // Check if we're in chat panel drawer
    const chatScroll = document.querySelector('.chat-scroll')
    const isInPanel = chatScroll && chatScroll.contains(document.getElementById('chat-panel-kapa-root'))

    const handleScroll = () => {
      let scrollTop, innerH, scrollH

      if (isInPanel && chatScroll) {
        // Use chat panel scroll container
        scrollTop = chatScroll.scrollTop
        innerH = chatScroll.clientHeight
        scrollH = chatScroll.scrollHeight
      } else {
        // Use window scroll (home page)
        scrollTop = window.scrollY
        innerH = window.innerHeight
        scrollH = document.documentElement.scrollHeight
      }

      const canScroll = scrollH > innerH
      const atBottom = scrollTop + innerH >= scrollH - THRESHOLD

      if (!canScroll) {
        setShowScrollDown(false)
        return
      }
      setShowScrollDown(!atBottom)
    }

    const scrollTarget = isInPanel ? chatScroll : window
    scrollTarget.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('resize', handleScroll, { passive: true })
    handleScroll()
    return () => {
      scrollTarget.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
    }
  }, [hasInteracted, isPreparingAnswer, isGeneratingAnswer])

  const scrollToBottom = () => {
    // Check if we're in the chat panel drawer
    const chatScroll = document.querySelector('.chat-scroll')
    if (chatScroll && chatScroll.contains(document.getElementById('chat-panel-kapa-root'))) {
      // Scroll within the chat panel
      chatScroll.scrollTo({
        top: chatScroll.scrollHeight,
        behavior: 'smooth',
      })
    } else {
      // Scroll the window (home page behavior)
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: 'smooth',
      })
    }
  }

  // “Preparing answer…” dots animation
  useEffect(() => {
    let timer
    if (isPreparingAnswer) {
      timer = setInterval(() => {
        setDots((d) => (d.length < 3 ? d + '.' : ''))
      }, 500)
    } else {
      setDots('')
    }
    return () => clearInterval(timer)
  }, [isPreparingAnswer])

  // Hide header/footer until user interacts
  useEffect(() => {
    const footerEl      = document.querySelector('footer.footer')
    const homeHeaderEl  = document.querySelector('.home-header-container')
    const features  = document.querySelector('.features')
    if (!footerEl || !homeHeaderEl || !features) return

    if (hasInteracted) {
      footerEl.style.display      = 'none'
      homeHeaderEl.style.height   = 'unset'
      if (window.innerWidth < 1150) {
        features.style.display = 'none'
      }
    } else {
      footerEl.style.display      = ''
      if (window.innerWidth < 1150) {
        features.style.display = 'flex'
      }
    }
  }, [hasInteracted])

  const doQuery = (q) => {
    if (!q.trim()) return
    if (!hasInteracted) setHasInteracted(true)
    submitQuery(q)
    setMessage('')
    setDropdownOpen(false) // close dropdown when you tap anything
  }

  // Expose submitChatQuery globally for external components (playground, code blocks)
  useEffect(() => {
    window.submitChatQuery = (query, autoSubmit = true) => {
      if (!query || !query.trim()) return
      if (autoSubmit) {
        doQuery(query)
      } else {
        setMessage(query)
        // Focus the textarea
        if (textareaRef.current) {
          textareaRef.current.focus()
        }
      }
    }
    return () => {
      delete window.submitChatQuery
    }
  }, [submitQuery, hasInteracted])

  const handleSubmit = (e) => {
    e.preventDefault()
    doQuery(message)
    resetTextareaHeight()
  }

  const handleReset = () => {
    clearConversation()  // Clear localStorage persistence
    resetConversation()
    setMessage('')
    setStoppedIds(new Set())
    setRestoredConversation(null)
    setHasInteracted(false)
    setShowScrollDown(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setDropdownOpen(false)
    resetTextareaHeight()
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(
        displayConversation
          .map((q) => `Question: ${q.question}\nAnswer: ${q.answer}`)
          .join('\n---\n')
      )
    } catch {
      throw new Error('Clipboard API not available')
    }
  }

  const handleStop = () => {
    stopGeneration()
    const idx     = conversation.length - 1
    const lastKey = conversation[idx]?.id ?? `temp-${idx}`
    setStoppedIds((s) => new Set(s).add(lastKey))
  }

  // ——— RENDERING FUNCTIONS ————————————————————————————————————————————————

  const renderDesktopChips = () => {
    if (!Array.isArray(suggestions) || suggestions.length === 0) return null;

    const firstTwo  = suggestions.slice(0, 2)
    const theRest   = suggestions.slice(2)

    return (
      <div className="chip-group-desktop" style={{ display: 'flex', position: 'relative', width: '100%', gap: '3px' }}>
        {firstTwo.map((s, i) => (
          <div key={i} className="chip" onClick={() => doQuery(s)}>
            {s}
          </div>
        ))}

        {theRest.length > 0 && (
          <>
            <div
              className="chip more-chip"
              title="Show more suggestions"
              aria-label="Show more suggestions"
              onClick={() => setDropdownOpen((open) => !open)}
            >
              Show more
            </div>

            {dropdownOpen && (
              <div className="pulldown-menu-desktop">
                {theRest.map((s, i) => (
                  <div
                    key={i}
                    className="pulldown-item"
                    onClick={() => doQuery(s)}
                  >
                    {s}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  const renderMobileChips = () => {
    if (suggestions.length === 0) return null

    const first    = suggestions[0]
    const theRest  = suggestions.slice(1)

    return (
      <div className="chip-group-mobile" style={{ display: 'flex', position: 'relative', flexWrap: 'wrap', gap: '8px' }}>
        <div className="chip" onClick={() => doQuery(first)}>
          {first}
        </div>

        {theRest.length > 0 && (
          <>
            <div
              className="chip more-chip"
              onClick={() => setDropdownOpen((open) => !open)}
            >
              Show more
            </div>

            {dropdownOpen && (
              <div className="pulldown-menu-mobile">
                {theRest.map((s, i) => (
                  <div
                    key={i}
                    className="pulldown-item"
                    onClick={() => doQuery(s)}
                  >
                    {s}
                  </div>
                ))}
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
        {/* Toast notification */}
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onDismiss={dismissToast}
          />
        )}

        <div
          className="conversation-area"
          style={hasInteracted ? { paddingBottom: '280px' } : { paddingBottom: '20px' }}
        >
          <div className="conversation">
            {displayConversation.map((qa, idx) => {
              const key        = qa.id ?? `temp-${idx}`
              const wasStopped = stoppedIds.has(key)
              // For restored conversations, show action buttons on the last item
              const isLast     = idx === displayConversation.length - 1
              // Feedback only available for live conversation items (not restored)
              const canFeedback = conversation.length > 0 && latestQA?.id === qa.id
              return (
                <div key={key} className="qa-pair">
                  <hr className="section-divider" />
                  <div className="question">{qa.question}</div>
                  <Answer md={qa.answer} />
                  {isLast && !isPreparingAnswer && !isGeneratingAnswer && (
                    <div className="actions-feedback flex justify-between items-center">
                      <ActionButtons
                        onReset={handleReset}
                        onCopy={handleCopy}
                        showToast={showToast}
                      />
                      {!wasStopped && canFeedback && (
                        <FeedbackButtons
                          questionAnswerId={qa.id}
                          showToast={showToast}
                        />
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            {isPreparingAnswer && (
              <div className="loading">
                {deepThinking.active
                  ? `Running deep thinking mode up to a minute. ${deepThinking.seconds}s…`
                  : `Preparing answer${dots}`
                }
              </div>
            )}
          </div>
        </div>

        <div className={`chat-footer-wrapper ${hasInteracted ? 'fixed-bottom' : ''}`}>
          {/* Optional Scroll Down Button */}
          {showScrollDown && (
            <button
              className="scroll-down-button"
              onClick={scrollToBottom}
              aria-label="Scroll to input"
            >
              <ArrowDown />
            </button>
          )}

          <form onSubmit={handleSubmit}>
            <div className="chat-card">
              <div className="chat-content">
              <label htmlFor="chat-message" className="visually-hidden">
                Ask a question about Redpanda
              </label>
              <textarea
                ref={textareaRef}
                id="chat-message"
                name="chat-message"
                className="chat-input"
                autoComplete="off"
                placeholder="How can we help you with Redpanda today?"
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value)

                  const el = e.target
                  el.style.height = 'auto'
                  el.style.height = Math.min(el.scrollHeight, 200) + 'px'
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSubmit(e)
                  }
                }}
                disabled={isGeneratingAnswer || isPreparingAnswer}
              />
              </div>
              <div className="chat-footer">
                {isPreparingAnswer || isGeneratingAnswer ? (
                  <button
                    type="button"
                    onClick={handleStop}
                    className="main-button flex items-center gap-1"
                  >
                    <CircleStop className="h-5 w-5" />
                    <span className="button-text">Stop</span>
                  </button>
                ) : (
                  <div className="chat-footer-buttons">
                    <button
                      type="button"
                      onClick={deepThinking.toggle}
                      className={`deep-thinking-button outlined ${deepThinking.active ? 'active' : ''}`}
                      title="For harder questions. Search longer across all sources. Takes up to 1 minute."
                    >
                      <span className="button-icon-left">
                        {/* Tabler FileSearch icon from lucide-react */}
                        <FileSearch className="button-icon" />
                      </span>
                      <span className="button-text">Deep thinking</span>
                    </button>
                    <button type="submit" className="main-button">
                      <ArrowUp className="button-icon" />
                      <span className="button-text">Submit</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </form>

          {/* ——— SUGGESTION CHIPS ————————————————————————————————————————————————— */}
          {suggestions.length > 0 && (
            <div
              className="suggestion-chips"
              style={hasInteracted ? { display: 'none' } : { display: 'flex' }}
            >
              {isMobile
                ? renderMobileChips()
                : renderDesktopChips()}
            </div>
          )}

          <div className="disclaimer">
            <p>
              Review the{' '}
              <a
                href="https://www.redpanda.com/legal/privacy-policy"
                target="_blank"
                rel="noopener"
              >
                Redpanda privacy policy
              </a>{' '}
              to understand how your data is used.
            </p>
            <p>
              Powered by <a href="https://kapa.ai" target="_blank" rel="noopener noreferrer">kapa.ai</a>
            </p>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  )
}
