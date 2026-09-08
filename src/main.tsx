import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './ui/App'
import { LocalStorageAdapter } from './storage/LocalStorageAdapter'
import { createStepSource } from './steps/createStepSource'

const storage = new LocalStorageAdapter()
const source = createStepSource()

const root = document.getElementById('root')
if (!root) throw new Error('Trailbound: #root is missing from index.html')

createRoot(root).render(
  <StrictMode>
    <App storage={storage} source={source} />
  </StrictMode>,
)

// Offline support, so the game still opens on a walk with no signal.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(() => {
        /* offline support is a bonus, never a requirement */
      })
  })
}
