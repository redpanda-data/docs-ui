import React from 'react'
import { createRoot } from 'react-dom/client'
import { KapaProvider } from '@kapaai/react-sdk'
import ChatInterface from './ChatInterface.jsx'

function App() {
  const integrationId = window.UI_INTEGRATION_ID

  return (
    <>
    <h1>Ask anything about Redpanda</h1>
    <div className='paragraph'>
      <p>For best results, include the name of the product you're interested in as well as the version. For example, "In Redpanda Cloud, how do I connect to my cluster?"</p>
      <p>Responses are generated using AI and may contain mistakes.</p>
    </div>
    <div className='paragraph'>
      <p>Review the <a href="https://www.redpanda.com/legal/privacy-policy" target="_blank" rel="noopener">Redpanda privacy policy</a> to understand how your data is used.</p>
    </div>
    <hr className="section-divider" />
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
