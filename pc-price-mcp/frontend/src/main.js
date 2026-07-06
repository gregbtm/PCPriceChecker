import './main.css'
import Alpine from 'alpinejs'
import { app } from './app.js'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import SettingsTab from './components/SettingsTab.jsx'
import BuildsTab from './components/BuildsTab.jsx'
import PartsTab from './components/PartsTab.jsx'
import SearchTab from './components/SearchTab.jsx'

Alpine.data('app', app)
window.Alpine = Alpine
Alpine.start()

// Mount each migrated tab's React root into its Alpine-owned placeholder div.
function mountReactTab(rootId, Component) {
  const el = document.getElementById(rootId)
  if (el) createRoot(el).render(createElement(Component))
}
mountReactTab('settings-react-root', SettingsTab)
mountReactTab('builds-react-root', BuildsTab)
mountReactTab('parts-react-root', PartsTab)
mountReactTab('search-react-root', SearchTab)

// Register the service worker in production only — it caches hashed asset
// filenames from a specific build, which would fight Vite's dev server/HMR.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
  })
}
