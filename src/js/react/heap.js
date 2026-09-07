/* globals window */
/**
 * Safe wrapper around Heap analytics — no-ops when Heap isn't loaded
 * (e.g. cookie consent declined or script blocked).
 */
export function safeHeap (eventName, eventParams) {
  if (typeof window.heap === 'object' && typeof window.heap.track === 'function') {
    window.heap.track(eventName, eventParams)
  }
}
