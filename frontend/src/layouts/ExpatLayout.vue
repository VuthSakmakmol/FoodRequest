<script setup>
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/store/auth'

const auth = useAuth()
const router = useRouter()
const route = useRoute()

const userName = computed(() => auth.user?.name || auth.user?.id || 'Expat')

const goHome = () => {
  // main expat home for leave
  if (route.name !== 'expat-leave-home') {
    router.push({ name: 'expat-leave-home' })
  }
}

const logout = async () => {
  await auth.logout()
  router.push({ name: 'greeting' })
}
</script>

<template>
  <v-app>
    <div class="expat-layout">
      <!-- Top bar -->
      <header class="topbar">
        <div class="left" @click="goHome">
          <div class="logo-dot" />
          <div class="titles">
            <span class="app-title">Expat Leave Portal</span>
            <span class="app-sub">Trax Requestor System</span>
          </div>
        </div>

        <div class="right">
          <span class="user-chip">
            <v-icon size="18" class="mr-1">mdi-account</v-icon>
            {{ userName }}
          </span>
          <v-btn
            size="small"
            color="red"
            variant="text"
            @click="logout"
          >
            <v-icon size="18" class="mr-1">mdi-logout</v-icon>
            Logout
          </v-btn>
        </div>
      </header>

      <!-- Main area -->
      <main class="main">
        <router-view />
      </main>
    </div>
  </v-app>
</template>

<style scoped>
.expat-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: radial-gradient(circle at 0% 0%, #e0f2fe 0, transparent 55%),
              radial-gradient(circle at 100% 0%, #f5e0ff 0, transparent 55%),
              #f8fafc;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 18px;
  border-bottom: 1px solid rgba(15,23,42,.08);
  background: rgba(255,255,255,.95);
  backdrop-filter: blur(10px);
}
.left {
  display:flex;
  align-items:center;
  gap:10px;
  cursor:pointer;
}
.logo-dot {
  width: 28px;
  height: 28px;
  border-radius: 12px;
  background: conic-gradient(from 160deg, #0ea5e9, #6366f1, #a855f7, #22c55e, #0ea5e9);
  box-shadow: 0 4px 12px rgba(37,99,235,.35);
}
.titles {
  display:flex;
  flex-direction:column;
  line-height:1.1;
}
.app-title {
  font-weight: 800;
  font-size: 0.95rem;
  color: #0f172a;
}
.app-sub {
  font-size: 0.75rem;
  color: #6b7280;
}
.right {
  display:flex;
  align-items:center;
  gap:10px;
}
.user-chip {
  display:inline-flex;
  align-items:center;
  padding:4px 9px;
  border-radius:999px;
  font-size:0.8rem;
  background:#e0f2fe;
  color:#0f172a;
}

.main {
  flex:1;
  padding: 18px;
}
.mr-1 { margin-right: .25rem; }
</style>
