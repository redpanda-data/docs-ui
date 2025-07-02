import React, { useState, useEffect, useRef, Component } from 'react'
import { useChat } from '@kapaai/react-sdk'
import {
  ArrowUp,
  ArrowDown,
  ThumbsUp,
  ThumbsDown,
  RefreshCcw,
  ClipboardCopy,
  CircleStop,
} from 'lucide-react'
import DOMPurify from 'dompurify'
import { Marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js'

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
function FeedbackButtons({ questionAnswerId, setFeedbackToast }) {
  const { addFeedback } = useChat()

  const handleFeedback = async (reaction) => {
    try {
      await addFeedback(questionAnswerId, reaction)
      setFeedbackToast(
        reaction === 'upvote'
          ? "Thanks! Glad you found that helpful."
          : "We've got your feedback."
      )
    } catch (err) {
      console.error('Feedback error', err)
      setFeedbackToast('⚠️ Could not send your feedback. Try again.')
    }
    setTimeout(() => setFeedbackToast(null), 3000)
  }

  return (
    <div className="feedback-container">
      <div className="feedback-group">
        <button
          className="feedback-button"
          type="button"
          onClick={() => handleFeedback('upvote')}
        >
          <ThumbsUp className="feedback-icon" />
        </button>
        <button
          className="feedback-button"
          type="button"
          onClick={() => handleFeedback('downvote')}
        >
          <ThumbsDown className="feedback-icon" />
        </button>
      </div>
    </div>
  )
}

// ——— ActionButtons ———————————————————————————————————————————————————————
function ActionButtons({ onReset, onCopy, setCopyToast }) {
  const safeCopy = () => {
    try {
      onCopy()
      setCopyToast('Copied to clipboard!')
    } catch (e) {
      console.error('Copy error:', e)
      setCopyToast('⚠️ Copy failed.')
    }
    setTimeout(() => setCopyToast(null), 2000)
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

// ——— Main ChatInterface ————————————————————————————————————————————————————
export default function ChatInterface() {
  const [message, setMessage]               = useState('')
  const [dots, setDots]                     = useState('')
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [stoppedIds, setStoppedIds]         = useState(new Set())
  const [suggestions, setSuggestions]       = useState([])
  const [hasInteracted, setHasInteracted]   = useState(false)
  const [copyToast, setCopyToast]           = useState(null)
  const [feedbackToast, setFeedbackToast]   = useState(null)
  const textareaRef = useRef(null)

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

  const latestQA = conversation.getLatest()

  // Show/hide “scroll down” button
  useEffect(() => {
    if (!hasInteracted || isPreparingAnswer) return
    const THRESHOLD = 300

    const handleScroll = () => {
      const scrollTop = window.scrollY
      const innerH    = window.innerHeight
      const scrollH   = document.documentElement.scrollHeight
      const canScroll = scrollH > innerH
      const atBottom  = scrollTop + innerH >= scrollH - THRESHOLD

      if (!canScroll) {
        setShowScrollDown(false)
        return
      }
      setShowScrollDown(!atBottom)
    }

    window.addEventListener('scroll', handleScroll)
    window.addEventListener('resize', handleScroll)
    handleScroll()
    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('resize', handleScroll)
    }
  }, [hasInteracted, isPreparingAnswer, isGeneratingAnswer])

  const scrollToBottom = () => {
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: 'smooth',
    })
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

  const handleSubmit = (e) => {
    e.preventDefault()
    doQuery(message)
    resetTextareaHeight()
  }

  const handleReset = () => {
    resetConversation()
    setMessage('')
    setStoppedIds(new Set())
    setHasInteracted(false)
    setShowScrollDown(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setDropdownOpen(false)
    resetTextareaHeight()
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(
        conversation
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
        <div
          className="conversation-area"
          style={hasInteracted ? { paddingBottom: '230px' } : { paddingBottom: '0px' }}
        >
          <div className="conversation">
            {conversation.map((qa, idx) => {
              const key        = qa.id ?? `temp-${idx}`
              const wasStopped = stoppedIds.has(key)
              const isLast     = latestQA?.id === qa.id
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
                        setCopyToast={setCopyToast}
                      />
                      {!wasStopped && (
                        <FeedbackButtons
                          questionAnswerId={qa.id}
                          setFeedbackToast={setFeedbackToast}
                        />
                      )}
                    </div>
                  )}
                  {(copyToast || feedbackToast) && (
                    <div className="toast-inline">
                      {copyToast || feedbackToast}
                    </div>
                  )}
                </div>
              )
            })}
            {isPreparingAnswer && (
              <div className="loading">Preparing answer{dots}</div>
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
              <textarea
                ref={textareaRef}
                id="chat-message"
                name="chat-message"
                className="chat-input"
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
                  <button type="submit" className="main-button">
                    <ArrowUp className="button-icon" />
                    <span className="button-text">Submit</span>
                  </button>
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
              Responses are generated using AI and may contain mistakes.
            </p>
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
          </div>
        </div>
      </div>
    </ErrorBoundary>
  )
}
