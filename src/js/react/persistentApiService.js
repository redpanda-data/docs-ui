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

// Race winner when Stop lands while a submission is still waiting on its quota
// check. A sentinel rather than null/undefined so it can never collide with a
// verdict shape.
const STOPPED = Symbol('stopped')

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
    // Stop resolvers for submissions currently awaiting consumeQuota, keyed by
    // submission number, so abortCurrent can settle them without waiting for
    // the round trip (see submitQuery).
    this.pendingStops = new Map()
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
    //
    // Raced against Stop, because this promise settling is what releases the
    // SDK. consumeQuota's AbortController is internal to anonQuota.js, so
    // awaiting it plainly leaves a stopped submission pending for up to its 4s
    // timeout, and the SDK's own `finally` (which clears isGenerating with no
    // request-id guard) then fires against whatever submission is in flight by
    // then: Stop, "Try again", and #1's late finally re-enables the composer
    // and swaps out Stop mid-stream, reports "No answer came back" under a live
    // question, or drops the wall over #2 if that was the last permitted one.
    //
    // The consume itself is deliberately NOT cancelled. The server has already
    // been asked by the time Stop can arrive, so the question is spent either
    // way (the design note in the PR covers that); letting it finish means its
    // real verdict still reaches the countdown, where aborting the fetch would
    // publish a degraded one and tell the reader they have a question they do
    // not.
    let stop
    const stopped = new Promise((resolve) => { stop = resolve })
    this.pendingStops.set(mine, stop)
    let verdict
    try {
      verdict = await Promise.race([consumeQuota(), stopped])
    } finally {
      this.pendingStops.delete(mine)
    }

    // Stopped during the quota round trip: the default service had no request
    // to abort yet, so without this the answer would start streaming AFTER the
    // reader stopped it. The SDK has already reset its own state
    // (STOP_GENERATION), so returning quietly is the right shape. Checked
    // before the verdict, so a stop followed by a refusal shows no error for a
    // question the reader had already abandoned.
    if (verdict === STOPPED || this.abortedSubmission >= mine) return

    if (!verdict.allowed) {
      if (typeof callbacks?.onError === 'function') callbacks.onError(QUOTA_MESSAGE)
      return
    }

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
   * Forward abort to default service, and settle any submission whose quota
   * check hasn't resolved yet (see submitQuery).
   */
  abortCurrent () {
    this.abortedSubmission = this.submission
    // Settle now rather than at the end of the round trip. Every waiter
    // re-checks abortedSubmission anyway, so resolving all of them is safe.
    for (const stop of this.pendingStops.values()) stop(STOPPED)
    this.pendingStops.clear()
    return this.defaultService.abortCurrent()
  }
}

/**
 * Create a singleton instance of the persistent API service
 */
export function createPersistentApiService () {
  return new PersistentKapaApiService()
}
