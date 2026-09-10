/**
 * The page's Kapa source-group scope, and the one-way switch that drops it.
 *
 * WHY THIS EXISTS
 * ---------------
 * chat-panel.hbs emits window.KAPA_SOURCE_GROUP_IDS per page so retrieval is
 * scoped to the docs version the reader is on (DOC-1807, DOC-2450). The group
 * ids come from a mapping generated from the Kapa dashboard and shipped through
 * three repos. Kapa has no write API, so a group that is deleted or recreated in
 * the dashboard leaves every deployed page carrying a stale id until the mapping
 * is regenerated and released.
 *
 * Measured live: Kapa does NOT quietly ignore a stale id. The Chat SDK's query
 * endpoint answers HTTP 400 {"source_group_ids_include":["Invalid pk ... object
 * does not exist."]} and the Agent SDK throws "Agent request failed: 400 ..."
 * with that body. Left alone, every question on the affected pages fails until
 * the release lands. So when either SDK reports a rejection, the scope is
 * dropped for the rest of this page view: the providers stop sending the group,
 * the agent prompt stops claiming a version restriction, and the failed
 * question is asked again unscoped. Unscoped is the pre-DOC-2450 behaviour --
 * worse answers, never missing ones.
 *
 * Plain module state rather than React state, because the Chat SDK api service
 * (persistentApiService.js) and the agent event handler (AskAI.jsx) are not
 * components. React learns about the drop through SCOPE_DROPPED_EVENT.
 */

export const SCOPE_DROPPED_EVENT = 'kapa:source-group-dropped'

/**
 * The Chat SDK's onError string for a dropped scope. ChatSdkInterface shows
 * this one verbatim instead of its generic "browser check" text, and retries.
 */
export const SCOPE_DROPPED_MESSAGE =
  'The docs-version filter for this page was rejected, so it has been turned off. Asking again across all versions.'

/**
 * Group ids the page asked for, cleaned. Empty means "send no filter".
 *
 * @returns {string[]}
 */
export function readScopeIds () {
  if (typeof window === 'undefined') return []
  const ids = window.KAPA_SOURCE_GROUP_IDS
  return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && id) : []
}

/**
 * Whether an error message names the source-group filter as the cause.
 *
 * The Agent SDK surfaces Kapa's response body in the thrown message, so this is
 * exact for that tier: `Agent request failed: 400 {"source_group_ids_include":
 * ["Invalid pk \"...\" - object does not exist."]}`.
 *
 * @param {*} message
 * @returns {boolean}
 */
export function isScopeRejection (message) {
  return typeof message === 'string' && /source_group_ids_include|invalid pk/i.test(message)
}

/**
 * The Chat SDK hides the response body: every status other than a captcha 403
 * or a 429 becomes this one sentence. So for that tier the signal is weaker:
 * a scope WAS sent, nothing streamed back, and the failure is the generic one.
 * A 5xx would match too; the cost of that false positive is one unscoped
 * retry and unscoped answers for the rest of the page view.
 */
export const CHAT_SDK_GENERIC_ERROR = /^Something went wrong\b/i

/**
 * @param {*} message - The Chat SDK's onError argument
 * @param {boolean} sentScope - Whether sourceGroupIDsInclude was on the request
 * @param {boolean} streamed - Whether any token or stream start arrived
 * @returns {boolean}
 */
export function chatSdkErrorMayBeScopeRejection (message, sentScope, streamed) {
  if (!sentScope || streamed) return false
  return typeof message === 'string' && CHAT_SDK_GENERIC_ERROR.test(message)
}

/**
 * Drop the scope for the rest of this page view.
 *
 * Clears both globals, so sourceGroupProps() sends nothing and
 * currentPageContext() stops telling the agent its results are restricted, then
 * announces the change so App re-renders the providers without the prop.
 *
 * @param {string} reason - Logged, never shown to the reader
 * @returns {boolean} True when a scope was actually in force and is now gone
 */
export function dropScope (reason) {
  if (typeof window === 'undefined') return false
  const had = readScopeIds().length > 0
  window.KAPA_SOURCE_GROUP_IDS = []
  window.KAPA_SOURCE_GROUP_SEGMENT = ''
  if (!had) return false
  // Loud on purpose: this is the signal that the committed mapping in
  // docs-extensions-and-macros no longer matches the Kapa dashboard.
  console.warn('[Ask AI] Kapa rejected the version source group for this page; searching all versions instead.', reason)
  try {
    window.dispatchEvent(new window.CustomEvent(SCOPE_DROPPED_EVENT, { detail: { reason } }))
  } catch (e) {
    // CustomEvent missing (very old browser): the globals are cleared, so the
    // next full render still sends nothing.
  }
  return true
}

/**
 * Turn a Kapa rejection of the version source group into a dropped scope.
 *
 * The Chat SDK does the fetch itself and, for a 400, reports only "Something
 * went wrong..." with no status or body. Measured live, that is exactly what a
 * stale source_group_ids_include produces (HTTP 400, "Invalid pk ... object
 * does not exist"), and it would otherwise fail every question on the page until
 * the regenerated mapping ships. So when a scope was sent and the exchange died
 * before a single byte streamed, the scope is dropped for this page view and
 * the interface is told, via SCOPE_DROPPED_MESSAGE, to ask again unscoped.
 *
 * Not retried here: the captcha token in `args` is single-use, so a second
 * submitQuery with the same token is a guaranteed 403. The retry has to come
 * from the UI, which obtains a fresh token (see ChatSdkInterface).
 *
 * @param {Object} args - The query arguments about to be sent
 * @param {Object} callbacks - The SDK's stream callbacks
 * @returns {Object} callbacks with onError, onStreamStart and onFirstToken wrapped
 */
export function wrapScopeFallback (args, callbacks) {
  const sentScope = Array.isArray(args.sourceGroupIDsInclude) && args.sourceGroupIDsInclude.length > 0
  if (!sentScope) return callbacks
  let streamed = false
  const call = (name, ...a) => { if (typeof callbacks[name] === 'function') return callbacks[name](...a) }
  return {
    ...callbacks,
    onStreamStart: (...a) => { streamed = true; return call('onStreamStart', ...a) },
    onFirstToken: (...a) => { streamed = true; return call('onFirstToken', ...a) },
    onError: (message) => {
      if (chatSdkErrorMayBeScopeRejection(message, sentScope, streamed) && dropScope(`Chat SDK: ${message}`)) {
        return call('onError', SCOPE_DROPPED_MESSAGE)
      }
      return call('onError', message)
    },
  }
}
