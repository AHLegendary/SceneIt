import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { startFriends } from './lib/friends.js'
import { startAuth } from './lib/supabaseStore.js'

// Follow login state (restores a saved session on page load), and load the
// signed-in user's friends whenever it changes.
startAuth()
startFriends()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)