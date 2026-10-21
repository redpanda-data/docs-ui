import React from 'react'
import { Sparkles } from 'lucide-react'
import { MODES, endChatMode, startChatMode } from '../chatModes.js'

// ——— ModeBanner ——————————————————————————————————————————————————————————
// Shown above the conversation while a chat mode runs, so the reader always
// knows the drawer is not plain Ask AI and has a way back.
//
// View step closes the drawer and keeps the mode, so a reader on a phone can
// read the step and reopen the drawer from the header to answer. A mode's
// note (productionize: what not to paste) sits under the title. Restart is a
// new nonce: a fresh thread with the same opener. `onRestart` runs first so
// the outgoing interface can report how far the reader got.
export function ModeBanner ({ mode, detail, onRestart }) {
  const def = MODES[mode]
  if (!def || !detail) return null

  const viewStep = (e) => {
    let samePage = false
    try { samePage = new URL(detail.url, window.location.href).pathname === window.location.pathname } catch { /* ignore */ }
    if (!samePage) return
    e.preventDefault()
    window.dispatchEvent(new CustomEvent('docs-chat:close'))
  }

  const restart = () => {
    if (onRestart) onRestart()
    startChatMode(detail)
  }

  return (
    <div className="chat-mode-banner" role="region" aria-label={`${def.label} mode`}>
      <p className="chat-mode-banner-title">
        <span className="chat-mode-banner-label">{def.label}:</span> {detail.title}
      </p>
      {def.note && <p className="chat-mode-banner-note">{def.note}</p>}
      <div className="chat-mode-banner-actions">
        {detail.url && def.viewLabel && (
          <a className="chat-mode-banner-action" href={detail.url} onClick={viewStep}>
            {def.viewLabel}
          </a>
        )}
        {def.restart && (
          <button type="button" className="chat-mode-banner-action" onClick={restart}>
            Restart
          </button>
        )}
        <button type="button" className="chat-mode-banner-action" onClick={() => endChatMode('back_to_ask')}>
          Back to Ask AI
        </button>
      </div>
    </div>
  )
}

// ——— ModeSignIn ——————————————————————————————————————————————————————————
// The anonymous tier's answer to a mode. A mode runs only on the agent tier, so
// a stale sign-in cookie that showed the mode's button lands here instead. It
// never registers submitChatQuery, so the waiting opener is never sent as an
// anonymous question. Ask AI instead ends the mode, which cancels that opener
// before the anonymous drawer mounts.
export function ModeSignIn ({ mode, loginUrl }) {
  const def = MODES[mode]
  if (!def) return null
  const returnTo = window.location.pathname + window.location.search
  // disclosed is left off: this screen shows no privacy note, so /login keeps
  // its interstitial (see docs-site docs-login.mjs).
  const href = loginUrl
    ? `${loginUrl}${loginUrl.includes('?') ? '&' : '?'}return_to=${encodeURIComponent(returnTo)}`
    : null

  const onSignIn = (e) => {
    // Prefer the header's sign-in modal when the page has one.
    if (document.querySelector('[data-signin-modal]') || !href) {
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('docs-account:open-signin', {
        detail: { title: def.signInTitle, returnTo },
      }))
    }
  }

  return (
    <div className="chat-container">
      <div className="signin-screen chat-mode-signin">
        <span className="signin-badge">
          <Sparkles size={14} />
          Free with Redpanda Cloud
        </span>
        <h2 className="welcome-title">{def.signInTitle}</h2>
        <p className="welcome-description">
          This runs on the docs AI agent, so you need to be signed in.
        </p>
        <a className="signin-button" href={href || '#'} onClick={onSignIn}>
          Sign in
        </a>
        <button type="button" className="signin-quick-ask" onClick={() => endChatMode('ask_instead')}>
          Ask AI instead
        </button>
      </div>
    </div>
  )
}
