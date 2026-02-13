// src/main.js
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'

// ✅ ONLY ONE global css
import './assets/tailwind.css'

// ✅ Font Awesome (Vue 3)
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'

import { faCar, faUtensils, faHome, faUser, faBell } from '@fortawesome/free-solid-svg-icons'
import { faFacebook, faYoutube } from '@fortawesome/free-brands-svg-icons'

library.add(faCar, faUtensils, faHome, faUser, faBell, faFacebook, faYoutube)

import { useAuth } from '@/store/auth'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)

const auth = useAuth()
auth.restore()

app.use(router)
app.component('font-awesome-icon', FontAwesomeIcon)

app.mount('#app')