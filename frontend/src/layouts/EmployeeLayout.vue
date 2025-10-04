<!-- src/layouts/EmployeeLayout.vue -->
<script setup>
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/store/auth'

const router = useRouter()
const route  = useRoute()
const auth   = useAuth()

const drawer = ref(true)
const rail   = ref(false)
const appTitle = 'Food Request — Employee'

/* ───────── Menu groups ───────── */
const groups = [
  {
    header: 'Food Request',
    icon: 'fa-solid fa-utensils',
    children: [
      { label: 'Request Meal', icon: 'fa-solid fa-bowl-food', to: { name: 'employee-request' } },
      { label: 'My Requests',  icon: 'fa-solid fa-clock-rotate-left', to: { name: 'employee-request-history' } },
    ]
  },
  {
    header: 'Transportation',
    icon: 'fa-solid fa-car-side',
    children: [
      { label: 'Book a Car',       icon: 'fa-solid fa-taxi', to: { name: 'employee-car-booking' } },
      { label: 'My Car Bookings',  icon: 'fa-solid fa-list', to: { name: 'employee-car-history' } }, // create route/page if not present
    ]
  }
]

/* Helpers */
const initials = computed(() =>
  (auth.user?.name || auth.user?.loginId || 'U').slice(0, 2).toUpperCase()
)

function go(it) {
  if (it?.to) router.push(it.to)
}

/* Expand the group that contains the current route */
function groupOpen(g) {
  return g.children?.some(c => c.to?.name === route.name)
}

/* Active item check */
function isActive(it) {
  return route.name === it.to?.name
}

function toggleAuth() {
  if (auth.user) {
    auth.logout()
    router.push({ name: 'admin-login' })
  } else {
    router.push({ name: 'admin-login' })
  }
}
</script>

<template>
  <v-app>
    <!-- TOP BAR -->
    <v-app-bar density="comfortable" color="primary" dark>
      <v-btn icon class="mr-2" @click="drawer = !drawer">
        <i class="fa-solid fa-bars" />
      </v-btn>
      <v-app-bar-title>{{ appTitle }}</v-app-bar-title>
      <v-spacer />
      <v-chip v-if="auth.user" class="mr-2" label>
        <v-avatar size="24" color="white" class="mr-1">
          <span class="text-primary text-button">{{ initials }}</span>
        </v-avatar>
        <span class="text-white">{{ auth.user.name || auth.user.loginId }}</span>
        <span class="text-white ml-1 opacity-70">({{ auth.user.role }})</span>
      </v-chip>
      <v-btn size="small" color="white" variant="text" @click="toggleAuth">
        {{ auth.user ? 'Logout' : 'Login' }}
      </v-btn>
    </v-app-bar>

    <!-- SIDEBAR -->
    <v-navigation-drawer
      v-model="drawer"
      :rail="rail"
      color="surface"
      elevation="2"
      :permanent="$vuetify.display.mdAndUp"
      expand-on-hover
    >
      <!-- Drawer header -->
      <div class="d-flex align-center justify-space-between px-3 py-2">
        <div class="text-subtitle-1 font-weight-bold">Menu</div>
        <v-btn icon variant="text" @click="rail = !rail">
          <v-icon>{{ rail ? 'mdi-arrow-expand-right' : 'mdi-arrow-collapse-left' }}</v-icon>
        </v-btn>
      </div>

      <v-divider class="mb-2" />

      <!-- Grouped lists -->
      <v-list density="comfortable" nav>
        <template v-for="g in groups" :key="g.header">
          <v-list-subheader>{{ g.header }}</v-list-subheader>

          <v-list-group :value="groupOpen(g)">
            <template #activator="{ props }">
              <v-list-item v-bind="props" rounded="xl">
                <template #prepend>
                  <i :class="g.icon" class="fa-fw" />
                </template>
                <v-list-item-title>{{ g.header }}</v-list-item-title>
              </v-list-item>
            </template>

            <v-list-item
              v-for="it in g.children"
              :key="it.label"
              :to="it.to"
              :active="isActive(it)"
              @click="go(it)"
              rounded="xl"
            >
              <template #prepend>
                <i :class="it.icon" class="fa-fw" />
              </template>
              <v-list-item-title>{{ it.label }}</v-list-item-title>
            </v-list-item>
          </v-list-group>

          <v-divider class="my-2" />
        </template>
      </v-list>
    </v-navigation-drawer>

    <!-- MAIN CONTENT -->
    <v-main class="bg-grey-lighten-4">
      <v-container fluid class="py-3 px-2 px-md-4">
        <router-view />
      </v-container>
    </v-main>
  </v-app>
</template>

<style scoped>
.opacity-70 { opacity: .7; }
.fa-fw { width: 1.25em; text-align: center; } /* fixed-width FA icons for nice alignment */
</style>
