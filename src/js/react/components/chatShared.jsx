import React, { useEffect, useRef } from 'react'
import { Check, AlertCircle } from 'lucide-react'
import DOMPurify from 'dompurify'
import { Marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
// highlight.js core plus a curated language set. The bare 'highlight.js'
// import pulled in all 185 grammars (~880 KB minified), most of which no docs
// answer will ever contain. highlightAuto only considers registered languages,
// so keep this list to what Redpanda answers actually quote. Add a grammar here
// when a new one shows up unhighlighted in the drawer.
import hljs from 'highlight.js/lib/highlight'
import bash from 'highlight.js/lib/languages/bash'
import shell from 'highlight.js/lib/languages/shell'
import yaml from 'highlight.js/lib/languages/yaml'
import json from 'highlight.js/lib/languages/json'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import go from 'highlight.js/lib/languages/go'
import python from 'highlight.js/lib/languages/python'
import java from 'highlight.js/lib/languages/java'
import sql from 'highlight.js/lib/languages/sql'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import properties from 'highlight.js/lib/languages/properties'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import ini from 'highlight.js/lib/languages/ini'
import plaintext from 'highlight.js/lib/languages/plaintext'
import rust from 'highlight.js/lib/languages/rust'
import csharp from 'highlight.js/lib/languages/cs'
import kotlin from 'highlight.js/lib/languages/kotlin'
import scala from 'highlight.js/lib/languages/scala'
import ruby from 'highlight.js/lib/languages/ruby'
import php from 'highlight.js/lib/languages/php'
import protobuf from 'highlight.js/lib/languages/protobuf'
import diff from 'highlight.js/lib/languages/diff'
import makefile from 'highlight.js/lib/languages/makefile'
import nginx from 'highlight.js/lib/languages/nginx'
import http from 'highlight.js/lib/languages/http'
import markdown from 'highlight.js/lib/languages/markdown'
import powershell from 'highlight.js/lib/languages/powershell'

const LANGUAGES = {
  bash, shell, yaml, json, javascript, typescript, go, python, java, sql, xml, css,
  properties, dockerfile, ini, plaintext, rust, csharp, kotlin, scala, ruby, php,
  protobuf, diff, makefile, nginx, http, markdown, powershell,
}
Object.keys(LANGUAGES).forEach((name) => hljs.registerLanguage(name, LANGUAGES[name]))

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
    // Announced to assistive tech: the toast is the sole feedback for chat
    // actions/failures. Errors are assertive (interrupt), success is polite.
    <div role={isError ? 'alert' : 'status'} aria-live={isError ? 'assertive' : 'polite'} className={`chat-toast ${isError ? 'chat-toast-error' : 'chat-toast-success'}`}>
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
