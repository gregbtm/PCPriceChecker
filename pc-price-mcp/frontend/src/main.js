import './main.css'
import Alpine from 'alpinejs'
import Chart from 'chart.js/auto'
import { app } from './app.js'

// Expose Chart.js globally — the app() code references `new Chart(...)` directly
window.Chart = Chart

// Expose app as global function so x-data="app()" in the HTML keeps working
window.app = app

// Start Alpine
window.Alpine = Alpine
Alpine.start()
