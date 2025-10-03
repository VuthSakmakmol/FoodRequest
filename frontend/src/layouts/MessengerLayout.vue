<script setup>
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/store/auth'
const router = useRouter()
const route  = useRoute()
const auth   = useAuth()

const drawer = ref(true)
const appTitle = 'Food Request — Messenger'

const items = [
  { label: 'Home',    icon: 'mdi-motorbike',         to: { name:'messenger-home' } },
  // Add more messenger pages later…
]

const initials = computed(() => (auth.user?.name || auth.user?.loginId || 'U').slice(0,2).toUpperCase())
function go(it){ if(it?.to) router.push(it.to) }
function logout(){ auth.logout(); router.push({ name:'admin-login' }) }
</script>

<template>
  <v-app>
    <v-app-bar density="comfortable" color="primary" dark>
      <v-btn icon class="mr-2" @click="drawer = !drawer"><v-icon>mdi-menu</v-icon></v-btn>
      <v-app-bar-title>{{ appTitle }}</v-app-bar-title>
      <v-spacer />
      <v-chip v-if="auth.user" class="mr-2" label>
        <v-avatar size="24" color="white" class="mr-1"><span class="text-primary text-button">{{ initials }}</span></v-avatar>
        <span class="text-white">{{ auth.user.name || auth.user.loginId }}</span>
        <span class="text-white ml-1 opacity-70">({{ auth.user.role }})</span>
      </v-chip>
      <v-btn size="small" color="white" variant="text" @click="logout">Logout</v-btn>
    </v-app-bar>

    <v-navigation-drawer v-model="drawer" color="surface" elevation="2" :permanent="$vuetify.display.mdAndUp">
      <v-list density="comfortable" nav>
        <v-list-subheader>Messenger</v-list-subheader>
        <v-list-item v-for="it in items" :key="it.label" :to="it.to" :active="route.name === it.to?.name" @click="go(it)" rounded="xl">
          <template #prepend><v-icon>{{ it.icon }}</v-icon></template>
          <v-list-item-title>{{ it.label }}</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-navigation-drawer>

    <v-main class="bg-grey-lighten-4">
      <v-container fluid class="py-3 px-2 px-md-4">
        <router-view />
      </v-container>
    </v-main>
  </v-app>
</template>
