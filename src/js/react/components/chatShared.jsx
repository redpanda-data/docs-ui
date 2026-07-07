import React, { useEffect, useRef } from 'react'
import { Check, AlertCircle } from 'lucide-react'
import DOMPurify from 'dompurify'
import { Marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js'

// Shared markdown renderer + presentational bits used by both the Agent SDK
// drawer (ChatInterface) and the Chat SDK drawer (ChatSdkInterface) so the two
// tiers render identically.

export const marked = new Marked(
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight (code) {
      try {
        return hljs.highlightAuto(code).value
      } catch {
        return code
      }
    },
  })
)

export function Toast ({ message, type = 'success', onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(() => { if (onDismiss) onDismiss() }, 3000)
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

export function Answer ({ md }) {
  const containerRef = useRef(null)
  useEffect(() => {
    try {
      const clean = DOMPurify.sanitize(marked.parse(md || ''))
      if (containerRef.current) containerRef.current.innerHTML = clean
    } catch (err) {
      console.error('Markdown render error:', err)
      if (containerRef.current) containerRef.current.textContent = md
    }
  }, [md])
  return <div ref={containerRef} className="answer" />
}
