<!-- src/layouts/LeaveExpat/AdminLeaveExpat.vue -->
<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/store/auth'

import ToastContainer from '@/components/AppToast.vue' // ✅ glass toast

const router = useRouter()
const route = useRoute()
const auth = useAuth()

/* ───────── Responsive ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────── Sidebar states ───────── */
const sidebarExpanded = ref(true)   // desktop: w-64 vs w-16
const mobileDrawerOpen = ref(false) // mobile overlay drawer

function toggleSidebar() {
  if (isMobile.value) mobileDrawerOpen.value = !mobileDrawerOpen.value
  else sidebarExpanded.value = !sidebarExpanded.value
}
function closeMobileDrawer() {
  mobileDrawerOpen.value = false
}

/* ✅ Nav groups (Expat Leave Admin)
   - Rename "Approvals" -> "Leave Approval"
   - Add "SwapDay Approval" with 3 inbox routes
   - IMPORTANT: use EXISTING route names from router/index.js
*/
const groups = [
  {
    key: 'leave-approval',
    header: 'Leave Approval',
    icon: 'fa-solid fa-clipboard-check',
    children: [
      { label: 'Manager Inbox', icon: 'fa-solid fa-user-tie',   to: { name: 'leave-admin-manager-inbox' } },
      { label: 'GM Inbox',      icon: 'fa-solid fa-user-star',  to: { name: 'leave-admin-gm-inbox' } },
      { label: 'COO Inbox',     icon: 'fa-solid fa-user-shield',to: { name: 'leave-admin-coo-inbox' } },
    ],
  },
  {
    key: 'swapday-approval',
    header: 'SwapDay Approval',
    icon: 'fa-solid fa-right-left',
    children: [
      { label: 'Manager Inbox', icon: 'fa-solid fa-user-tie',   to: { name: 'leave-admin-swap-day-manager-inbox' } },
      { label: 'GM Inbox',      icon: 'fa-solid fa-user-star',  to: { name: 'leave-admin-swap-day-gm-inbox' } },
      { label: 'COO Inbox',     icon: 'fa-solid fa-user-shield',to: { name: 'leave-admin-swap-day-coo-inbox' } },
    ],
  },
  {
    key: 'leave-admin',
    header: 'Leave Admin',
    icon: 'fa-solid fa-shield-halved',
    children: [
      { label: 'Leave Types',    icon: 'fa-solid fa-gear',         to: { name: 'leave-admin-types' } },
      { label: 'Expat Profiles', icon: 'fa-solid fa-user-group',   to: { name: 'leave-admin-profiles' } },
      { label: 'Report Summary', icon: 'fa-solid fa-chart-column', to: { name: 'leave-admin-report' } },
      { label: 'Add Signature',  icon: 'fa-solid fa-add',          to: { name: 'leave-add-signature' } },
    ],
  },
]

/* Open/close state (accordion) */
const open = reactive(
  Object.fromEntries(groups.map(g => [g.key, g.children.some(c => c.to?.name === route.name)]))
)

/* Keep correct group open when route changes */
watch(
  () => route.name,
  (name) => {
    groups.forEach(g => {
      if (g.children.some(c => c.to?.name === name)) open[g.key] = true
    })
    if (isMobile.value) closeMobileDrawer()
  }
)

/* Helpers */
const initials = computed(() =>
  (auth.user?.name || auth.user?.loginId || 'U').slice(0, 2).toUpperCase()
)

function isActive(it) {
  return route.name === it?.to?.name
}

function handleSectionClick(key) {
  const wasOpen = !!open[key]
  Object.keys(open).forEach(k => (open[k] = false))
  open[key] = !wasOpen
}

function handleNavClick(it) {
  if (it?.to) router.push(it.to)
}

/* Logout -> Greeting */
function toggleAuth() {
  if (auth.user) auth.logout()
  router.push({ name: 'greeting' })
}

onMounted(() => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)
  if (isMobile.value) mobileDrawerOpen.value = false
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
})
</script>

<template>
  <div class="ui-page flex h-screen w-screen overflow-hidden">
    <ToastContainer />

    <!-- Desktop sidebar -->
    <aside
      class="hidden h-full flex-col border-r bg-white/75 backdrop-blur
             shadow-[0_0_18px_rgba(15,23,42,0.06)]
             dark:bg-slate-950/70 md:flex"
      :class="sidebarExpanded ? 'w-64' : 'w-16'"
      style="border-color: rgb(var(--ui-border));"
    >
      <!-- Sidebar top -->
      <div class="flex items-center justify-between border-b px-2 py-2" style="border-color: rgb(var(--ui-border));">
        <button
          type="button"
          class="inline-flex h-8 w-8 items-center justify-center rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
          @click="sidebarExpanded = !sidebarExpanded"
          title="Toggle sidebar"
        >
          <i class="fa-solid fa-bars text-[13px]" />
        </button>

        <div v-if="sidebarExpanded" class="min-w-0">
          <div class="truncate text-[11px] font-extrabold uppercase tracking-wide text-slate-700 dark:text-slate-200">
            Expat Leave
          </div>
          <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">
            Admin Portal
          </div>
        </div>

        <div v-if="sidebarExpanded" class="w-8" />
      </div>

      <!-- Nav groups -->
      <nav class="flex-1 overflow-y-auto ui-scrollbar p-1">
        <div v-for="g in groups" :key="g.key" class="mb-1">
          <button
            type="button"
            class="mt-1 flex w-full items-center justify-between rounded-xl px-2 py-2
                   text-[12px] font-extrabold text-slate-700 transition
                   hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            @click="handleSectionClick(g.key)"
          >
            <span class="flex items-center gap-2 min-w-0">
              <i :class="[g.icon, 'text-[13px] opacity-90']" />
              <span v-if="sidebarExpanded" class="truncate">{{ g.header }}</span>
            </span>

            <i
              v-if="sidebarExpanded"
              class="fa-solid text-[10px] text-slate-400"
              :class="open[g.key] ? 'fa-chevron-up' : 'fa-chevron-down'"
            />
          </button>

          <div v-show="open[g.key]" class="mt-1 space-y-1">
            <button
              v-for="it in g.children"
              :key="it.label"
              type="button"
              class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-semibold
                     transition border"
              :class="isActive(it)
                ? 'bg-sky-600 text-white border-sky-600'
                : 'border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800'"
              @click="handleNavClick(it)"
            >
              <i :class="[it.icon, 'text-[12px] opacity-95']" />
              <span v-if="sidebarExpanded" class="truncate">{{ it.label }}</span>
            </button>
          </div>
        </div>
      </nav>

      <!-- User chip -->
      <div class="flex items-center gap-2 border-t px-2 py-2 text-[11px]" style="border-color: rgb(var(--ui-border));">
        <div class="flex h-8 w-8 items-center justify-center rounded-full bg-sky-600 text-[11px] font-extrabold text-white">
          {{ initials }}
        </div>

        <div v-if="sidebarExpanded" class="min-w-0 flex-1">
          <div class="truncate font-extrabold text-slate-800 dark:text-slate-100">
            {{ auth.user?.name || auth.user?.loginId || 'Expat Admin' }}
          </div>
          <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">
            {{ auth.user?.role || 'LEAVE_ADMIN' }}
          </div>
        </div>

        <button
          type="button"
          class="ml-auto inline-flex h-8 items-center justify-center rounded-xl px-2 text-[11px] font-bold
                 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          @click="toggleAuth"
        >
          <i class="fa-solid fa-arrow-right-from-bracket mr-1 text-[11px]" />
          <span v-if="sidebarExpanded">{{ auth.user ? 'Logout' : 'Go' }}</span>
        </button>
      </div>
    </aside>

    <!-- Mobile drawer -->
    <transition name="fade">
      <div v-if="mobileDrawerOpen" class="fixed inset-0 z-30 md:hidden">
        <div class="absolute inset-0 bg-black/30" @click="closeMobileDrawer" />

        <aside
          class="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-2xl
                 dark:bg-slate-950/95"
          style="border-right: 1px solid rgb(var(--ui-border));"
        >
          <div class="flex items-center justify-between border-b px-2 py-2" style="border-color: rgb(var(--ui-border));">
            <div class="min-w-0">
              <div class="truncate text-[11px] font-extrabold uppercase tracking-wide text-slate-700 dark:text-slate-200">
                Expat Leave
              </div>
              <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">
                Admin Portal
              </div>
            </div>

            <button
              type="button"
              class="inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
              @click="closeMobileDrawer"
            >
              <i class="fa-solid fa-xmark text-[14px]" />
            </button>
          </div>

          <nav class="flex-1 overflow-y-auto ui-scrollbar p-2">
            <div v-for="g in groups" :key="g.key + '-m'" class="mb-1">
              <button
                type="button"
                class="mt-1 flex w-full items-center justify-between rounded-xl px-2 py-2
                       text-[12px] font-extrabold text-slate-700 transition
                       hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                @click="handleSectionClick(g.key)"
              >
                <span class="flex items-center gap-2 min-w-0">
                  <i :class="[g.icon, 'text-[13px] opacity-90']" />
                  <span class="truncate">{{ g.header }}</span>
                </span>
                <i class="fa-solid text-[10px] text-slate-400" :class="open[g.key] ? 'fa-chevron-up' : 'fa-chevron-down'" />
              </button>

              <div v-show="open[g.key]" class="mt-1 space-y-1">
                <button
                  v-for="it in g.children"
                  :key="it.label + '-m'"
                  type="button"
                  class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-semibold
                         transition border"
                  :class="isActive(it)
                    ? 'bg-sky-600 text-white border-sky-600'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800'"
                  @click="handleNavClick(it)"
                >
                  <i :class="[it.icon, 'text-[12px] opacity-95']" />
                  <span class="truncate">{{ it.label }}</span>
                </button>
              </div>
            </div>
          </nav>

          <div class="flex items-center gap-2 border-t px-2 py-2" style="border-color: rgb(var(--ui-border));">
            <div class="flex h-8 w-8 items-center justify-center rounded-full bg-sky-600 text-[11px] font-extrabold text-white">
              {{ initials }}
            </div>

            <div class="min-w-0 flex-1">
              <div class="truncate font-extrabold text-slate-800 dark:text-slate-100">
                {{ auth.user?.name || auth.user?.loginId || 'Expat Admin' }}
              </div>
              <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">
                {{ auth.user?.role || 'LEAVE_ADMIN' }}
              </div>
            </div>

            <button
              type="button"
              class="inline-flex h-9 items-center justify-center rounded-xl px-3 text-[11px] font-bold
                     text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              @click="toggleAuth"
            >
              <i class="fa-solid fa-arrow-right-from-bracket mr-1 text-[11px]" />
              <span>{{ auth.user ? 'Logout' : 'Go' }}</span>
            </button>
          </div>
        </aside>
      </div>
    </transition>

    <!-- Main column -->
    <div class="flex flex-1 flex-col min-w-0">
      <!-- Top bar -->
      <header
        class="flex items-center justify-between border-b bg-white/70 backdrop-blur px-2 sm:px-4 py-2 shadow-sm
               dark:bg-slate-950/60"
        style="border-color: rgb(var(--ui-border));"
      >
        <div class="flex items-center gap-2 min-w-0">
          <button
            type="button"
            class="inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 md:hidden"
            @click="toggleSidebar"
          >
            <i class="fa-solid fa-bars text-[13px]" />
          </button>

          <div class="min-w-0">
            <div class="truncate text-[12px] font-extrabold text-slate-800 dark:text-slate-100">
              {{ route.meta?.title || 'Expat Leave Admin Portal' }}
            </div>
            <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">
              {{ auth.user?.name || auth.user?.loginId || 'LEAVE_ADMIN' }}
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2"></div>
      </header>

      <main class="flex-1 min-h-0 overflow-auto">
        <div class="w-full px-2 sm:px-4 lg:px-6 2xl:px-10 py-3">
          <router-view />
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active { transition: opacity 0.15s ease-out; }
.fade-enter-from,
.fade-leave-to { opacity: 0; }
</style>