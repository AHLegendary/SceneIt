import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { startBlends } from './features/blends/blends.js'
import { startFriends } from './lib/friends.js'
import { startAuth } from './lib/supabaseStore.js'

// Follow login state (restores a saved session on page load), and load the
// signed-in user's friends and blends whenever it changes.
startAuth()
startFriends()
startBlends()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)