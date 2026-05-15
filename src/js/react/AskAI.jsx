import React from 'react'
import { createRoot } from 'react-dom/client'
import { KapaProvider } from '@kapaai/react-sdk'
import ChatInterface from './components/ChatInterface.jsx'
import { saveConversation } from './chatPersistence.js'
import { createPersistentApiService } from './persistentApiService.js'

const safeHeap = (eventName, eventParams) => {
  if (typeof window.heap === 'object' && typeof window.heap.track === 'function') {
    window.heap.track(eventName, eventParams);
  }
};

// Create singleton API service instance for conversation persistence
const persistentApiService = createPersistentApiService()

function App() {
  const integrationId = window.UI_INTEGRATION_ID

  return (
    <>
      <KapaProvider
        integrationId={integrationId}
        apiService={persistentApiService}
        callbacks={{
          askAI: {
            onQuerySubmit: (data) => {
              safeHeap("ask_question_docs_home", {
                question: data.question,
                thread_id: data.threadId,
              });
            },
            onAnswerGenerationCompleted: (data) => {
              // Save conversation state for cross-page persistence
              // Save after answer is complete so we have the full exchange
              if (data.threadId && data.conversation) {
                saveConversation(data.threadId, data.conversation)
              }
              safeHeap("answer_generated_docs_home", {
                question_id: data.questionAnswerId,
                answer_length: data.answer.length,
              });
            },
            onFeedbackSubmit: (data) => {
              safeHeap("feedback_submitted_docs_home", {
                question_id: data.questionAnswerId,
                reaction: data.reaction,
              });
            },
          },
        }}
      >
        <ChatInterface />
      </KapaProvider>
    </>
  )
}

document.addEventListener('DOMContentLoaded', () => {
  // Mount to home page chat root
  const homeEl = document.getElementById('kapa-chat-root')
  if (homeEl) {
    createRoot(homeEl).render(<App />)
  }

  // Mount to chat panel root (for article pages)
  const panelEl = document.getElementById('chat-panel-kapa-root')
  if (panelEl) {
    createRoot(panelEl).render(<App />)
  }
})
