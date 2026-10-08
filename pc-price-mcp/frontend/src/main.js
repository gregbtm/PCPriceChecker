import './main.css'
import Alpine from 'alpinejs'
import { app } from './app.js'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import SettingsTab from './components/SettingsTab.jsx'

// A 401 from any API call (dashboard or the React Settings tab) opens the sign-in box when an app token is set.
const nativeFetch = window.fetch.bind(window)
window.fetch = async (...args) => {
  const res = await nativeFetch(...args)
  if (res.status === 401) window.dispatchEvent(new CustomEvent('pcpc-unauthorised'))
  return res
}

Alpine.data('app', app)
window.Alpine = Alpine
Alpine.start()

// Mount React Settings tab into its placeholder div
const settingsRoot = document.getElementById('settings-react-root')
if (settingsRoot) {
  createRoot(settingsRoot).render(createElement(SettingsTab))
}
