<!-- src/layouts/DriverLayout.vue -->
<script setup>
import { ref, reactive, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/store/auth'

const router = useRouter()
const route  = useRoute()
const auth   = useAuth()

const drawer   = ref(true)
const rail     = ref(false)
const appTitle = 'Driver'

/** Single section: Transportation */
const sections = [
  {
    key: 'transport',
    header: 'Transportation',
    icon: 'mdi-car-side',
    children: [
      { label: 'Car Bookings', icon: 'mdi-clipboard-text-outline', to: { name: 'driver-car-booking' } },
      { label: 'Calendar',     icon: 'mdi-calendar-month-outline', to: { name: 'driver-carlendar' } },
    ],
  },
]

/** Open state (default open if current route inside) */
const open = reactive(
  Object.fromEntries(
    sections.map(s => [
      s.key,
      s.children.some(c => c.to?.name === route.name) || true, // default true
    ])
  )
)

/** Helpers */
const initials = computed(() =>
  (auth.user?.name || auth.user?.loginId || 'D').slice(0, 2).toUpperCase()
)
function go(it){ if (it?.to) router.push(it.to) }
function isActive(it){ return route.name === it?.to?.name }
function logout() {
  auth.logout()
  localStorage.clear()
  router.push({ name: 'greeting' })
}
</script>

<template>
  <div class="driver-theme">
    <v-app>
      <!-- TOP BAR -->
      <v-app-bar density="comfortable" class="topbar" flat>
        <v-btn icon class="mr-2 text-on-brand" @click="drawer = !drawer">
          <v-icon icon="mdi-menu" size="22" />
        </v-btn>

        <v-spacer />

        <v-chip v-if="auth.user" class="mr-2 user-chip" label>
          <v-avatar size="24" class="chip-avatar mr-1">
            <span class="chip-initials">{{ initials }}</span>
          </v-avatar>
          <span class="chip-text">{{ auth.user.name || auth.user.loginId }}</span>
          <span class="chip-role">(DRIVER)</span>
        </v-chip>

        <v-btn size="small" class="logout mr-4" variant="flat" @click="logout">
          <v-icon icon="mdi-logout" size="18" class="mr-2" />
          Logout
        </v-btn>
      </v-app-bar>

      <!-- DRAWER -->
      <v-navigation-drawer
        v-model="drawer"
        :rail="rail"
        width="300"
        class="drawer"
        elevation="1"
        :permanent="$vuetify.display.mdAndUp"
        expand-on-hover
      >
        <div class="drawer-head">
          <div class="brand">
            <v-icon icon="mdi-steering" size="22" class="mr-2" />
            Driver
          </div>
          <v-btn icon variant="text" class="rail-toggle" @click="rail = !rail">
            <v-icon :icon="rail ? 'mdi-arrow-expand-right' : 'mdi-arrow-collapse-left'" />
          </v-btn>
        </div>

        <v-divider class="divider" />

        <v-list nav density="comfortable" class="list">
          <template v-for="s in sections" :key="s.key">
            <!-- Section header toggles open/close -->
            <div class="section-header" @click="open[s.key] = !open[s.key]">
              <div class="left">
                <v-icon :icon="s.icon" size="20" class="nav-icon mr-2" />
                <span>{{ s.header }}</span>
              </div>
              <v-icon
                size="18"
                class="caret"
                :icon="open[s.key] ? 'mdi-chevron-up' : 'mdi-chevron-down'"
              />
            </div>

            <v-expand-transition>
              <div v-show="open[s.key]">
                <v-list-item
                  v-for="it in s.children"
                  :key="it.label"
                  :active="isActive(it)"
                  rounded="lg"
                  class="nav-item"
                  @click="go(it)"
                >
                  <template #prepend>
                    <v-icon :icon="it.icon" size="20" class="nav-icon" />
                  </template>

                  <v-list-item-title>{{ it.label }}</v-list-item-title>

                  <template #append>
                    <v-icon icon="mdi-chevron-right" size="18" class="caret" />
                  </template>
                </v-list-item>
              </div>
            </v-expand-transition>

            <v-divider class="divider thin" />
          </template>
        </v-list>
      </v-navigation-drawer>

      <!-- MAIN -->
      <v-main class="main">
        <v-container fluid class="content">
          <router-view />
        </v-container>
      </v-main>
    </v-app>
  </div>
</template>

<style scoped>
.driver-theme {
  --brand:   #1f2a44;
  --accent:  #2ea3a5;
  --surface: #f5f7fb;
  --text:    #0f172a;
  --muted:   #64748b;
  --on-brand:#ffffff;
}

/* Top bar */
.topbar {
  background: var(--brand);
  color: var(--on-brand);
  border-bottom: 1px solid rgba(255,255,255,.08);
}
.text-on-brand { color: var(--on-brand) !important; }

/* User chip */
.user-chip {
  background: rgba(255,255,255,.08);
  border: 1px solid rgba(255,255,255,.14);
  color: var(--on-brand);
}
.chip-avatar {
  background: var(--on-brand);
  color: var(--brand);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.chip-initials { font-weight: 800; }
.chip-text { color: var(--on-brand); }
.chip-role { color: rgba(255,255,255,.8); margin-left: .25rem; }

/* Logout button */
.logout {
  background: var(--accent);
  color: #fff !important;
  font-weight: 700;
  border-radius: 8px;
}

/* Drawer */
.drawer {
  background: #ffffff;
  color: var(--text);
  border-right: 1px solid #e6e8ee;
}
.drawer-head {
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding: 12px 10px;
}
.brand {
  font-weight: 900;
  color: var(--brand);
  display:flex;
  align-items:center;
}
.rail-toggle { color: var(--brand) !important; }

.divider { border-color: #e6e8ee !important; }
.divider.thin { opacity: .7; }

/* Section header (toggle) */
.section-header {
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding: 8px 12px;
  margin: 6px 8px 2px;
  color: var(--brand);
  font-weight: 800;
  border-radius: 10px;
  user-select: none;
  cursor: pointer;
}
.section-header:hover { background: #f3f5fa; }
.section-header .left { display:flex; align-items:center; }

/* Items */
.nav-item {
  margin: 4px 8px;
  color: var(--text);
  background: #fff;
  border: 1px solid #e9ecf3;
}
.nav-item.v-list-item--active {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(46,163,165,.12) inset;
}
.nav-icon { width: 1.4em; }
.caret { color: var(--muted); }

/* Main */
.main { background: var(--surface); }
.content { padding: 16px 12px; }

.mr-2 { margin-right: .5rem; }
.mr-4 { margin-right: 1rem; }
</style>
