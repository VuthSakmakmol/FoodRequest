// src/main.js
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'

// Vuetify core
import 'vuetify/styles'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

// ✅ Material Design Icons (for <v-icon icon="mdi-...">)
import '@mdi/font/css/materialdesignicons.css'
import { aliases, mdi } from 'vuetify/iconsets/mdi'

// ❌ You can remove Font Awesome if you don’t want it anymore
// import '@fortawesome/fontawesome-free/css/all.css'

// Pinia / auth
import { useAuth } from '@/store/auth'

const vuetify = createVuetify({
  components,
  directives,
  icons: {
    defaultSet: 'mdi',   // use MDI
    aliases,
    sets: {
      mdi,
    },
  },
})

const pinia = createPinia()
const app = createApp(App)

// 1) Pinia first
app.use(pinia)

// 2) Restore auth before router
const auth = useAuth()
auth.restore()

// 3) Router + Vuetify + mount
app.use(router)
app.use(vuetify)
app.mount('#app')
