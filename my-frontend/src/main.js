// src/main.js
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'

// ✅ Tailwind (v3) global styles
import './assets/tailwind.css'

// ✅ Font Awesome (Vue 3)
import { library } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'

// Pick any icons you need here
import { faCar, faUtensils, faHome, faUser, faBell } from '@fortawesome/free-solid-svg-icons'
import { faFacebook, faYoutube } from '@fortawesome/free-brands-svg-icons'

// Add icons to the library
library.add(faCar, faUtensils, faHome, faUser, faBell, faFacebook, faYoutube)

// ✅ Pinia / auth store
import { useAuth } from '@/store/auth'

const app = createApp(App)
const pinia = createPinia()

// 1) Pinia first
app.use(pinia)

// 2) Restore auth before router
const auth = useAuth()
auth.restore()

// 3) Router
app.use(router)

// 4) Register Font Awesome globally
app.component('font-awesome-icon', FontAwesomeIcon)

// 5) Mount app
app.mount('#app')
