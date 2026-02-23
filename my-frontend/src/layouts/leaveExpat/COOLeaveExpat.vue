<!-- src/layouts/LeaveExpat/COOLeaveExpat.vue
  ✅ Converted to SAME professional sidebar system as AdminLeaveExpat.vue
  ✅ Desktop: collapsible (w-72 ↔ w-16)
  ✅ Mobile: overlay drawer (separate state)
  ✅ Route-based accordion open state (keeps the right group open)
  ✅ ONE ToastContainer
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

/* ───────── Responsive ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────── Sidebar states ───────── */
const sidebarExpanded = ref(true)   // desktop: w-72 vs w-16
const mobileDrawerOpen = ref(false) // mobile overlay drawer

function toggleSidebar() {
  if (isMobile.value) mobileDrawerOpen.value = !mobileDrawerOpen.value
  else sidebarExpanded.value = !sidebarExpanded.value
}
function closeMobileDrawer() {
  mobileDrawerOpen.value = false
}

/* ───────── Nav groups ───────── */
const groups = [
  {
    key: 'approvals',
    header: 'Approvals',
    icon: 'fa-solid fa-clipboard-check',
    children: [
      { label: `${ROLE_LABEL} Inbox`, icon: 'fa-solid fa-circle-check', to: { name: 'leave-coo-inbox' } },
      { label: 'Swap Day Inbox', icon: 'fa-solid fa-calendar-days', to: { name: 'leave-coo-swap-day-inbox' } },
      { label: 'Forget Scan Inbox', icon: 'fa-solid fa-fingerprint', to: { name: 'leave-coo-forget-scan-inbox' } },
    ],
  },
]

/* Accordion open state */
const open = reactive(
  Object.fromEntries(groups.map((g) => [g.key, g.children.some((c) => c.to?.name === route.name)]))
)

/* route sync */
watch(
  () => route.name,
  (name) => {
    groups.forEach((g) => {
      if (g.children.some((c) => c.to?.name === name)) open[g.key] = true
    })
    if (isMobile.value) closeMobileDrawer()
  }
)

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
  const rs = [...new Set([...raw, ...base].map((r) => safeStr(r)).filter(Boolean))]
  return rs.length ? rs.join(', ') : `LEAVE_${ROLE_LABEL}`
})
const appTitle = computed(() => route.meta?.title || PORTAL_TITLE)

function isActive(it) {
  return route.name === it?.to?.name
}
function isGroupActive(g) {
  return g?.children?.some((c) => c?.to?.name === route.name)
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
    <!-- ✅ ONLY ONE toast renderer -->
    <ToastContainer />

    <!-- Desktop sidebar -->
    <aside
      class="hidden h-full flex-col border-r dark:border-slate-800 bg-white/80 dark:bg-slate-950/75 backdrop-blur
             shadow-[0_0_18px_rgba(15,23,42,0.06)] md:flex"
      :class="sidebarExpanded ? 'w-72' : 'w-16'"
      style="border-color: rgb(var(--ui-border));"
    >
      <!-- Top brand -->
      <div class="flex items-center justify-between border-b px-2 py-2" style="border-color: rgb(var(--ui-border));">
        <button
          type="button"
          class="inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
          @click="sidebarExpanded = !sidebarExpanded"
          title="Toggle sidebar"
        >
          <i class="fa-solid fa-bars text-[13px]" />
        </button>

        <div v-if="sidebarExpanded" class="min-w-0">
          <div class="truncate text-[11px] font-extrabold uppercase tracking-wide text-slate-800 dark:text-slate-100">
            {{ PORTAL_TITLE }}
          </div>
          <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">{{ ROLE_LABEL }} Portal</div>
        </div>

        <div v-if="sidebarExpanded" class="w-9" />
      </div>

      <!-- Nav -->
      <nav class="flex-1 overflow-y-auto ui-scrollbar px-2 py-2">
        <div v-for="g in groups" :key="g.key" class="mb-2">
          <!-- Group header -->
          <button
            type="button"
            class="group relative w-full rounded-xl px-2.5 py-2 transition border text-left"
            :class="
              isGroupActive(g)
                ? 'border-sky-500/40 bg-sky-50/80 dark:bg-sky-500/10'
                : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/60'
            "
            @click="handleSectionClick(g.key)"
          >
            <span class="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full" :class="isGroupActive(g) ? 'bg-sky-500' : 'bg-transparent'" />

            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2 min-w-0">
                <span
                  class="grid h-8 w-8 place-items-center rounded-xl border"
                  :class="
                    isGroupActive(g)
                      ? 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300'
                      : 'border-slate-200/70 bg-white/60 text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200'
                  "
                >
                  <i :class="[g.icon, 'text-[13px]']" />
                </span>

                <div v-if="sidebarExpanded" class="min-w-0">
                  <div class="truncate text-[12px] font-extrabold" :class="isGroupActive(g) ? 'text-sky-700 dark:text-sky-200' : 'text-slate-800 dark:text-slate-100'">
                    {{ g.header }}
                  </div>
                  <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">
                    {{ g.children.length }} items
                  </div>
                </div>
              </div>

              <i
                v-if="sidebarExpanded"
                class="fa-solid fa-chevron-down text-[11px] transition"
                :class="[open[g.key] ? 'rotate-180' : '', isGroupActive(g) ? 'text-sky-500' : 'text-slate-400']"
              />
            </div>
          </button>

          <!-- Children -->
          <div v-show="open[g.key]" class="mt-1 pl-10 space-y-1">
            <button
              v-for="it in g.children"
              :key="it.label"
              type="button"
              class="relative flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[12px] transition border text-left"
              :class="
                isActive(it)
                  ? 'border-sky-500/40 bg-sky-600 text-white shadow-[0_10px_22px_rgba(2,132,199,0.22)]'
                  : 'border-slate-200/70 bg-white/60 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-200 dark:hover:bg-slate-800/60'
              "
              @click="handleNavClick(it)"
            >
              <span class="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full" :class="isActive(it) ? 'bg-white/90' : 'bg-transparent'" />
              <i :class="[it.icon, 'text-[12px]', isActive(it) ? 'opacity-95' : 'opacity-80']" />
              <span v-if="sidebarExpanded" class="truncate font-semibold">{{ it.label }}</span>
            </button>
          </div>
        </div>
      </nav>

      <!-- User -->
      <div class="border-t px-2 py-2" style="border-color: rgb(var(--ui-border));">
        <div class="flex items-center gap-2">
          <div class="flex h-9 w-9 items-center justify-center rounded-full bg-sky-600 text-[11px] font-extrabold text-white">
            {{ initials }}
          </div>

          <div v-if="sidebarExpanded" class="min-w-0 flex-1">
            <div class="truncate text-[12px] font-extrabold text-slate-900 dark:text-slate-50">{{ userDisplayName }}</div>
            <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">{{ roleDisplay }}</div>
          </div>

          <button
            type="button"
            class="ml-auto inline-flex h-9 items-center justify-center rounded-xl px-3 text-[11px] font-extrabold
                   text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            @click="toggleAuth"
          >
            <i class="fa-solid fa-arrow-right-from-bracket mr-1 text-[11px]" />
            <span v-if="sidebarExpanded">{{ auth.user ? 'Logout' : 'Go' }}</span>
          </button>
        </div>
      </div>
    </aside>

    <!-- Mobile drawer -->
    <transition name="fade">
      <div v-if="mobileDrawerOpen" class="fixed inset-0 z-30 md:hidden">
        <div class="absolute inset-0 bg-black/30" @click="closeMobileDrawer" />

        <aside
          class="absolute inset-y-0 left-0 flex w-60 max-w-[70vw] flex-col bg-white dark:bg-slate-950/95 shadow-2xl"
          style="border-right: 1px solid rgb(var(--ui-border));"
        >
          <div class="flex items-center justify-between border-b px-2 py-2" style="border-color: rgb(var(--ui-border));">
            <div class="min-w-0">
              <div class="truncate text-[11px] font-extrabold uppercase tracking-wide text-slate-800 dark:text-slate-100">
                {{ PORTAL_TITLE }}
              </div>
              <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">{{ ROLE_LABEL }} Portal</div>
            </div>

            <button
              type="button"
              class="inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
              @click="closeMobileDrawer"
            >
              <i class="fa-solid fa-xmark text-[14px]" />
            </button>
          </div>

          <nav class="flex-1 overflow-y-auto ui-scrollbar px-2 py-2">
            <div v-for="g in groups" :key="g.key + '-m'" class="mb-2">
              <button
                type="button"
                class="relative w-full rounded-xl px-2.5 py-2 transition border text-left"
                :class="
                  isGroupActive(g)
                    ? 'border-sky-500/40 bg-sky-50/80 dark:bg-sky-500/10'
                    : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/60'
                "
                @click="handleSectionClick(g.key)"
              >
                <span class="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full" :class="isGroupActive(g) ? 'bg-sky-500' : 'bg-transparent'" />

                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2 min-w-0">
                    <span
                      class="grid h-8 w-8 place-items-center rounded-xl border"
                      :class="
                        isGroupActive(g)
                          ? 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300'
                          : 'border-slate-200/70 bg-white/60 text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200'
                      "
                    >
                      <i :class="[g.icon, 'text-[13px]']" />
                    </span>

                    <div class="min-w-0">
                      <div class="truncate text-[12px] font-extrabold" :class="isGroupActive(g) ? 'text-sky-700 dark:text-sky-200' : 'text-slate-800 dark:text-slate-100'">
                        {{ g.header }}
                      </div>
                      <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">{{ g.children.length }} items</div>
                    </div>
                  </div>

                  <i class="fa-solid fa-chevron-down text-[11px] transition" :class="[open[g.key] ? 'rotate-180' : '', isGroupActive(g) ? 'text-sky-500' : 'text-slate-400']" />
                </div>
              </button>

              <div v-show="open[g.key]" class="mt-1 pl-10 space-y-1">
                <button
                  v-for="it in g.children"
                  :key="it.label + '-m'"
                  type="button"
                  class="relative flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[12px] transition border text-left"
                  :class="
                    isActive(it)
                      ? 'border-sky-500/40 bg-sky-600 text-white shadow-[0_10px_22px_rgba(2,132,199,0.22)]'
                      : 'border-slate-200/70 bg-white/60 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-200 dark:hover:bg-slate-800/60'
                  "
                  @click="handleNavClick(it)"
                >
                  <span class="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full" :class="isActive(it) ? 'bg-white/90' : 'bg-transparent'" />
                  <i :class="[it.icon, 'text-[12px]', isActive(it) ? 'opacity-95' : 'opacity-80']" />
                  <span class="truncate font-semibold">{{ it.label }}</span>
                </button>
              </div>
            </div>
          </nav>

          <div class="border-t px-2 py-2" style="border-color: rgb(var(--ui-border));">
            <div class="flex items-center gap-2">
              <div class="flex h-9 w-9 items-center justify-center rounded-full bg-sky-600 text-[11px] font-extrabold text-white">{{ initials }}</div>

              <div class="min-w-0 flex-1">
                <div class="truncate text-[12px] font-extrabold text-slate-900 dark:text-slate-50">{{ userDisplayName }}</div>
                <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">{{ roleDisplay }}</div>
              </div>

              <button
                type="button"
                class="inline-flex h-9 items-center justify-center rounded-xl px-3 text-[11px] font-extrabold
                       text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                @click="toggleAuth"
              >
                <i class="fa-solid fa-arrow-right-from-bracket mr-1 text-[11px]" />
                <span>{{ auth.user ? 'Logout' : 'Go' }}</span>
              </button>
            </div>
          </div>
        </aside>
      </div>
    </transition>

    <!-- Main -->
    <div class="flex flex-1 flex-col min-w-0">
      <header
        class="flex items-center justify-between border-b bg-white/70 backdrop-blur px-2 sm:px-4 py-2 shadow-sm dark:bg-slate-950/60"
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
            <div class="truncate text-[12px] font-extrabold text-slate-800 dark:text-slate-100">{{ appTitle }}</div>
            <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">{{ userDisplayName }}</div>
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
.fade-leave-active {
  transition: opacity 0.15s ease-out;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>