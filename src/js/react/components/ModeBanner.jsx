import React, { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { MODES, endChatMode, startChatMode, modeTranscript, agentHandoff } from '../chatModes.js'

// Copy `text`, then say so in the banner for a few seconds.
function useCopy () {
  const [status, setStatus] = useState('')
  useEffect(() => {
    if (!status) return undefined
    const t = setTimeout(() => setStatus(''), 4000)
    return () => clearTimeout(t)
  }, [status])
  const copy = (text, done) => {
    const clip = navigator.clipboard
    const failed = () => setStatus('Could not copy. Select the text and copy it yourself.')
    if (!clip || typeof clip.writeText !== 'function') return failed()
    try {
      clip.writeText(text).then(() => setStatus(done), failed)
    } catch {
      failed()
    }
  }
  return [status, copy]
}

// ——— ModeBanner ——————————————————————————————————————————————————————————
// Shown above the conversation while a chat mode runs, so the reader always
// knows the drawer is not plain Ask AI and has a way back.
//
// View step closes the drawer and keeps the mode, so a reader on a phone can
// read the step and reopen the drawer from the header to answer. A mode's
// note (productionize: what not to paste) sits under the title. Restart is a
// new nonce: a fresh thread with the same opener. `onRestart` runs first so
// the outgoing interface can report how far the reader got.
//
// A mode with copyPlan (productionize) adds, once there is an answer, Copy plan
// (every answer so far, as Markdown) and Hand this plan to your coding agent:
// the card's coding agent prompt (detail.agentPrompt, from
// 33-solution-productionize.js) with the plan under "## Plan so far".
// `messages` is the conversation; `onCopy` reports a copy for analytics.
export function ModeBanner ({ mode, detail, onRestart, messages, onCopy }) {
  const def = MODES[mode]
  const [copyStatus, copy] = useCopy()
  if (!def || !detail) return null
  const plan = def.copyPlan ? modeTranscript(messages, def.controls) : ''

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
        {plan && (
          <button
            type="button"
            className="chat-mode-banner-action"
            onClick={() => { copy(plan, 'Copied the plan.'); if (onCopy) onCopy('plan', plan.length) }}
          >
            Copy plan
          </button>
        )}
        {plan && detail.agentPrompt && (
          <button
            type="button"
            className="chat-mode-banner-action"
            onClick={() => {
              const text = agentHandoff(detail.agentPrompt, plan)
              copy(text, 'Copied. Paste it into your coding agent.')
              if (onCopy) onCopy('handoff', text.length)
            }}
          >
            Hand this plan to your coding agent
          </button>
        )}
        <button type="button" className="chat-mode-banner-action" onClick={() => endChatMode('back_to_ask')}>
          Back to Ask AI
        </button>
      </div>
      {def.copyPlan && (
        <p className="chat-mode-banner-status" role="status" aria-live="polite">{copyStatus}</p>
      )}
    </div>
  )
}

// ——— QuizSummary —————————————————————————————————————————————————————————
// Under the last answer of a finished quiz (QUIZ_RESULT): the score and what
// to do next. Mark step complete goes through the page's progress API
// (window.docsSolutions, 28-solution-progress.js), so it is the same mark as
// the button under the step. Next step is the step page's own next link
// (detail.nextUrl). Retry is Restart: a new quiz on a fresh thread.
export function QuizSummary ({ detail, result, onRestart }) {
  const progress = typeof window !== 'undefined' ? window.docsSolutions : null
  const canMark = !!(progress && typeof progress.markComplete === 'function' && detail && detail.solution && detail.step)
  const doneNow = () => {
    try {
      const record = progress.getRecord(detail.solution)
      return !!(record && record.steps && record.steps[detail.step] && record.steps[detail.step].done)
    } catch {
      return false
    }
  }
  const [done, setDone] = useState(() => canMark && doneNow())
  if (!detail || !result) return null

  const mark = () => {
    if (!canMark) return
    progress.markComplete(detail.solution, detail.step, detail.version)
    setDone(true)
  }
  const retry = () => {
    if (onRestart) onRestart()
    startChatMode(detail)
  }

  return (
    <div className="chat-quiz-summary" role="region" aria-label="Quiz result">
      <p className="chat-quiz-summary-title">
        Quiz complete: {result.score} of {result.total} correct.
      </p>
      <div className="chat-quiz-summary-actions">
        {canMark && (
          <button type="button" className="chat-quiz-summary-action is-primary" onClick={mark} disabled={done}>
            {done ? 'Step complete' : 'Mark step complete'}
          </button>
        )}
        {detail.nextUrl && (
          <a className="chat-quiz-summary-action" href={detail.nextUrl}>
            Next step{detail.nextTitle ? `: ${detail.nextTitle}` : ''}
          </a>
        )}
        <button type="button" className="chat-quiz-summary-action" onClick={retry}>
          Retry
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
  const returnTo = window.location.pathname + window.location.search + (def.returnHash || '')
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
