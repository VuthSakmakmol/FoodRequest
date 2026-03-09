<!-- src/layouts/EmployeeLayout.vue -->
<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/store/auth'
import ToastContainer from '@/components/AppToast.vue'

defineOptions({ name: 'EmployeeLayout' })

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
const sidebarExpanded = ref(true)
const mobileDrawerOpen = ref(false)

function toggleSidebar() {
  if (isMobile.value) mobileDrawerOpen.value = !mobileDrawerOpen.value
  else sidebarExpanded.value = !sidebarExpanded.value
}
function closeMobileDrawer() {
  mobileDrawerOpen.value = false
}

/* ───────── Sections ───────── */
const groups = [
  {
    key: 'home',
    header: 'Home',
    icon: 'fa-solid fa-house',
    children: [
      { label: 'Greeting', icon: 'fa-regular fa-handshake', to: { name: 'greeting' } },
    ],
  },
  {
    key: 'food',
    header: 'Food Request',
    icon: 'fa-solid fa-bowl-food',
    children: [
      { label: 'Request Meal', icon: 'fa-solid fa-utensils', to: { name: 'employee-request' } },
      { label: 'My Requests', icon: 'fa-regular fa-clock', to: { name: 'employee-request-history' } },
      { label: 'Calendar', icon: 'fa-regular fa-calendar-days', to: { name: 'employee-food-calendar' } },
    ],
  },
  {
    key: 'transport',
    header: 'Transportation',
    icon: 'fa-solid fa-car-side',
    children: [
      { label: 'Book a Car', icon: 'fa-solid fa-car-on', to: { name: 'employee-car-booking' } },
      { label: 'My Car Bookings', icon: 'fa-solid fa-list', to: { name: 'employee-car-history' } },
      { label: 'Calendar', icon: 'fa-regular fa-clock', to: { name: 'employee-car-schedule' } },
    ],
  },
  {
    key: 'meeting-room',
    header: 'Meeting Room',
    icon: 'fa-solid fa-building-user',
    children: [
      { label: 'Book Meeting Room', icon: 'fa-solid fa-calendar-plus', to: { name: 'public-booking-room-request' } },
      { label: 'My Bookings', icon: 'fa-solid fa-list-check', to: { name: 'public-booking-room-history' } },
    ],
  },
]

/* ───────── Accordion open state ───────── */
const open = reactive(
  Object.fromEntries(groups.map((g) => [g.key, g.children.some((c) => c.to?.name === route.name)]))
)

/* ───────── Route sync ───────── */
watch(
  () => route.name,
  (name) => {
    groups.forEach((g) => {
      if (g.children.some((c) => c.to?.name === name)) open[g.key] = true
    })
    if (isMobile.value) closeMobileDrawer()
  }
)

const initials = computed(() =>
  (auth.user?.name || auth.user?.loginId || 'U').slice(0, 2).toUpperCase()
)

function isActive(it) {
  return route.name === it?.to?.name
}
function isGroupActive(g) {
  return g?.children?.some((c) => c?.to?.name === route.name)
}

function handleSectionClick(key) {
  const wasOpen = !!open[key]
  Object.keys(open).forEach((k) => {
    open[k] = false
  })
  open[key] = !wasOpen
}

function handleNavClick(it) {
  if (it?.to) router.push(it.to)
}

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
      class="hidden h-full flex-col border-r bg-white/80 backdrop-blur shadow-[0_0_18px_rgba(15,23,42,0.06)]
             dark:border-slate-800 dark:bg-slate-950/75 md:flex"
      :class="sidebarExpanded ? 'w-64' : 'w-16'"
      style="border-color: rgb(var(--ui-border));"
    >
      <div
        class="flex items-center justify-between border-b px-2 py-2"
        style="border-color: rgb(var(--ui-border));"
      >
        <button
          type="button"
          class="inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
          title="Toggle sidebar"
          @click="sidebarExpanded = !sidebarExpanded"
        >
          <i class="fa-solid fa-bars text-[13px]" />
        </button>

        <div v-if="sidebarExpanded" class="min-w-0">
          <div class="truncate text-[11px] font-extrabold uppercase tracking-wide text-slate-800 dark:text-slate-100">
            Trax Requestor
          </div>
          <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">
            Employee Portal
          </div>
        </div>

        <div v-if="sidebarExpanded" class="w-9" />
      </div>

      <nav class="ui-scrollbar flex-1 overflow-y-auto px-2 py-2">
        <div v-for="g in groups" :key="g.key" class="mb-2">
          <button
            type="button"
            class="group relative w-full rounded-xl border px-2.5 py-2 text-left transition"
            :class="
              isGroupActive(g)
                ? 'border-sky-500/40 bg-sky-50/80 dark:bg-sky-500/10'
                : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/60'
            "
            @click="handleSectionClick(g.key)"
          >
            <span
              class="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full"
              :class="isGroupActive(g) ? 'bg-sky-500' : 'bg-transparent'"
            />

            <div class="flex items-center justify-between">
              <div class="flex min-w-0 items-center gap-2">
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
                  <div
                    class="truncate text-[12px] font-extrabold"
                    :class="isGroupActive(g) ? 'text-sky-700 dark:text-sky-200' : 'text-slate-800 dark:text-slate-100'"
                  >
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
                :class="[
                  open[g.key] ? 'rotate-180' : '',
                  isGroupActive(g) ? 'text-sky-500' : 'text-slate-400',
                ]"
              />
            </div>
          </button>

          <div v-show="open[g.key]" class="mt-1 space-y-1 pl-10">
            <button
              v-for="it in g.children"
              :key="it.label"
              type="button"
              class="relative flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-[12px] transition"
              :class="
                isActive(it)
                  ? 'border-sky-500/40 bg-sky-600 text-white shadow-[0_10px_22px_rgba(2,132,199,0.22)]'
                  : 'border-slate-200/70 bg-white/60 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-200 dark:hover:bg-slate-800/60'
              "
              @click="handleNavClick(it)"
            >
              <span
                class="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full"
                :class="isActive(it) ? 'bg-white/90' : 'bg-transparent'"
              />

              <i :class="[it.icon, 'text-[12px]', isActive(it) ? 'opacity-95' : 'opacity-80']" />
              <span v-if="sidebarExpanded" class="truncate font-semibold">{{ it.label }}</span>
            </button>
          </div>
        </div>
      </nav>

      <div class="border-t px-2 py-2" style="border-color: rgb(var(--ui-border));">
        <div class="flex items-center gap-2">
          <div class="flex h-9 w-9 items-center justify-center rounded-full bg-sky-600 text-[11px] font-extrabold text-white">
            {{ initials }}
          </div>

          <div v-if="sidebarExpanded" class="min-w-0 flex-1">
            <div class="truncate text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
              {{ auth.user?.name || auth.user?.loginId || 'Employee' }}
            </div>
            <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">
              {{ auth.user?.role || 'EMPLOYEE' }}
            </div>
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
          class="absolute inset-y-0 left-0 flex w-60 max-w-[70vw] flex-col bg-white shadow-2xl dark:bg-slate-950/95"
          style="border-right: 1px solid rgb(var(--ui-border));"
        >
          <div
            class="flex items-center justify-between border-b px-2 py-2"
            style="border-color: rgb(var(--ui-border));"
          >
            <div class="min-w-0">
              <div class="truncate text-[11px] font-extrabold uppercase tracking-wide text-slate-800 dark:text-slate-100">
                Trax Requestor
              </div>
              <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">
                Employee Portal
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

          <nav class="ui-scrollbar flex-1 overflow-y-auto px-2 py-2">
            <div v-for="g in groups" :key="g.key + '-m'" class="mb-2">
              <button
                type="button"
                class="relative w-full rounded-xl border px-2.5 py-2 text-left transition"
                :class="
                  isGroupActive(g)
                    ? 'border-sky-500/40 bg-sky-50/80 dark:bg-sky-500/10'
                    : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/60'
                "
                @click="handleSectionClick(g.key)"
              >
                <span
                  class="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full"
                  :class="isGroupActive(g) ? 'bg-sky-500' : 'bg-transparent'"
                />
                <div class="flex items-center justify-between">
                  <div class="flex min-w-0 items-center gap-2">
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
                      <div
                        class="truncate text-[12px] font-extrabold"
                        :class="isGroupActive(g) ? 'text-sky-700 dark:text-sky-200' : 'text-slate-800 dark:text-slate-100'"
                      >
                        {{ g.header }}
                      </div>
                      <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">
                        {{ g.children.length }} items
                      </div>
                    </div>
                  </div>

                  <i
                    class="fa-solid fa-chevron-down text-[11px] transition"
                    :class="[
                      open[g.key] ? 'rotate-180' : '',
                      isGroupActive(g) ? 'text-sky-500' : 'text-slate-400',
                    ]"
                  />
                </div>
              </button>

              <div v-show="open[g.key]" class="mt-1 space-y-1 pl-10">
                <button
                  v-for="it in g.children"
                  :key="it.label + '-m'"
                  type="button"
                  class="relative flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-[12px] transition"
                  :class="
                    isActive(it)
                      ? 'border-sky-500/40 bg-sky-600 text-white shadow-[0_10px_22px_rgba(2,132,199,0.22)]'
                      : 'border-slate-200/70 bg-white/60 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-200 dark:hover:bg-slate-800/60'
                  "
                  @click="handleNavClick(it); closeMobileDrawer()"
                >
                  <span
                    class="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full"
                    :class="isActive(it) ? 'bg-white/90' : 'bg-transparent'"
                  />
                  <i :class="[it.icon, 'text-[12px]', isActive(it) ? 'opacity-95' : 'opacity-80']" />
                  <span class="truncate font-semibold">{{ it.label }}</span>
                </button>
              </div>
            </div>
          </nav>

          <div class="border-t px-2 py-2" style="border-color: rgb(var(--ui-border));">
            <div class="flex items-center gap-2">
              <div class="flex h-9 w-9 items-center justify-center rounded-full bg-sky-600 text-[11px] font-extrabold text-white">
                {{ initials }}
              </div>
              <div class="min-w-0 flex-1">
                <div class="truncate text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                  {{ auth.user?.name || auth.user?.loginId || 'Employee' }}
                </div>
                <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">
                  {{ auth.user?.role || 'EMPLOYEE' }}
                </div>
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

    <!-- Main column -->
    <div class="flex min-w-0 flex-1 flex-col">
      <header
        class="flex items-center justify-between border-b bg-white/70 px-2 py-2 shadow-sm backdrop-blur
               dark:bg-slate-950/60 sm:px-4"
        style="border-color: rgb(var(--ui-border));"
      >
        <div class="flex min-w-0 items-center gap-2">
          <button
            type="button"
            class="inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 md:hidden"
            @click="toggleSidebar"
          >
            <i class="fa-solid fa-bars text-[13px]" />
          </button>

          <div class="min-w-0">
            <div class="truncate text-[12px] font-extrabold text-slate-800 dark:text-slate-100">
              {{ route.meta?.title || 'Employee Portal' }}
            </div>
            <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">
              {{ auth.user?.name || auth.user?.loginId || 'EMPLOYEE' }}
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2" />
      </header>

      <main class="min-h-0 flex-1 overflow-auto">
        <div class="w-full px-2 py-3 sm:px-4 lg:px-6 2xl:px-10">
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