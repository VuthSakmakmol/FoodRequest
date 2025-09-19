<script setup>
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/store/auth'

const router = useRouter()
const route  = useRoute()
const auth   = useAuth()

const drawer = ref(true)
const rail   = ref(false)
const appTitle = 'Food Request'

// nav items
const employeeItems = [
  { label: 'Request Meal',   icon: 'mdi-silverware-fork-knife', to: { name:'employee-request' } },
  { label: 'My Requests',    icon: 'mdi-history',               to: { name:'employee-requests' } },
]

// 🔹 Added Calendar into admin items
// nav items
const adminItems = [
  { header: 'Admin' },
  { label: 'Dashboard',    icon: 'mdi-view-dashboard',        to: { name:'admin-dashboard' } },
  { label: 'Food Request', icon: 'mdi-view-list-outline',     to: { name:'admin-requests' } },
  { label: 'Food Calendar',icon: 'mdi-calendar-month-outline',to: { name:'admin-food-calendar' } },
]


const canManage = computed(() => ['ADMIN','CHEF'].includes(auth.user?.role))
const initials = computed(() => (auth.user?.name || auth.user?.loginId || 'U').slice(0,2).toUpperCase())

function go(item) {
  if (item?.to) router.push(item.to)
}

function toggleAuth() {
  if (auth.user) {
    auth.logout()
    router.push({ name:'admin-login' })
  } else {
    router.push({ name:'admin-login' })
  }
}
</script>

<template>
  <v-app>
    <!-- TOP BAR -->
    <v-app-bar density="comfortable" color="primary" dark elevation="1">
      <v-btn icon class="mr-2" @click="drawer = !drawer">
        <i class="fas fa-bars" style="color:black; font-size:20px;"></i>
      </v-btn>
      <v-app-bar-title>{{ appTitle }}</v-app-bar-title>
      <v-spacer />

      <v-divider vertical class="mx-2 d-none d-md-flex" />

      <!-- user chip -->
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

      <v-divider></v-divider>

      <!-- Employee section -->
      <v-list density="comfortable" nav>
        <v-list-subheader>Employee</v-list-subheader>
        <v-list-item
          v-for="it in employeeItems"
          :key="it.label"
          :to="it.to"
          :active="route.name === it.to?.name"
          @click="go(it)"
          rounded="xl"
        >
          <template #prepend><v-icon>{{ it.icon }}</v-icon></template>
          <v-list-item-title>{{ it.label }}</v-list-item-title>
        </v-list-item>
      </v-list>

      <!-- Admin/Chef section -->
      <v-list v-if="canManage" density="comfortable" nav class="mt-2">
        <v-divider class="mb-1"></v-divider>

        <template v-for="it in adminItems" :key="it.label || it.header">
          <v-list-subheader v-if="it.header">{{ it.header }}</v-list-subheader>
          <v-list-item
            v-else
            :to="it.to"
            :active="route.name === it.to?.name"
            @click="go(it)"
            rounded="xl"
          >
            <template #prepend><v-icon>{{ it.icon }}</v-icon></template>
            <v-list-item-title>{{ it.label }}</v-list-item-title>
          </v-list-item>
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
.v-main {
  background:
    linear-gradient(180deg, rgba(99,102,241,0.04), rgba(16,185,129,0.03) 60%),
    #f6f7fb;
}
.opacity-70 { opacity: .7; }
</style>
