<!-- src/layouts/AdminLayout.vue -->
<script setup>
import { ref, reactive, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/store/auth'

const router = useRouter()
const route  = useRoute()
const auth   = useAuth()

const drawer   = ref(true)
const rail     = ref(false)
const appTitle = 'Admin'

/** Sections (collapsible, no duplicate rows) */
const sections = [
  {
    key: 'food',
    header: 'Food Request',
    icon: 'fa-solid fa-utensils',
    children: [
      { label: 'Requests', icon: 'fa-solid fa-list-check', to: { name: 'admin-requests' } },
      { label: 'Calendar', icon: 'fa-solid fa-calendar-days', to: { name: 'admin-food-calendar' } },
      
    ],
  },
  {
    key: 'transport',
    header: 'Transportation',
    icon: 'fa-solid fa-car-side',
    children: [
      { label: 'Car Booking', icon: 'fa-solid fa-calendar-check', to: { name: 'admin-car-booking' } },
      { label: 'Calendar', icon: 'fa-solid far-calendar-day', to: { name: 'admin-car-calendar' } },
    ],
  },
  // Uncomment if you bring dashboard back
  // {
  //   key: 'overview',
  //   header: 'Overview',
  //   icon: 'fa-solid fa-chart-line',
  //   children: [
  //     { label: 'Dashboard', icon: 'fa-solid fa-gauge-high', to: { name: 'admin-dashboard' } },
  //   ],
  // },
]

/** Open state (open a section if current route is inside it) */
const open = reactive(Object.fromEntries(
  sections.map(s => [s.key, s.children.some(c => c.to?.name === route.name)])
))

/** Helpers */
const initials = computed(() =>
  (auth.user?.name || auth.user?.loginId || 'U').slice(0, 2).toUpperCase()
)
function go(it){ if (it?.to) router.push(it.to) }
function isActive(it){ return route.name === it?.to?.name }
function logout(){
  auth.logout()
  router.push({ name: 'employee-request' }) // Admin logs out to Admin Login
}
</script>

<template>
  <div class="admin-theme">
    <v-app>
      <!-- TOP BAR -->
      <v-app-bar density="comfortable" class="topbar" flat>
        <v-btn icon class="mr-2 text-on-brand" @click="drawer = !drawer">
          <i class="fa-solid fa-bars" />
        </v-btn>
        <v-app-bar-title class="text-on-brand title">{{ appTitle }}</v-app-bar-title>
        <v-spacer />
        <v-chip v-if="auth.user" class="mr-2 user-chip" label>
          <v-avatar size="24" class="chip-avatar mr-1">
            <span class="chip-initials">{{ initials }}</span>
          </v-avatar>
          <span class="chip-text">{{ auth.user.name || auth.user.loginId }}</span>
          <span class="chip-role">({{ auth.user.role }})</span>
        </v-chip>
        <v-btn size="small" class="logout" variant="flat" @click="logout">
          <i class="fa-solid fa-right-from-bracket mr-2"></i>Logout
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
            <i class="fa-solid fa-shield-halved mr-2"></i> Admin
          </div>
          <v-btn icon variant="text" class="rail-toggle" @click="rail = !rail">
            <v-icon>{{ rail ? 'mdi-arrow-expand-right' : 'mdi-arrow-collapse-left' }}</v-icon>
          </v-btn>
        </div>

        <v-divider class="divider" />

        <v-list nav density="comfortable" class="list">
          <template v-for="s in sections" :key="s.key">
            <!-- Section header toggles open/close -->
            <div class="section-header" @click="open[s.key] = !open[s.key]">
              <div class="left">
                <i :class="s.icon" class="fa-fw mr-2" />
                <span>{{ s.header }}</span>
              </div>
              <i class="fa-solid" :class="open[s.key] ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
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
                  <template #prepend><i :class="it.icon" class="fa-fw" /></template>
                  <v-list-item-title>{{ it.label }}</v-list-item-title>
                  <template #append></template>
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
/* ========= Professional 2–3 color palette =========
   Reuses the same tones as Employee for visual consistency */
.admin-theme {
  --brand:   #1f2a44; /* deep navy */
  --accent:  #2ea3a5; /* teal accent */
  --surface: #f5f7fb; /* light surface */
  --text:    #0f172a; /* slate-900 */
  --muted:   #64748b; /* slate-600 */
  --on-brand:#ffffff;
}

/* Top bar */
.topbar {
  background: var(--brand);
  color: var(--on-brand);
  border-bottom: 1px solid rgba(255,255,255,.08);
}
.text-on-brand { color: var(--on-brand) !important; }
.title { font-weight: 800; }

/* User chip */
.user-chip {
  background: rgba(255,255,255,.08);
  border: 1px solid rgba(255,255,255,.14);
  color: var(--on-brand);
}
.chip-avatar {
  background: var(--on-brand);
  color: var(--brand);
  display: inline-flex; align-items: center; justify-content: center;
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
  display:flex; align-items:center; justify-content:space-between;
  padding: 12px 10px;
}
.brand { font-weight: 900; color: var(--brand); display:flex; align-items:center; }
.rail-toggle { color: var(--brand) !important; }

.divider { border-color: #e6e8ee !important; }
.divider.thin { opacity: .7; }

/* Section header (toggle) */
.section-header {
  display:flex; align-items:center; justify-content:space-between;
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
.fa-fw { width: 1.25em; text-align: center; }
.caret { color: var(--muted); }

/* Main */
.main { background: var(--surface); }
.content { padding: 16px 12px; }

.mr-2 { margin-right: .5rem; }
</style>
