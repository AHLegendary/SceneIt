import { envProblems } from './lib/missingEnv.js'

// Check env before loading the app: importing the Supabase client with a missing
// URL or key throws, which used to leave a blank page.
const problems = envProblems()
if (problems.length) {
  const root = document.getElementById('root')
  root.style.cssText = 'font-family:system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 16px;color:#e6e9ef'
  const h = document.createElement('h1')
  h.textContent = 'SceneIt can’t start'
  const p = document.createElement('p')
  p.textContent = 'Fix your .env file (see .env.example and the README), then restart the dev server:'
  const ul = document.createElement('ul')
  for (const t of problems) {
    const li = document.createElement('li')
    li.textContent = t
    ul.append(li)
  }
  root.append(h, p, ul)
} else {
  import('./start.jsx')
}
