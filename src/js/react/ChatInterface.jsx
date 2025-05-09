import React, { useState, useEffect, useRef, Component } from 'react'
import { useChat } from '@kapaai/react-sdk'
import {
  ArrowUp,
  ThumbsUp,
  ThumbsDown,
  RefreshCcw,
  ClipboardCopy,
  ChevronDown,
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
    // if no language is specified, we'll still get the `.hljs` class
    emptyLangClass: 'hljs',
    // prefix for non-empty langs (<code class="hljs language-xxx">)
    langPrefix:     'hljs language-',
    highlight(code, info = '') {
      // take only the first token of the info string
      const rawLang = info.split(/\s+/)[0]
                         .replace(/[^A-Za-z0-9]/g, '')
                         .toLowerCase()

      // explicit language? try to use it
      if (hljs.getLanguage(rawLang)) {
        try {
          return hljs.highlight(code, { language: rawLang }).value
        } catch (err) {
          console.warn(`Highlight.js failed for "${rawLang}":`, err)
        }
      }

      // no lang or unknown → auto-detect
      const auto = hljs.highlightAuto(code)
      return auto.value
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
        // fallback to plain text
        containerRef.current.textContent = md
      }
    }
  }, [md])

  return <div ref={containerRef} className="answer" />
}

// ——— FeedbackButtons —————————————————————————————————————————————————————
function FeedbackButtons({ questionAnswerId }) {
  const { addFeedback } = useChat()
  const [toast, setToast] = useState(null)

  // Unified handler for both upvote/downvote
  const handleFeedback = async (reaction) => {
    try {
      await addFeedback(questionAnswerId, reaction)
      setToast(
        reaction === 'upvote'
          ? "Thanks! Glad you found that helpful."
          : "We've got your feedback."
      )
    } catch (err) {
      console.error('Feedback error', err)
      setToast('⚠️ Could not send your feedback. Try again.')
    }
    setTimeout(() => setToast(null), 3000)
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
          <span>Good Answer</span>
        </button>
        <button
          className="feedback-button"
          type="button"
          onClick={() => handleFeedback('downvote')}
        >
          <ThumbsDown className="feedback-icon" />
          <span>Bad Answer</span>
        </button>
      </div>

      {/* Inline toast below the thumbs */}
      {toast && (
        <div className="toast-inline">
          {toast}
        </div>
      )}
    </div>
  )
}

// ——— ActionButtons ———————————————————————————————————————————————————————
function ActionButtons({ onReset, onCopy }) {
  const [copyToast, setCopyToast] = useState(null)

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
        <RefreshCcw /> Reset
      </button>
      <button type="button" onClick={safeCopy} className="action-button">
        <ClipboardCopy /> Copy
      </button>
      {copyToast && <div className="toast-inline">{copyToast}</div>}
    </div>
  )
}

// ——— Main ChatInterface ————————————————————————————————————————————————————
export default function ChatInterface() {
  const [message, setMessage]             = useState('')
  const [dots, setDots]                   = useState('')
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [stoppedIds, setStoppedIds]       = useState(new Set())

  const {
    conversation,
    submitQuery,
    isGeneratingAnswer,
    stopGeneration,
    resetConversation,
    isPreparingAnswer,
  } = useChat()

  const latestQA = conversation.getLatest()
  const inputRef = useRef(null)

  // scroll-down button
  useEffect(() => {
    const onScroll = () => {
      if (!inputRef.current) return
      const {top} = inputRef.current.getBoundingClientRect()
      setShowScrollDown(top > window.innerHeight)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    onScroll()
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  const scrollToBottom = () => {
    inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }

  // animated “…” during prepare
  useEffect(() => {
    let timer
    if (isPreparingAnswer) {
      timer = setInterval(() => setDots(d => (d.length < 3 ? d + '.' : '')), 500)
    } else {
      setDots('')
    }
    return () => clearInterval(timer)
  }, [isPreparingAnswer])

  // shared query logic
  const doQuery = q => {
    if (!q.trim()) return
    submitQuery(q)
    setMessage('')
  }

  // expose for chips
  useEffect(() => {
    window.submitKapaQuery = doQuery
    return () => { delete window.submitKapaQuery }
  }, [doQuery])

  const handleSubmit = e => {
    e.preventDefault()
    doQuery(message)
  }

  const handleReset = () => {
    resetConversation()
    setMessage('')
    setStoppedIds(new Set())
  }

  const handleCopy = () =>
    navigator.clipboard.writeText(
      conversation.map(q => `Question: ${q.question}\nAnswer: ${q.answer}`).join('\n---\n')
    )

  const handleStop = () => {
    stopGeneration()
    const idx     = conversation.length - 1
    const lastKey = conversation[idx]?.id ?? `temp-${idx}`
    setStoppedIds(s => new Set(s).add(lastKey))
  }

  return (
    <ErrorBoundary>
      <div className="chat-container">
        <div className="conversation">
          {conversation.map((qa, idx) => {
            const key        = qa.id ?? `temp-${idx}`
            const wasStopped = stoppedIds.has(key)
            const isLast     = latestQA?.id === qa.id

            return (
              <div key={key} className="qa-pair">
                <div className="question">{qa.question}</div>
                <Answer md={qa.answer} />

                {!wasStopped &&
                  !isPreparingAnswer &&
                  !isGeneratingAnswer && (
                  isLast ? (
                    <div className="actions-feedback">
                      <ActionButtons onReset={handleReset} onCopy={handleCopy} />
                      <FeedbackButtons questionAnswerId={qa.id} />
                    </div>
                  ) : (
                    <FeedbackButtons questionAnswerId={qa.id} />
                  )
                )}
              </div>
            )
          })}

          {isPreparingAnswer && (
            <div className="loading">Preparing answer{dots}</div>
          )}
        </div>

        {/* Scroll-down button */}
        {showScrollDown && (
          <button
            className="scroll-down-button"
            onClick={scrollToBottom}
            aria-label="Scroll to input"
          >
            <ChevronDown />
          </button>
        )}

        <form onSubmit={handleSubmit}>
          <div className="chat-card">
            <div className="chat-content">
              <input
                ref={inputRef}
                className="chat-input"
                type="text"
                placeholder="How can we help you with Redpanda today?"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={isGeneratingAnswer || isPreparingAnswer}
                />
            </div>

            <div className="chat-footer">
              {/* Toggle between Send and Stop */}
            {isPreparingAnswer || isGeneratingAnswer ? (
              <button
                type="button"
                onClick={handleStop}
                className="submit-button flex items-center gap-1"
              >
                <CircleStop className="h-5 w-5" />
                <span className="button-text">Stop</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={isGeneratingAnswer}
                className="submit-button"
              >
                <ArrowUp className="button-icon" />
                <span className="button-text">Submit</span>
              </button>
            )}
            </div>
          </div>
        </form>
      </div>
    </ErrorBoundary>
  )
}
