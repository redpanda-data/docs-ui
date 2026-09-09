/* global sessionStorage, fetch, AbortController, CustomEvent */
/**
 * Anonymous Ask AI quota client.
 *
 * The anonymous tier gets a small number of questions per window; running out
 * is what surfaces the sign-in wall. The count is held server-side by
 * docs-site netlify/functions/kapa-quota.mjs, deliberately not in
 * localStorage, which "clear site data" or an incognito window resets for free.
 *
 * Two callers:
 *   - persistentApiService.submitQuery, the gate. Consumes one question and
 *     refuses to call Kapa when the answer is no. Every path into the drawer
 *     (composer, suggestion chips, retry, window.submitChatQuery, code-block
 *     "Ask AI") goes through the api service, so this is the one place that
 *     cannot be bypassed by adding another entry point.
 *   - ChatSdkInterface, presentation. Peeks on mount so the drawer can show
 *     what's left and pre-render the wall before anyone types.
 *
 * FAILS OPEN, everywhere. If the endpoint is missing, slow, or broken, people
 * get to ask their question. The backend takes the same direction for the same
 * reason (see lib/anon-quota.mjs): this gates a documentation feature, so the
 * safe default is "let people read the docs".
 */

export const QUOTA_EVENT = 'docs-quota'

// Set when the endpoint answers 404/405, i.e. this docs-ui build is running
// against a site that doesn't have the quota function (a docs-ui preview, an
// older deploy, local gulp against production). Without it every question pays
// a doomed round trip before Kapa is called. Kept in sessionStorage, matching
// the kapa-session-unavailable marker in AskAI.jsx.
const ABSENT_KEY = 'docs-quota-absent'

// Short: this sits in front of every question, so a hung endpoint must not add
// a visible pause before the answer starts streaming.
const TIMEOUT_MS = 4000

const endpoint = () => window.KAPA_QUOTA_ENDPOINT || '/kapa/quota'

// Last known state, mirrored on window for late-mounting consumers (same
// pattern as window.__KAPA_AUTHENTICATED).
let snapshot = null
export const getQuota = () => snapshot

// What a caller gets when we couldn't reach a verdict. `degraded` tells the UI
// to say nothing about counts it can't trust rather than render "3 left".
const openVerdict = () => ({ allowed: true, degraded: true, remaining: null, limit: null, used: null, resetAt: null, loginUrl: null })

function markAbsent () {
  try { sessionStorage.setItem(ABSENT_KEY, '1') } catch (err) { /* private browsing */ }
}

function isAbsent () {
  try { return sessionStorage.getItem(ABSENT_KEY) === '1' } catch (err) { return false }
}

function announce (verdict) {
  snapshot = verdict
  window.__DOCS_ANON_QUOTA = verdict
  window.dispatchEvent(new CustomEvent(QUOTA_EVENT, { detail: verdict }))
  return verdict
}

async function ask (peek) {
  if (isAbsent()) return openVerdict()

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let res
  try {
    res = await fetch(endpoint(), {
      method: 'POST',
      credentials: 'include', // the visitor-id cookie is the primary bucket key
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peek }),
      signal: ctrl.signal,
    })
  } catch (err) {
    // Network error or our own timeout: allow, and don't cache the failure,
    // a blip shouldn't disable the quota for the rest of the browser session.
    return openVerdict()
  } finally {
    clearTimeout(timer)
  }

  // The function isn't deployed here. Stop asking for the rest of the session.
  if (res.status === 404 || res.status === 405) {
    markAbsent()
    return openVerdict()
  }

  const data = await res.json().catch(() => null)
  if (!data) return openVerdict()

  // Signed in: no counting at all, and no wall to render.
  if (data.unlimited) return announce({ allowed: true, unlimited: true, degraded: false, remaining: null, limit: null, used: null, resetAt: null, loginUrl: null })

  // Endpoint-level abuse control, not the product wall (no login_url). Allow:
  // this isn't the signal we gate the UI on, and someone tripping the flood
  // guard is not someone we want to invite to sign in.
  if (data.error === 'rate_limited') return openVerdict()

  return announce({
    allowed: data.allowed !== false,
    degraded: data.degraded === true,
    limit: data.limit ?? null,
    used: data.used ?? null,
    remaining: data.remaining ?? null,
    resetAt: data.reset_at ?? null,
    loginUrl: data.login_url ?? null,
  })
}

/** Read the current state without spending a question. */
export const peekQuota = () => ask(true)

/** Spend one question. Returns the verdict; `allowed: false` means don't ask Kapa. */
export const consumeQuota = () => ask(false)

/**
 * True when the LAST known state says this visitor is out of questions.
 * Synchronous, for the pre-submit check in the drawer, the authoritative
 * decision is always the consumeQuota call inside the api service.
 */
export function isExhausted () {
  return Boolean(snapshot) && snapshot.allowed === false && !snapshot.degraded
}
