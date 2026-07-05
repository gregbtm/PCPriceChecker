import './main.css'
import Alpine from 'alpinejs'
import { app } from './app.js'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import SettingsTab from './components/SettingsTab.jsx'

Alpine.data('app', app)
window.Alpine = Alpine
Alpine.start()

// Mount React Settings tab into its placeholder div
const settingsRoot = document.getElementById('settings-react-root')
if (settingsRoot) {
  createRoot(settingsRoot).render(createElement(SettingsTab))
}

// Register the service worker in production only — it caches hashed asset
// filenames from a specific build, which would fight Vite's dev server/HMR.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
  })
}
