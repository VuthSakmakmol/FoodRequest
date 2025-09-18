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


const vuetify = createVuetify({ components, directives })
const pinia = createPinia()

createApp(App)
  .use(pinia)   // ✅ Pinia first
  .use(router)  // ✅ Router after Pinia
  .use(vuetify)
  .mount('#app')
