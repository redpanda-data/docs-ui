/**
 * Persistent API Service Wrapper
 * Wraps the default Kapa API service to inject saved threadId for conversation continuity
 */

import { DefaultKapaApiService, processStream } from '@kapaai/react-sdk'
import { getSavedThreadId } from './chatPersistence'

/**
 * Creates a persistent API service that injects saved threadId into queries
 * This enables conversation continuity across page navigation
 */
export class PersistentKapaApiService {
  constructor () {
    this.defaultService = new DefaultKapaApiService(processStream)
  }

  /**
   * Submit a query, injecting saved threadId if available
   * @param {Object} args - Query arguments
   * @param {Object} callbacks - Stream callbacks
   */
  submitQuery (args, callbacks) {
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
   * Forward abort to default service
   */
  abortCurrent () {
    return this.defaultService.abortCurrent()
  }
}

/**
 * Create a singleton instance of the persistent API service
 */
export function createPersistentApiService () {
  return new PersistentKapaApiService()
}
