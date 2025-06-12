import React from 'react'
import { createRoot } from 'react-dom/client'
import { KapaProvider } from '@kapaai/react-sdk'
import ChatInterface from './components/ChatInterface.jsx'

const safeHeap = (eventName, eventParams) => {
  if (typeof window.heap === 'object' && typeof window.heap.track === 'function') {
    window.heap.track(eventName, eventParams);
  }
};

function App() {
  const integrationId = window.UI_INTEGRATION_ID

  return (
    <>
      <KapaProvider
        integrationId={integrationId}
        callbacks={{
          askAI: {
            onQuerySubmit: (data) => {
              safeHeap("ask_question_docs_home", {
                question: data.question,
                thread_id: data.threadId,
              });
            },
            onAnswerGenerationCompleted: (data) => {
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
  const el = document.getElementById('kapa-chat-root')
  if (!el) return
  createRoot(el).render(<App />)
})
