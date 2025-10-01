// src/plugins/vuetify.ts (or vuetify.js)

// Core Vuetify
import 'vuetify/styles'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

// Labs component(s)
import { VTimePicker } from 'vuetify/labs/VTimePicker'

// Font Awesome (Vuetify icon set + CSS)
import { aliases, fa } from 'vuetify/iconsets/fa'
import '@fortawesome/fontawesome-free/css/all.css'

export default createVuetify({
  components: {
    ...components,
    VTimePicker, // register labs component here
  },
  directives,

  // 🔧 Font Awesome as the icon set
  icons: {
    defaultSet: 'fa',
    aliases,
    sets: { fa },
  },
})
