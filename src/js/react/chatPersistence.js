/* globals localStorage */
/**
 * Chat Persistence Module
 * Saves and restores conversation state to localStorage for cross-page continuity
 */

const STORAGE_KEY = 'redpanda-chat-thread'
const EXPIRY_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Save conversation state to localStorage
 * @param {string} threadId - The Kapa thread ID
 * @param {Array} conversation - Array of {id, question, answer} objects
 */
export function saveConversation (threadId, conversation) {
  if (!threadId || !conversation) return

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      threadId,
      conversation: conversation.map((qa) => ({
        id: qa.id || qa.questionAnswerId,
        question: qa.question,
        answer: qa.answer,
      })),
      timestamp: Date.now(),
    }))
  } catch (err) {
    console.warn('Failed to save chat conversation:', err)
  }
}

/**
 * Load saved conversation from localStorage
 * @returns {Object|null} - {threadId, conversation, timestamp} or null if not found/expired
 */
export function loadConversation () {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (!data) return null

    const parsed = JSON.parse(data)

    // Check expiry
    if (Date.now() - parsed.timestamp > EXPIRY_MS) {
      clearConversation()
      return null
    }

    return parsed
  } catch (err) {
    console.warn('Failed to load chat conversation:', err)
    return null
  }
}

/**
 * Clear saved conversation from localStorage
 */
export function clearConversation () {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (err) {
    console.warn('Failed to clear chat conversation:', err)
  }
}

/**
 * Get saved thread ID if available and not expired
 * @returns {string|null} - The saved thread ID or null
 */
export function getSavedThreadId () {
  const data = loadConversation()
  return data?.threadId || null
}
