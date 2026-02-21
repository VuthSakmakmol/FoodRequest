<!-- src/layouts/LeaveExpat/COOLeaveExpat.vue
  ✅ Works with your layout system (desktop sidebar + mobile overlay + topbar)
  ✅ Mobile: sidebar is overlay ONLY (desktop sidebar stays visible on md+)
  ✅ Desktop: sidebar can collapse (64 <-> 16)
  ✅ Route-based accordion open state (keeps the right group open)
  ✅ Uses ONE ToastContainer
  ✅ No repeated hard-coded "COO" (ROLE_LABEL controls wording)
  ✅ Safe initials + display name fallbacks
-->

<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/store/auth'
import ToastContainer from '@/components/AppToast.vue'

defineOptions({ name: 'COOLeaveExpat' })

const router = useRouter()
const route = useRoute()
const auth = useAuth()

/* ✅ ONE place to control wording */
const ROLE_LABEL = 'COO'
const PORTAL_TITLE = 'Expat Leave Portal'

/* ───────── Responsive / Sidebar state ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* Desktop collapse + Mobile overlay */
const desktopCollapsed = ref(false) // md+ collapse toggle
const mobileOpen = ref(false) // <md drawer open

function toggleSidebar() {
  if (isMobile.value) mobileOpen.value = !mobileOpen.value
  else desktopCollapsed.value = !desktopCollapsed.value
}
function closeMobile() {
  mobileOpen.value = false
}

/* ───────── Nav groups ───────── */
/* ───────── Nav groups ───────── */
const groups = [
  {
    key: 'approvals',
    header: 'Approvals',
    icon: 'fa-solid fa-clipboard-check',
    children: [
      { label: `${ROLE_LABEL} Inbox`, icon: 'fa-solid fa-circle-check', to: { name: 'leave-coo-inbox' } },
      { label: 'Swap Day Inbox', icon: 'fa-solid fa-calendar-days',  to: { name: 'leave-coo-swap-day-inbox' }, },
      { label: 'Forget Scan Inbox', icon: 'fa-solid fa-fingerprint', to: { name: 'leave-coo-forget-scan-inbox' } },
    ],
  },
]

/* Accordion open state */
const open = reactive(Object.fromEntries(groups.map((g) => [g.key, false])))

function syncOpenFromRoute(name) {
  groups.forEach((g) => {
    open[g.key] = g.children.some((c) => c.to?.name === name)
  })
}

/* Init open from current route */
syncOpenFromRoute(route.name)

/* Keep correct group open when route changes */
watch(
  () => route.name,
  (name) => {
    syncOpenFromRoute(name)
    if (isMobile.value) closeMobile()
  }
)

/* Resize behavior */
onMounted(() => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)
})
onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
})

/* Helpers */
function safeStr(v) {
  const s = String(v ?? '').trim()
  return s || ''
}
const initials = computed(() => {
  const base = safeStr(auth.user?.name) || safeStr(auth.user?.loginId) || 'U'
  return base.slice(0, 2).toUpperCase()
})

const userDisplayName = computed(() => safeStr(auth.user?.name) || safeStr(auth.user?.loginId) || ROLE_LABEL)

const roleDisplay = computed(() => {
  const raw = Array.isArray(auth.user?.roles) ? auth.user.roles : []
  const base = auth.user?.role ? [auth.user.role] : []
  const roles = [...new Set([...raw, ...base].map((r) => safeStr(r)).filter(Boolean))]
  return roles.length ? roles.join(', ') : `LEAVE_${ROLE_LABEL}`
})

const appTitle = computed(() => route.meta?.title || PORTAL_TITLE)

function isActive(it) {
  return route.name === it?.to?.name
}

function handleSectionClick(key) {
  const wasOpen = !!open[key]
  Object.keys(open).forEach((k) => (open[k] = false))
  open[key] = !wasOpen
}

function handleNavClick(it) {
  if (it?.to) router.push(it.to)
}

/* Logout -> Greeting */
async function toggleAuth() {
  try {
    await auth.logout?.()
  } finally {
    router.replace({ name: 'greeting' })
  }
}
</script>

<template>
  <div class="flex h-screen w-screen overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-50">
    <!-- ✅ ONLY ONE toast renderer -->
    <ToastContainer />

    <!-- Desktop sidebar (md+) -->
    <aside
      class="hidden h-full flex-col border-r border-slate-300 bg-white text-sm
             shadow-[0_0_18px_rgba(15,23,42,0.10)]
             dark:border-slate-800 dark:bg-slate-950/95 md:flex"
      :class="desktopCollapsed ? 'w-16' : 'w-64'"
    >
      <!-- Top mini bar -->
      <div
        class="flex items-center justify-between border-b border-slate-300 px-2 py-2
               text-[13px] font-semibold tracking-wide uppercase dark:border-slate-800"
      >
        <button
          type="button"
          class="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
          @click="toggleSidebar"
        >
          <i class="fa-solid fa-bars text-[13px]"></i>
        </button>

        <span v-if="!desktopCollapsed" class="ml-1 truncate text-[11px] font-semibold text-slate-600 dark:text-slate-400">
          {{ PORTAL_TITLE }}
        </span>

        <span v-if="!desktopCollapsed" class="w-8"></span>
      </div>

      <!-- Nav groups -->
      <nav class="flex-1 overflow-y-auto">
        <div class="py-1">
          <div v-for="g in groups" :key="g.key" class="px-1">
            <button
              type="button"
              class="mt-1 flex w-full items-center justify-between rounded-md px-1.5 py-1.5
                     text-[12px] font-semibold text-slate-700 transition
                     hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              @click="handleSectionClick(g.key)"
            >
              <span class="flex items-center gap-2">
                <i :class="[g.icon, 'text-[13px]']"></i>
                <span v-if="!desktopCollapsed" class="truncate">{{ g.header }}</span>
              </span>
              <i
                v-if="!desktopCollapsed"
                class="fa-solid text-[10px] text-slate-400"
                :class="open[g.key] ? 'fa-chevron-up' : 'fa-chevron-down'"
              ></i>
            </button>

            <div v-show="open[g.key]" class="mt-0.5 space-y-0.5 pb-1">
              <button
                v-for="it in g.children"
                :key="it.label"
                type="button"
                class="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[12px] transition border"
                :class="
                  isActive(it)
                    ? 'bg-[oklch(60%_0.118_184.704)] text-white border-[oklch(60%_0.118_184.704)]'
                    : 'text-slate-700 border-slate-300 hover:bg-slate-100 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-800'
                "
                @click="handleNavClick(it)"
              >
                <i :class="[it.icon, 'text-[12px]']"></i>
                <span v-if="!desktopCollapsed" class="truncate">{{ it.label }}</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      <!-- User chip -->
      <div class="flex items-center border-t border-slate-300 px-2 py-2 text-[11px] dark:border-slate-800">
        <div class="flex h-7 w-7 items-center justify-center rounded-full bg-[oklch(60%_0.118_184.704)] text-[11px] font-bold text-white">
          {{ initials }}
        </div>

        <div v-if="!desktopCollapsed" class="ml-2 min-w-0 flex-1">
          <div class="truncate font-semibold">{{ userDisplayName }}</div>
          <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">{{ roleDisplay }}</div>
        </div>

        <button
          type="button"
          class="ml-auto inline-flex h-7 items-center justify-center rounded-md px-2 text-[11px]
                 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          @click="toggleAuth"
        >
          <i class="fa-solid fa-arrow-right-from-bracket mr-1 text-[10px]"></i>
          <span v-if="!desktopCollapsed">{{ auth.user ? 'Logout' : 'Go' }}</span>
        </button>
      </div>
    </aside>

    <!-- Mobile overlay + sidebar (md-) -->
    <transition name="fade">
      <div v-if="mobileOpen" class="fixed inset-0 z-30 md:hidden">
        <div class="absolute inset-0 bg-slate-950/55 backdrop-blur-[1px]" @click="closeMobile" />
        <aside
          class="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-slate-300 bg-white text-sm shadow-2xl
                 dark:border-slate-800 dark:bg-slate-950/95"
        >
          <div class="flex items-center justify-between border-b border-slate-300 px-2 py-2 dark:border-slate-800">
            <span class="ml-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
              {{ PORTAL_TITLE }}
            </span>
            <button
              type="button"
              class="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-800"
              @click="closeMobile"
            >
              <i class="fa-solid fa-xmark text-[13px]"></i>
            </button>
          </div>

          <nav class="flex-1 overflow-y-auto">
            <div class="py-1">
              <div v-for="g in groups" :key="g.key + '-m'" class="px-1">
                <button
                  type="button"
                  class="mt-1 flex w-full items-center justify-between rounded-md px-1.5 py-1.5
                         text-[12px] font-semibold text-slate-700 transition
                         hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                  @click="handleSectionClick(g.key)"
                >
                  <span class="flex items-center gap-2">
                    <i :class="[g.icon, 'text-[13px]']"></i>
                    <span class="truncate">{{ g.header }}</span>
                  </span>
                  <i class="fa-solid text-[10px] text-slate-400" :class="open[g.key] ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
                </button>

                <div v-show="open[g.key]" class="mt-0.5 space-y-0.5 pb-1">
                  <button
                    v-for="it in g.children"
                    :key="it.label + '-m'"
                    type="button"
                    class="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[12px] transition border"
                    :class="
                      isActive(it)
                        ? 'bg-[oklch(60%_0.118_184.704)] text-white border-[oklch(60%_0.118_184.704)]'
                        : 'text-slate-700 border-slate-300 hover:bg-slate-100 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-800'
                    "
                    @click="handleNavClick(it)"
                  >
                    <i :class="[it.icon, 'text-[12px]']"></i>
                    <span class="truncate">{{ it.label }}</span>
                  </button>
                </div>
              </div>
            </div>
          </nav>

          <div class="flex items-center border-t border-slate-300 px-2 py-2 text-[11px] dark:border-slate-800">
            <div class="flex h-7 w-7 items-center justify-center rounded-full bg-[oklch(60%_0.118_184.704)] text-[11px] font-bold text-white">
              {{ initials }}
            </div>
            <div class="ml-2 min-w-0 flex-1">
              <div class="truncate font-semibold">{{ userDisplayName }}</div>
              <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">{{ roleDisplay }}</div>
            </div>
            <button
              type="button"
              class="ml-auto inline-flex h-7 items-center justify-center rounded-md px-2 text-[11px]
                     text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              @click="toggleAuth"
            >
              <i class="fa-solid fa-arrow-right-from-bracket mr-1 text-[10px]"></i>
              <span>{{ auth.user ? 'Logout' : 'Go' }}</span>
            </button>
          </div>
        </aside>
      </div>
    </transition>

    <!-- Main -->
    <div class="flex flex-1 flex-col">
      <header
        class="flex items-center justify-between border-b border-slate-300 bg-white/90
               px-2 py-1.5 text-[13px] shadow-sm
               dark:border-slate-800 dark:bg-slate-950/95"
      >
        <div class="flex h-9 items-center gap-2 min-w-0">
          <button
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 md:hidden"
            @click="toggleSidebar"
          >
            <i class="fa-solid fa-bars text-[13px]"></i>
          </button>

          <div class="flex flex-col leading-tight min-w-0">
            <div class="truncate text-[11px] font-semibold text-slate-900 dark:text-slate-50">
              {{ appTitle }}
            </div>
            <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">
              {{ userDisplayName }}
            </div>
          </div>
        </div>
      </header>

      <main class="flex-1 overflow-auto bg-slate-50 px-1 py-1 text-sm dark:bg-slate-950">
        <router-view />
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