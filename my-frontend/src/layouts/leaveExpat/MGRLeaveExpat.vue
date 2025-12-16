<!-- src/layouts/LeaveExpat/MGRLeaveExpat.vue -->
<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/store/auth'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const route  = useRoute()
const auth   = useAuth()

/* ───────── Toast (shared) ───────── */
const { toasts, removeToast } = useToast()

/* ───────── Sidebar state ───────── */
const sidebarOpen = ref(true)

/* Nav groups (Manager Expat Leave) */
const groups = [
  {
    key: 'approvals',
    header: 'Approvals',
    icon: 'fa-solid fa-clipboard-check',
    children: [
      {
        label: 'Manager Inbox',
        icon: 'fa-solid fa-user-tie',
        to: { name: 'leave-manager-inbox' },
      },
      {
        label: 'Profile',
        icon: 'fa-solid fa-id-badge',
        to: { name: 'leave-manager-profile' },
      },
    ],
  },
]

/* Open/close state (accordion) */
const open = reactive(
  Object.fromEntries(
    groups.map(g => [g.key, g.children.some(c => c.to?.name === route.name)])
  )
)

/* Keep correct group open when route changes */
watch(
  () => route.name,
  (name) => {
    groups.forEach(g => {
      if (g.children.some(c => c.to?.name === name)) {
        open[g.key] = true
      }
    })
  }
)

/* Helpers */
const initials = computed(() =>
  (auth.user?.name || auth.user?.loginId || 'U').slice(0, 2).toUpperCase()
)

const appTitle = computed(() => route.meta?.title || 'Expat Leave Manager Portal')

function isActive(it) {
  return route.name === it?.to?.name
}

function handleSectionClick(key) {
  const wasOpen = open[key]
  Object.keys(open).forEach(k => { open[k] = false })
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
</script>

<template>
  <div
    class="flex h-screen w-screen overflow-hidden bg-slate-50 text-slate-900
           dark:bg-slate-950 dark:text-slate-50"
  >
    <!-- Global toast stack -->
    <div class="fixed top-4 right-4 z-50 flex max-w-xs flex-col gap-2">
      <div
        v-for="t in toasts"
        :key="t.id"
        class="flex gap-2 rounded-xl border px-3.5 py-2.5 text-sm shadow-xl bg-slate-900/95"
        :class="{
          'border-emerald-400/70 text-emerald-100': t.type === 'success',
          'border-red-400/70 text-red-100': t.type === 'error',
          'border-amber-400/70 text-amber-100': t.type === 'warning',
          'border-sky-400/70 text-sky-100': t.type === 'info',
        }"
      >
        <div class="flex-1">
          <div class="mb-0.5 font-semibold">
            {{ t.title || (t.type === 'success' ? 'Success' : t.type === 'error' ? 'Error' : t.type === 'warning' ? 'Notice' : 'Info') }}
          </div>
          <p class="text-xs leading-snug">
            {{ t.message }}
          </p>
        </div>
        <button
          type="button"
          class="ml-1 text-xs opacity-70 hover:opacity-100"
          @click="removeToast(t.id)"
        >
          ✕
        </button>
      </div>
    </div>

    <!-- Desktop sidebar -->
    <aside
      class="hidden h-full flex-col border-r border-slate-300 bg-white text-sm
             shadow-[0_0_18px_rgba(15,23,42,0.10)]
             dark:border-slate-800 dark:bg-slate-950/95
             md:flex"
      :class="sidebarOpen ? 'w-64' : 'w-16'"
    >
      <!-- Top mini bar -->
      <div
        class="flex items-center justify-between border-b border-slate-300 px-2 py-2
               text-[13px] font-semibold tracking-wide uppercase
               dark:border-slate-800"
      >
        <button
          type="button"
          class="inline-flex h-8 w-8 items-center justify-center rounded-md
                 hover:bg-slate-100 dark:hover:bg-slate-800"
          @click="sidebarOpen = !sidebarOpen"
        >
          <i class="fa-solid fa-bars text-[13px]"></i>
        </button>

        <span
          v-if="sidebarOpen"
          class="ml-1 truncate text-[11px] font-semibold text-slate-600 dark:text-slate-400"
        >
          Expat Manager
        </span>

        <span v-if="sidebarOpen" class="w-8"></span>
      </div>

      <!-- Nav groups -->
      <nav class="flex-1 overflow-y-auto">
        <div class="py-1">
          <div
            v-for="g in groups"
            :key="g.key"
            class="px-1"
          >
            <!-- Section header -->
            <button
              type="button"
              class="mt-1 flex w-full items-center justify-between rounded-md px-1.5 py-1.5
                     text-[12px] font-semibold text-slate-700 transition
                     hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              @click="handleSectionClick(g.key)"
            >
              <span class="flex items-center gap-2">
                <i :class="[g.icon, 'text-[13px]']"></i>
                <span v-if="sidebarOpen" class="truncate">{{ g.header }}</span>
              </span>
              <i
                v-if="sidebarOpen"
                class="fa-solid text-[10px] text-slate-400"
                :class="open[g.key] ? 'fa-chevron-up' : 'fa-chevron-down'"
              ></i>
            </button>

            <!-- Children -->
            <div
              v-show="open[g.key]"
              class="mt-0.5 space-y-0.5 pb-1"
            >
              <button
                v-for="it in g.children"
                :key="it.label"
                type="button"
                class="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[12px]
                       transition border"
                :class="isActive(it)
                  ? 'bg-[oklch(60%_0.118_184.704)] text-white border-[oklch(60%_0.118_184.704)]'
                  : 'text-slate-700 border-slate-300 hover:bg-slate-100 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-800'"
                @click="handleNavClick(it)"
              >
                <i :class="[it.icon, 'text-[12px]']"></i>
                <span v-if="sidebarOpen" class="truncate">
                  {{ it.label }}
                </span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      <!-- User chip -->
      <div
        class="flex items-center border-t border-slate-300 px-2 py-2 text-[11px]
               dark:border-slate-800"
      >
        <div
          class="flex h-7 w-7 items-center justify-center rounded-full
                 bg-[oklch(60%_0.118_184.704)] text-[11px] font-bold text-white"
        >
          {{ initials }}
        </div>
        <div
          v-if="sidebarOpen"
          class="ml-2 min-w-0 flex-1"
        >
          <div class="truncate font-semibold">
            {{ auth.user?.name || auth.user?.loginId || 'Manager' }}
          </div>
          <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">
            {{ auth.user?.role || 'LEAVE_MANAGER' }}
          </div>
        </div>
        <button
          type="button"
          class="ml-auto inline-flex h-7 items-center justify-center rounded-md px-2 text-[11px]
                 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          @click="toggleAuth"
        >
          <i class="fa-solid fa-arrow-right-from-bracket mr-1 text-[10px]"></i>
          <span v-if="sidebarOpen">
            {{ auth.user ? 'Logout' : 'Go' }}
          </span>
        </button>
      </div>
    </aside>

    <!-- Mobile sidebar (overlay) -->
    <transition name="fade">
      <aside
        v-if="sidebarOpen"
        class="fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-slate-300 bg-white
               text-sm shadow-lg dark:border-slate-800 dark:bg-slate-950/95 md:hidden"
      >
        <div
          class="flex items-center justify-between border-b border-slate-300 px-2 py-2
                 dark:border-slate-800"
        >
          <span class="ml-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
            Expat Manager
          </span>
          <button
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-md
                   hover:bg-slate-100 dark:hover:bg-slate-800"
            @click="sidebarOpen = false"
          >
            <i class="fa-solid fa-xmark text-[13px]"></i>
          </button>
        </div>

        <nav class="flex-1 overflow-y-auto">
          <div class="py-1">
            <div
              v-for="g in groups"
              :key="g.key + '-m'"
              class="px-1"
            >
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
                <i
                  class="fa-solid text-[10px] text-slate-400"
                  :class="open[g.key] ? 'fa-chevron-up' : 'fa-chevron-down'"
                ></i>
              </button>

              <div
                v-show="open[g.key]"
                class="mt-0.5 space-y-0.5 pb-1"
              >
                <button
                  v-for="it in g.children"
                  :key="it.label + '-m'"
                  type="button"
                  class="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[12px]
                         transition border"
                  :class="isActive(it)
                    ? 'bg-[oklch(60%_0.118_184.704)] text-white border-[oklch(60%_0.118_184.704)]'
                    : 'text-slate-700 border-slate-300 hover:bg-slate-100 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-800'"
                  @click="
                    handleNavClick(it);
                    sidebarOpen = false;
                  "
                >
                  <i :class="[it.icon, 'text-[12px]']"></i>
                  <span class="truncate">{{ it.label }}</span>
                </button>
              </div>
            </div>
          </div>
        </nav>

        <div
          class="flex items-center border-t border-slate-300 px-2 py-2 text-[11px]
                 dark:border-slate-800"
        >
          <div
            class="flex h-7 w-7 items-center justify-center rounded-full
                   bg-[oklch(60%_0.118_184.704)] text-[11px] font-bold text-white"
          >
            {{ initials }}
          </div>
          <div class="ml-2 min-w-0 flex-1">
            <div class="truncate font-semibold">
              {{ auth.user?.name || auth.user?.loginId || 'Manager' }}
            </div>
            <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">
              {{ auth.user?.role || 'LEAVE_MANAGER' }}
            </div>
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
    </transition>

    <!-- Main column -->
    <div class="flex flex-1 flex-col">
      <!-- Top bar -->
      <header
        class="flex items-center justify-between border-b border-slate-300 bg-white/90
               px-2 py-1.5 text-[13px] shadow-sm
               dark:border-slate-800 dark:bg-slate-950/95"
      >
        <div class="flex items-center h-10 gap-2 min-w-0">
          <button
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-md
                   hover:bg-slate-100 dark:hover:bg-slate-800 md:hidden"
            @click="sidebarOpen = !sidebarOpen"
          >
            <i class="fa-solid fa-bars text-[13px]"></i>
          </button>

          <div class="flex flex-col leading-tight min-w-0">
            <div class="truncate text-[11px] font-semibold text-slate-900 dark:text-slate-50">
              {{ appTitle }}
            </div>
            <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">
              {{ auth.user?.name || auth.user?.loginId || 'Manager' }} · {{ auth.user?.role || 'LEAVE_MANAGER' }}
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5
                   text-[11px] font-semibold text-slate-700 hover:bg-slate-50
                   dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
            @click="toggleAuth"
          >
            <i class="fa-solid fa-arrow-right-from-bracket text-[10px]"></i>
            Logout
          </button>
        </div>
      </header>

      <!-- Content -->
      <main
        class="flex-1 overflow-auto bg-slate-50 px-1 py-1 text-sm dark:bg-slate-950"
      >
        <router-view />
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
