// src/main.js
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'

import 'vuetify/styles'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import '@fortawesome/fontawesome-free/css/all.css'

import { useAuth } from '@/store/auth'   // ⬅️ import the auth store

const vuetify = createVuetify({ components, directives })
const pinia = createPinia()

const app = createApp(App)

// 1) Pinia first
app.use(pinia)

// 2) Restore auth from localStorage BEFORE using router
const auth = useAuth()
auth.restore()   // ⬅️ loads token + user + subscribes socket

// 3) Then router + vuetify + mount
app.use(router)
app.use(vuetify)
app.mount('#app')
