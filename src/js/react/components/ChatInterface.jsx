import React, { useState, useEffect, useRef, Component } from 'react'
import { useAgentChat, AgentThreadHistory, ToolCallCard, ToolCallGroup } from '@kapaai/agent-react'
import {
  ArrowRight,
  ArrowDown,
  RefreshCcw,
  ClipboardCopy,
  CircleStop,
  History,
  Check,
  AlertCircle,
  Sparkles,
  X,
} from 'lucide-react'
import DOMPurify from 'dompurify'
import { Marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js'
import { safeHeap } from '../heap.js'
import { agentTools } from '../agentTools.js'

// Resumed threads come back without displayName on tool calls (the SDK only
// backfills icon/render), so map names to friendly labels ourselves
const TOOL_DISPLAY_NAMES = Object.fromEntries(
  agentTools.map((t) => [t.name, t.displayName])
)

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

// ——— Sources ————————————————————————————————————————————————————————————
// Assistant messages carry sources inside tool-call blocks; collect and
// dedupe them by URL for a compact link list under the answer.
function extractSources(blocks) {
  const seen = new Set()
  const sources = []
  for (const block of blocks || []) {
    if (block.type !== 'tool_calls') continue
    for (const call of block.toolCalls || []) {
      for (const source of call.sources || []) {
        if (!source?.sourceUrl || seen.has(source.sourceUrl)) continue
        // Only render web URLs — React doesn't block javascript: hrefs
        if (!/^https?:\/\//i.test(source.sourceUrl)) continue
        seen.add(source.sourceUrl)
        sources.push(source)
      }
    }
  }
  return sources
}

// Kapa titles can arrive pipe-joined ("Page title|Page title") or empty
function baseTitle(source) {
  const title = (source.title || '').split('|').map((p) => p.trim()).filter(Boolean)[0]
  if (title) return title
  try {
    const segs = new URL(source.sourceUrl).pathname.split('/').filter(Boolean)
    const last = segs[segs.length - 1] || ''
    return humanize(last) || source.sourceUrl
  } catch {
    return source.sourceUrl
  }
}

function humanize(slug) {
  return decodeURIComponent(slug).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim()
}

// Friendly names for the docs product/section path segments
const PRODUCT_LABELS = {
  'redpanda-cloud': 'Cloud',
  'cloud-data-platform': 'Cloud',
  'self-managed': 'Self-Managed',
  'data-platform': 'Data Platform',
  streaming: 'Streaming',
  connect: 'Connect',
  'redpanda-connect': 'Connect',
}

// A short qualifier to disambiguate same-titled sources: the section (for
// same-page anchors) or the product/version (for the same page across versions).
function sourceQualifier(url) {
  try {
    const u = new URL(url)
    if (u.hash && u.hash.length > 1) return humanize(u.hash.slice(1))
    const segs = u.pathname.split('/').filter(Boolean)
    const version = segs.find((s) => /^\d+\.\d+$/.test(s) || s === 'current')
    const product = PRODUCT_LABELS[segs[0]]
    const ver = version === 'current' ? 'latest' : version
    if (product && ver) return `${product} ${ver}`
    return ver || product || ''
  } catch {
    return ''
  }
}

function AnswerSources({ blocks }) {
  const sources = extractSources(blocks)
  if (sources.length === 0) return null
  // Only qualify titles that repeat, so unique sources stay clean
  const titles = sources.map(baseTitle)
  const counts = titles.reduce((acc, t) => ({ ...acc, [t]: (acc[t] || 0) + 1 }), {})
  return (
    <div className="answer-sources">
      <span className="answer-sources-label">Sources</span>
      <ul>
        {sources.map((s, i) => {
          const title = titles[i]
          const qualifier = counts[title] > 1 ? sourceQualifier(s.sourceUrl) : ''
          return (
            <li key={s.sourceUrl}>
              <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer">
                {title}{qualifier ? ` (${qualifier})` : ''}
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// Grow the input with its content, capped by the CSS max-height
function autosizeTextarea(el) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
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
 * Renders the main chat interface, providing a conversational UI with markdown-rendered answers, copy/reset actions, animated loading states, and responsive suggestion chips.
 *
 * Manages user input, conversation state, and UI responsiveness for both desktop and mobile. Handles dynamic textarea resizing, scroll-to-bottom behavior, and conditional display of header/footer elements based on user interaction. Integrates with the chat backend via the `useAgentChat` hook to submit queries, stop or reset conversations, and display AI-generated suggestions. Signed-in users (detected via the `kapa-session` event from AskAI.jsx) also get a conversation-history view backed by the Kapa Agent SDK.
 */
export default function ChatInterface() {
  const [message, setMessage]               = useState('')
  const [dots, setDots]                     = useState('')
  const [showScrollDown, setShowScrollDown] = useState(false)
  const [suggestions, setSuggestions]       = useState([])
  const [hasInteracted, setHasInteracted]   = useState(false)
  const [toast, setToast]                   = useState(null)
  // null = session state unknown (probe in flight), false = anonymous, true = signed in
  const [authenticated, setAuthenticated]   = useState(() =>
    window.__KAPA_AUTHENTICATED === undefined ? null : Boolean(window.__KAPA_AUTHENTICATED)
  )
  // Where "Sign in" goes — supplied by the session endpoint once docs login exists
  const [loginUrl, setLoginUrl]             = useState(() => window.__KAPA_LOGIN_URL || null)
  const [showHistory, setShowHistory]       = useState(false)
  const textareaRef = useRef(null)
  const conversationAreaRef = useRef(null)

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

  // The session endpoint reports whether the visitor is signed in; the flag
  // gates the whole agent UI (AskAI.jsx broadcasts it after every token fetch).
  useEffect(() => {
    const handleSession = (e) => {
      setAuthenticated(Boolean(e.detail?.authenticated))
      setLoginUrl(e.detail?.loginUrl || null)
    }
    window.addEventListener('kapa-session', handleSession)
    return () => window.removeEventListener('kapa-session', handleSession)
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
    messages,
    threadId,
    isStreaming,
    sendMessage,
    stopGeneration,
    resetConversation,
    approveToolCall,
    rejectToolCall,
    historyDisabled,
  } = useAgentChat()

  // Expose the live thread ID so the feedback tool can reference the
  // conversation without pasting its contents into the form
  useEffect(() => {
    window.__KAPA_THREAD_ID = threadId
    return () => {
      delete window.__KAPA_THREAD_ID
    }
  }, [threadId])

  // A resumed or in-flight conversation should show the conversation view
  useEffect(() => {
    if (messages.length > 0 && !hasInteracted) setHasInteracted(true)
  }, [messages.length, hasInteracted])

  const lastMessage = messages[messages.length - 1]
  // Waiting for the first assistant tokens of the current turn
  const isPreparing = isStreaming && (!lastMessage || lastMessage.role === 'user')

  // Show/hide "scroll down" button
  useEffect(() => {
    if (!hasInteracted || isPreparing) return
    const THRESHOLD = 300

    // In the panel the conversation area scrolls; on the home page the window does
    const chatScroll = conversationAreaRef.current
    const isInPanel = Boolean(document.getElementById('chat-panel-kapa-root')) && chatScroll

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
  }, [hasInteracted, isPreparing, isStreaming])

  const scrollToBottom = () => {
    // In the panel the conversation area scrolls; on the home page the window does
    const chatScroll = conversationAreaRef.current
    if (chatScroll && document.getElementById('chat-panel-kapa-root')) {
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
    if (isPreparing) {
      timer = setInterval(() => {
        setDots((d) => (d.length < 3 ? d + '.' : ''))
      }, 500)
    } else {
      setDots('')
    }
    return () => clearInterval(timer)
  }, [isPreparing])

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

  // Hand anonymous visitors to the stock Kapa widget (chat-SDK tier)
  const openQuickAsk = () => {
    if (typeof window.loadKapa !== 'function') {
      showToast('Quick ask is unavailable on this page', 'error')
      return
    }
    document.querySelector('[data-chat-action="close"]')?.click()
    window.loadKapa(true)
  }

  const doQuery = (q) => {
    if (authenticated !== true) return
    if (!q.trim()) return
    if (!hasInteracted) setHasInteracted(true)
    setShowHistory(false)
    safeHeap('ask_question_docs_home', {
      question: q,
      thread_id: threadId,
    })
    sendMessage(q).catch((err) => {
      console.error('Chat error:', err)
      showToast('Chat is temporarily unavailable. Try again shortly.', 'error')
    })
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
  }, [sendMessage, hasInteracted, threadId, authenticated])

  const handleSubmit = (e) => {
    e.preventDefault()
    doQuery(message)
    resetTextareaHeight()
  }

  const handleReset = () => {
    resetConversation()
    setMessage('')
    setHasInteracted(false)
    setShowScrollDown(false)
    setShowHistory(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setDropdownOpen(false)
    resetTextareaHeight()
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(
        messages
          .map((m) => `${m.role === 'user' ? 'Question' : 'Answer'}: ${m.content}`)
          .join('\n---\n')
      )
    } catch {
      throw new Error('Clipboard API not available')
    }
  }

  const handleThreadSelected = () => {
    setShowHistory(false)
    setHasInteracted(true)
  }

  const showHistoryButton = authenticated && !historyDisabled

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

        {/* Conversation history (signed-in users only) */}
        {showHistoryButton && (
          <div className="chat-history-toggle-row">
            <button
              type="button"
              className="action-button chat-history-toggle"
              onClick={() => setShowHistory((open) => !open)}
              aria-label={showHistory ? 'Close conversation history' : 'Show conversation history'}
            >
              {showHistory ? <X /> : <History />}
              {showHistory ? 'Close' : 'History'}
            </button>
          </div>
        )}
        {showHistory && (
          <div className="chat-history-view">
            <AgentThreadHistory onThreadSelected={handleThreadSelected} />
          </div>
        )}

        {/* Sign-in prompt — the agent tier is for signed-in users; quick
            questions go to the stock Kapa widget instead */}
        {authenticated === false && (
          <div className="signin-screen">
            <div className="welcome-icon">
              <Sparkles size={28} />
            </div>
            <h2 className="welcome-title">Sign in to Redpanda docs</h2>
            <p className="welcome-description">
              Free with your Redpanda Cloud account. Unlock the AI agent that can:
            </p>
            <ul className="signin-features">
              <li>Save and revisit your conversations across devices</li>
              <li>Search the docs and open the right page for you</li>
              <li>Write and verify Bloblang mappings before you run them</li>
              <li>Send feedback straight to the docs team</li>
            </ul>
            {loginUrl ? (
              <>
                <a
                  className="signin-button"
                  href={`${loginUrl}${loginUrl.includes('?') ? '&' : '?'}return_to=${encodeURIComponent(window.location.pathname + window.location.search)}`}
                >
                  Sign in
                </a>
                <button type="button" className="signin-quick-ask" onClick={openQuickAsk}>
                  Or ask a quick question without signing in
                </button>
              </>
            ) : (
              <>
                <p className="signin-coming-soon">
                  Docs sign-in is coming soon. Until then:
                </p>
                <button type="button" className="signin-button" onClick={openQuickAsk}>
                  Ask a quick question
                </button>
              </>
            )}
          </div>
        )}

        {/* Welcome screen - shown before interaction */}
        {authenticated === true && !hasInteracted && !showHistory && (
          <div className="welcome-screen">
            <div className="welcome-icon">
              <Sparkles size={28} />
            </div>
            <h2 className="welcome-title">How can I help?</h2>
            <p className="welcome-description">
              I can answer questions about Redpanda docs, write quickstarts, and help you troubleshoot.
            </p>
            {suggestions.length > 0 && (
              <div className="suggestion-cards">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    className="suggestion-card"
                    onClick={() => doQuery(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div
          ref={conversationAreaRef}
          className="conversation-area"
          style={authenticated === true && hasInteracted && !showHistory ? undefined : { display: 'none' }}
        >
          <div className="conversation">
            {messages.map((m, idx) => {
              const isLast = idx === messages.length - 1
              if (m.role === 'user') {
                return (
                  <div key={idx} className="qa-pair">
                    <hr className="section-divider" />
                    <div className="question">{m.content}</div>
                  </div>
                )
              }
              const toolCallBlocks = (m.blocks || []).filter((b) => b.type === 'tool_calls')
              return (
                <div key={idx} className={`qa-pair ${m.isError ? 'qa-pair-error' : ''}`}>
                  {toolCallBlocks.map((block, bi) => (
                    <div key={bi} className="tool-calls">
                      <ToolCallGroup>
                        {block.toolCalls.map((tc) => (
                          <ToolCallCard
                            key={tc.id}
                            toolCall={{ ...tc, displayName: tc.displayName || TOOL_DISPLAY_NAMES[tc.name] }}
                            onApprove={approveToolCall}
                            onReject={rejectToolCall}
                          />
                        ))}
                      </ToolCallGroup>
                    </div>
                  ))}
                  <Answer md={m.content} />
                  <AnswerSources blocks={m.blocks} />
                  {isLast && !isStreaming && (
                    <div className="actions-feedback flex justify-between items-center">
                      <ActionButtons
                        onReset={handleReset}
                        onCopy={handleCopy}
                        showToast={showToast}
                      />
                    </div>
                  )}
                </div>
              )
            })}
            {isPreparing && (
              <div className="loading">
                {`Preparing answer${dots}`}
              </div>
            )}
          </div>
        </div>

        <div
          className={`chat-footer-wrapper ${hasInteracted ? 'fixed-bottom' : ''}`}
          style={authenticated === true ? undefined : { display: 'none' }}
        >
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

          <form onSubmit={handleSubmit} className="chat-input-form">
            <div className="chat-input-wrapper">
              <label htmlFor="chat-message" className="visually-hidden">
                Ask a question about Redpanda
              </label>
              <textarea
                ref={textareaRef}
                id="chat-message"
                name="chat-message"
                className="chat-input"
                autoComplete="off"
                rows={1}
                placeholder="Ask anything about Redpanda docs..."
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value)
                  autosizeTextarea(e.target)
                }}
                onKeyDown={(e) => {
                  // Enter submits; Shift+Enter inserts a newline
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSubmit(e)
                  }
                }}
                disabled={isStreaming}
              />
              {isStreaming ? (
                <button
                  type="button"
                  onClick={stopGeneration}
                  className="submit-button stop-button"
                  aria-label="Stop"
                >
                  <CircleStop size={18} />
                </button>
              ) : (
                <button
                  type="submit"
                  className="submit-button"
                  aria-label="Submit"
                  disabled={!message.trim()}
                >
                  <ArrowRight size={18} />
                </button>
              )}
            </div>
          </form>

          <div className="disclaimer">
            <p>
              <a
                href="https://www.redpanda.com/legal/privacy-policy"
                target="_blank"
                rel="noopener"
              >
                Privacy policy
              </a>
              {' · '}
              Powered by <a href="https://kapa.ai" target="_blank" rel="noopener noreferrer">kapa.ai</a>
            </p>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  )
}
