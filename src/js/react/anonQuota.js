/* global sessionStorage, fetch, AbortController, CustomEvent, document */
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
 *   - ChatSdkInterface, presentation. Peeks via schedulePeek() below, so the
 *     drawer can show what's left and pre-render the wall before anyone types.
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

// Request ordering. The peek doubles as the database's cold-start warmer, so it
// can take seconds, and a reader who types fast can have their first consume
// answered before it. Every verdict carries the sequence number
// of the request that produced it, and an older request never overwrites a
// newer one's verdict, otherwise the stale peek would put the composer back
// for a question the next consume rejects.
let sequence = 0
let published = 0

// What a caller gets when we couldn't reach a verdict. `degraded` tells the UI
// to say nothing about counts it can't trust rather than render "3 left".
const openVerdict = () => ({ allowed: true, degraded: true, remaining: null, limit: null, used: null, resetAt: null, loginUrl: null })

function markAbsent () {
  try { sessionStorage.setItem(ABSENT_KEY, '1') } catch (err) { /* private browsing */ }
}

function isAbsent () {
  try { return sessionStorage.getItem(ABSENT_KEY) === '1' } catch (err) { return false }
}

// Every verdict is published, the fail-open ones included: a visitor who was
// walled and whose next check times out must get the composer back, because
// the api service would let that question through. Publishing keeps the UI and
// the gate telling the same story.
function announce (verdict, seq) {
  if (seq < published) return verdict
  published = seq
  snapshot = verdict
  window.__DOCS_ANON_QUOTA = verdict
  window.dispatchEvent(new CustomEvent(QUOTA_EVENT, { detail: verdict }))
  return verdict
}

async function ask (peek) {
  const seq = ++sequence
  if (isAbsent()) return announce(openVerdict(), seq)

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
    return announce(openVerdict(), seq)
  } finally {
    clearTimeout(timer)
  }

  // The function isn't deployed here. Stop asking for the rest of the session.
  if (res.status === 404 || res.status === 405) {
    markAbsent()
    return announce(openVerdict(), seq)
  }

  const data = await res.json().catch(() => null)
  if (!data) return announce(openVerdict(), seq)

  // Signed in: no counting at all, and no wall to render.
  if (data.unlimited) return announce({ allowed: true, unlimited: true, degraded: false, remaining: null, limit: null, used: null, resetAt: null, loginUrl: null }, seq)

  // Endpoint-level abuse control, not the product wall (no login_url). Allow:
  // this isn't the signal we gate the UI on, and someone tripping the flood
  // guard is not someone we want to invite to sign in.
  if (data.error === 'rate_limited') return announce(openVerdict(), seq)

  // The backend only ever degrades to "allowed" (lib/anon-quota.mjs), but the
  // gate must never refuse on a verdict the UI treats as unknown, so pin it.
  const degraded = data.degraded === true
  return announce({
    allowed: degraded || data.allowed !== false,
    degraded,
    limit: data.limit ?? null,
    used: data.used ?? null,
    remaining: data.remaining ?? null,
    resetAt: data.reset_at ?? null,
    loginUrl: data.login_url ?? null,
  }, seq)
}

/** Read the current state without spending a question. */
export const peekQuota = () => ask(true)

/** Spend one question. Returns the verdict; `allowed: false` means don't ask Kapa. */
export const consumeQuota = () => ask(false)

// Dispatched by the drawer scripts (19-chat-panel.js, and the inline logic in
// partials/chat-panel-bump.hbs) when a reader DELIBERATELY opens the panel, and
// deliberately not on their page-load restore path.
export const DRAWER_OPEN_EVENT = 'docs-chat:open'

// Which element AskAI.jsx mounted into. It stamps data-mounted on the one it
// chose, so this reads the real decision rather than re-deriving it:
// #kapa-chat-root is the docs home page's inline Ask AI, on screen with no
// interaction at all. Anything else is the drawer, hidden until opened.
function mountedInline () {
  const home = document.getElementById('kapa-chat-root')
  return Boolean(home && home.dataset.mounted === 'true')
}

/**
 * Start the peek when it is worth starting. Returns a teardown.
 *
 * The peek is one function invocation and one database read, so WHERE it fires
 * decides whether this endpoint's traffic tracks Ask AI users or pageviews.
 * The drawer's root markup ships in body.hbs on every page and AskAI.bundle.js
 * is a plain defer script, so the React tree mounts on every pageview: peeking
 * from that mount meant a request per pageview from every anonymous visitor,
 * before any of them had shown the slightest interest in asking a question.
 *
 * Three things went wrong with that. It kept the backend's scale-to-zero
 * database permanently resumed instead of warming it just in time, which is
 * the opposite of what the warm-up is for. It scaled with page count rather
 * than with people. And it spent the endpoint's per-IP flood budget (300 per
 * 600s, sized in docs-site lib/oauth/ratelimit.mjs for "a peek per drawer open
 * plus a check per question") on navigation, so a large shared NAT could
 * exhaust it by browsing; the consume in front of a real question then answers
 * rate_limited, which fails open, and metering silently stops for everyone
 * behind that address.
 *
 * So: on the home page's inline chat, where the composer is on screen
 * immediately, peek on mount. In the drawer, wait for a deliberate open. The
 * page-load restore path does not qualify, which is the same line 19-chat-panel
 * already draws for the /auth/warm pre-warm, for the same reason.
 *
 * Either way this stays ahead of the reader: opening the drawer or landing on
 * the home page both precede typing, so the countdown and the wall are in
 * place before there is a question to spend, and the database is warm before
 * the consume that gates it.
 */
export function schedulePeek () {
  const fire = () => { peekQuota().catch(() => {}) /* fails open inside */ }

  if (mountedInline()) {
    fire()
    return () => {}
  }

  // Once per pageview: a second open learns nothing the first didn't, and
  // every later verdict arrives from the consume in front of each question.
  let fired = false
  const onOpen = () => {
    if (fired) return
    fired = true
    window.removeEventListener(DRAWER_OPEN_EVENT, onOpen)
    fire()
  }
  window.addEventListener(DRAWER_OPEN_EVENT, onOpen)
  return () => window.removeEventListener(DRAWER_OPEN_EVENT, onOpen)
}

/**
 * Whether a verdict means this visitor is out of questions, i.e. the wall
 * should replace the composer.
 *
 * Two shapes say so. A refused consume (`allowed: false`) is the obvious one.
 * The other is the LAST permitted question: the backend answers it with
 * `allowed: true, remaining: 0` so Kapa can still answer, and without this the
 * composer would stay live under "0 free questions left" until the next
 * submission was refused into an empty bubble. `settled` is false while an
 * answer is still streaming, so the wall waits for it (and its Stop control)
 * to finish.
 *
 * Never true on a degraded or unlimited verdict: no wall on a guess.
 */
export function quotaExhausted (verdict, settled = true) {
  if (!verdict || verdict.degraded || verdict.unlimited) return false
  if (verdict.allowed === false) return true
  return settled && Number.isFinite(verdict.remaining) && verdict.remaining <= 0
}
