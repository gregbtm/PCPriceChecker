import './main.css'
import Alpine from 'alpinejs'
import { app } from './app.js'

Alpine.data('app', app)

window.Alpine = Alpine
Alpine.start()
