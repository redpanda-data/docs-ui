/* global sessionStorage, fetch, AbortController, CustomEvent */
/**
 * Kapa session state: which Ask AI tier this visitor gets, and the sign-in URL.
 *
 * This module is bundled twice on purpose. esbuild emits every file under
 * src/js/react as its own IIFE, so kapaSession.bundle.js is a ~4 KB script that
 * chat-panel.hbs defers on every page: it runs the session probe (one cached
 * POST /kapa/session per tab) so the header's Sign in control knows whether the
 * auth backend exists, exactly as before. AskAI.jsx imports the same functions,
 * so the 1 MB React bundle it lives in no longer has to load on every pageview
 * just to run this probe; 19-chat-panel.js fetches that bundle when the drawer
 * is opened (or about to be). installSessionProbe() is idempotent across the
 * two copies via a window flag, so whichever bundle arrives first wins and the
 * second is a no-op.
 *
 * The Bump.sh standalone widget (chat-panel-bump.hbs) keeps loading
 * AskAI.bundle.js directly, which still carries this code, so nothing changes
 * there.
 */
/**
 * Fetches a Kapa Agent SDK session token from the docs backend
 * (netlify/functions/kapa-session.mjs in docs-site). The agent tier is
 * signed-in only: anonymous visitors get 401 auth_required, ChatInterface
 * shows a sign-in prompt, and the Ask AI experience falls back to the stock
 * Kapa widget. Session state is broadcast via the `kapa-session` window event
 * and mirrored on window.__KAPA_AUTHENTICATED / window.__KAPA_USER so
 * components mounting after the broadcast (and the feedback tool) can read it.
 */
// authoritative: true when the session state comes from a definitive backend
// answer (a 200, or a clean 401 that carries — or deliberately omits — a
// login_url). false when we're ASSUMING signed-out after a transient/opaque
// probe failure. Consumers that take destructive action on "signed out" (e.g.
// the header clearing a stale auth hint) must act only on authoritative signals,
// so a network blip can't flip a genuinely-signed-in user to signed-out.
function announceSession (authenticated, user, loginUrl, authoritative = true) {
  window.__KAPA_AUTHENTICATED = authenticated
  window.__KAPA_USER = user || null
  window.__KAPA_LOGIN_URL = loginUrl || null
  window.dispatchEvent(
    new CustomEvent('kapa-session', {
      detail: { authenticated, user: user || null, loginUrl: loginUrl || null, authoritative },
    })
  )
  try {
    // Persist only authoritative states under the main key. A cached transient
    // assumption must not replay as if it were a definitive answer.
    if (authoritative) {
      sessionStorage.setItem(
        'kapa-session-state',
        JSON.stringify({ authenticated, user: user || null, loginUrl: loginUrl || null })
      )
      // The backend answered, so any "unavailable" marker is stale.
      sessionStorage.removeItem(UNAVAILABLE_KEY)
    }
  } catch (err) { /* private browsing */ }
}

// Marker for "the probe failed and we don't know why", kept apart from
// kapa-session-state so it can never be read back as a definitive answer.
// Without it, a backend that isn't deployed yet costs one POST /kapa/session
// per pageview, all 404s. With it, that becomes one per tab per TTL window.
//
// Availability is deliberately learned at runtime rather than baked in at build
// time: kapa-session.mjs treats REDPANDA_OAUTH_CLIENT_ID as the single on/off
// var for sign-in and signals "off" by omitting login_url. Asking the server
// keeps that env var an instant kill switch. A build-time flag would move the
// decision into a playbook key, so disabling sign-in would need a code change
// and a full docs rebuild, and the two could disagree.
//
// The TTL alone is a poor safety net for the day auth ships: nobody holds a
// session yet, so the hasAuthHint bypass covers no one, and a tab that probed
// just before the deploy would hide sign-in until the window elapsed. Shortening
// the TTL doesn't fix that either — pageviews are spread out, so a short window
// re-probes almost every pageview and gives the noise back. Instead the marker
// is dropped on explicit intent (see probeOnIntent), so the affordance appears
// the moment anyone actually reaches for Ask AI while idle navigation stays quiet.
const UNAVAILABLE_KEY = 'kapa-session-unavailable'
const UNAVAILABLE_TTL_MS = 10 * 60 * 1000

async function getSessionToken () {
  const endpoint = window.KAPA_SESSION_ENDPOINT || '/kapa/session'
  // Client-side timeout: a hung connection (LB/proxy accepts TCP but never
  // responds) would otherwise neither resolve nor reject, leaving the drawer
  // stuck on the loading spinner forever. On abort we throw, so probeSession's
  // .catch degrades to the anonymous tier — matching the network-error fallback.
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), Number(window.KAPA_SESSION_TIMEOUT_MS || 8000))
  let res
  try {
    res = await fetch(endpoint, { method: 'POST', credentials: 'include', signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
  if (res.status === 401) {
    const data = await res.json().catch(() => ({}))
    announceSession(false, null, data.login_url)
    throw new Error('Sign in to use the Redpanda AI agent')
  }
  if (!res.ok) {
    throw new Error(`Chat session request failed (${res.status})`)
  }
  const data = await res.json()
  announceSession(Boolean(data.authenticated), data.user, null)
  return { token: data.session_token, expiresAt: Date.parse(data.expires_at) }
}

// The SDK only fetches a session token on the first message, so ChatInterface
// wouldn't know whether to show the agent UI or the sign-in prompt until the
// user typed something. Probe once per browser session (cached) to learn the
// session state early. The cache is revalidated whenever the JS-readable
// rp_docs_auth hint cookie (set/cleared by the docs login flow alongside the
// HttpOnly session cookie) disagrees with it — i.e. right after login/logout.
function probeSession () {
  const hasAuthHint = /(?:^|;\s*)rp_docs_auth=1(?:;|$)/.test(document.cookie)
  let cached = null
  try {
    cached = sessionStorage.getItem('kapa-session-state')
  } catch (err) { /* private browsing */ }
  if (cached !== null) {
    try {
      const { authenticated, user, loginUrl } = JSON.parse(cached)
      if (Boolean(authenticated) === hasAuthHint) {
        announceSession(Boolean(authenticated), user, loginUrl)
        return
      }
      // Login state changed since the cache was written — fall through
    } catch (err) { /* fall through to a fresh probe */ }
  }
  // A recent probe already failed in this tab, so don't ask again on every
  // pageview. Skipped when the auth hint is present: that visitor may hold a
  // real session, and getting them the agent tier is worth one request.
  if (!hasAuthHint) {
    try {
      const failedAt = Number(sessionStorage.getItem(UNAVAILABLE_KEY))
      if (failedAt && Date.now() - failedAt < UNAVAILABLE_TTL_MS) {
        announceSession(false, null, null, false)
        return
      }
    } catch (err) { /* private browsing */ }
  }
  // Establish the tier. getSessionToken announces on a 200 (authenticated) or a
  // clean 401 (signed-out; carries the real login_url, or null when auth is
  // deliberately turned off / "coming soon"). Any OTHER failure — network error,
  // 5xx, abort, or a 404 because this bundle is deployed ahead of the auth
  // backend — lands here having announced nothing (__KAPA_AUTHENTICATED still
  // undefined). Degrade to the anonymous Chat SDK tier and announce NO login URL:
  // we can't distinguish a transient blip from a missing backend from the client,
  // and guessing a default /login would surface a sign-in affordance that 404s
  // wherever the backend isn't deployed. Consumers gate sign-in on a login URL
  // (26-docs-account.js render(), ChatSdkInterface), so it stays hidden until a
  // real 401 supplies one. authoritative:false keeps this from clearing a
  // signed-in user's auth hint. Self-heals on the next probe.
  getSessionToken().catch(() => {
    if (window.__KAPA_AUTHENTICATED === undefined) {
      try {
        sessionStorage.setItem(UNAVAILABLE_KEY, String(Date.now()))
      } catch (err) { /* private browsing */ }
      announceSession(false, null, window.__KAPA_LOGIN_URL || null, false)
    }
  })
}

// Explicit intent beats the cached "unavailable" answer. 19-chat-panel.js fires
// docs-account:warm when a signed-out visitor deliberately opens the drawer (not
// on the restore-on-load path), which is exactly when a stale marker would cost
// something real: the sign-in upsell missing on the day auth ships. Drop the
// marker and ask again. Once per page — a second open learns nothing new.
let intentProbed = false
function probeOnIntent () {
  if (intentProbed) return
  // Nothing to learn: we already have a definitive answer this pageview.
  if (window.__KAPA_AUTHENTICATED === true || window.__KAPA_LOGIN_URL) return
  intentProbed = true
  try {
    sessionStorage.removeItem(UNAVAILABLE_KEY)
  } catch (err) { /* private browsing */ }
  probeSession()
}

// One probe per pageview regardless of how many copies of this module load.
// (Both kapaSession.bundle.js and AskAI.bundle.js contain it; the flag lives on
// window so the copies share it.)
export function installSessionProbe () {
  if (window.__KAPA_SESSION_PROBE_INSTALLED) return
  window.__KAPA_SESSION_PROBE_INSTALLED = true
  probeSession()
  window.addEventListener('docs-account:warm', probeOnIntent)
}

export { announceSession, getSessionToken, probeSession, probeOnIntent }

// Standalone bundle: chat-panel.hbs loads this script on pages that render the
// drawer. Probe as soon as we run — nothing here needs the DOM.
if (typeof window !== 'undefined' && document.querySelector('[data-chat-panel], #kapa-chat-root')) {
  installSessionProbe()
}
