/**
 * Persistent API Service Wrapper
 *
 * Wraps the default Kapa API service to (a) inject the saved threadId so a
 * conversation survives page navigation, and (b) enforce the anonymous question
 * quota before anything reaches Kapa.
 *
 * Why the quota check lives HERE rather than in the drawer: every way to ask a
 * question funnels through submitQuery, the composer, the suggestion chips and
 * cards, the retry button, window.submitChatQuery (code-block and playground
 * "Ask AI" triggers). Gating in the component would leave each of those to
 * remember the check, and the next entry point someone adds would bypass it.
 */

import { DefaultKapaApiService, processStream } from '@kapaai/react-sdk'
import { getSavedThreadId } from './chatPersistence'
import { consumeQuota } from './anonQuota.js'

// Surfaced through the SDK's onError. The drawer replaces it with the sign-in
// wall (ChatSdkInterface watches the same quota event), so this string is the
// fallback for anywhere the wall isn't rendered, never the primary message.
const QUOTA_MESSAGE = 'You have used your free questions. Sign in to keep asking.'

/**
 * Creates a persistent API service that injects saved threadId into queries
 * This enables conversation continuity across page navigation
 */
export class PersistentKapaApiService {
  constructor () {
    this.defaultService = new DefaultKapaApiService(processStream)
    // Monotonic submission counter, so a Stop pressed while the quota check is
    // still in flight can be honoured (see submitQuery / abortCurrent).
    this.submission = 0
    this.abortedSubmission = 0
  }

  /**
   * Submit a query, injecting saved threadId if available
   * @param {Object} args - Query arguments
   * @param {Object} callbacks - Stream callbacks
   */
  async submitQuery (args, callbacks) {
    const mine = ++this.submission

    // Consume one question. Fails open (see anonQuota.js): a missing or broken
    // endpoint returns allowed, so the docs AI never goes dark because the
    // counter is unavailable.
    const verdict = await consumeQuota()
    if (!verdict.allowed) {
      if (typeof callbacks?.onError === 'function') callbacks.onError(QUOTA_MESSAGE)
      return
    }

    // The user hit Stop during the quota round trip. The default service had no
    // request to abort yet, so without this check the answer would start
    // streaming AFTER they stopped it. The SDK has already reset its own state
    // (STOP_GENERATION), so returning quietly is the right shape.
    if (this.abortedSubmission >= mine) return

    const savedThreadId = getSavedThreadId()

    // Inject saved threadId if no threadId is provided
    const enhancedArgs = {
      ...args,
      threadId: args.threadId || savedThreadId,
    }

    return this.defaultService.submitQuery(enhancedArgs, callbacks)
  }

  /**
   * Forward feedback to default service
   */
  addFeedback (args) {
    return this.defaultService.addFeedback(args)
  }

  /**
   * Forward abort to default service, and remember it for any submission whose
   * quota check hasn't resolved yet (see submitQuery).
   */
  abortCurrent () {
    this.abortedSubmission = this.submission
    return this.defaultService.abortCurrent()
  }
}

/**
 * Create a singleton instance of the persistent API service
 */
export function createPersistentApiService () {
  return new PersistentKapaApiService()
}
