import React, { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { KapaProvider } from '@kapaai/react-sdk'
import ChatInterface from './ChatInterface.jsx'

function App() {
  const integrationId = window.UI_INTEGRATION_ID

  return (
    <>
    <h2>Ask anything about Redpanda</h2>
      <KapaProvider
        integrationId={integrationId}
        callbacks={{
          askAI: {
            onQuerySubmit: ({ question }) =>
              console.log('Question asked:', question)
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
