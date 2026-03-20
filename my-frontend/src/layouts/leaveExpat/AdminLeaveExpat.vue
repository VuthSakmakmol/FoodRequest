<script setup>
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '@/store/auth'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import ToastContainer from '@/components/AppToast.vue'

import ContractReminderBanner from '@/views/expat/admin/contractRemind/ContractReminderBanner.vue'
import ContractReminderList from '@/views/expat/admin/contractRemind/ContractReminderList.vue'
import RenewModal from '@/views/expat/admin/profiles/components/RenewModal.vue'

defineOptions({ name: 'AdminLeaveExpat' })

const router = useRouter()
const route = useRoute()
const auth = useAuth()
const { showToast } = useToast()

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

/* ✅ Nav groups */
const groups = [
  {
    key: 'leave-approval',
    header: 'Leave Approval',
    icon: 'fa-solid fa-clipboard-check',
    children: [
      { label: 'Expat Profiles', icon: 'fa-solid fa-user-group', to: { name: 'leave-admin-profiles' } },
    ],
  },
  {
    key: 'swapday-approval',
    header: 'SwapDay Approval',
    icon: 'fa-solid fa-right-left',
    children: [
      { label: 'SwapDay Report', icon: 'fa-solid fa-file-export', to: { name: 'leave-admin-swap-day-report' } },
    ],
  },
  {
    key: 'forgetscan-approval',
    header: 'Forget Scan Approval',
    icon: 'fa-solid fa-fingerprint',
    children: [
      { label: 'Forget Scan Report', icon: 'fa-solid fa-file-export', to: { name: 'admin-forget-scan-report' } },
    ],
  },
  {
    key: 'central-data',
    header: 'Central Report',
    icon: 'fa-solid fa-database',
    children: [
      {
        label: 'Central Data',
        icon: 'fa-solid fa-table',
        to: { name: 'leave-admin-central-data' },
      },
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

const initials = computed(() => (auth.user?.name || auth.user?.loginId || 'U').slice(0, 2).toUpperCase())

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

/* ───────── Helpers ───────── */
function s(v) {
  return String(v ?? '').trim()
}
function num(v, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
function isValidYMD(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s(v))
}
function nextDayYMD(ymd) {
  const raw = s(ymd)
  if (!isValidYMD(raw)) return ''
  const [y, m, d] = raw.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + 1)
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/* ───────── Contract reminders (global for all admin leave pages) ───────── */
const contractReminderLoading = ref(false)
const contractReminders = ref([])
const contractReminderListOpen = ref(false)
const contractReminderDismissed = ref(false)

let reminderPollTimer = null
let reminderInitialLoaded = false
const seenReminderKeys = new Set()

function reminderKey(item) {
  return [
    s(item?.employeeId),
    num(item?.contractNo, 0),
    s(item?.endDate),
    s(item?.reminderType || item?.reminderStage),
  ].join('|')
}

function normalizeReminderRow(raw = {}) {
  const endDate = s(raw.endDate || raw.contractEndDate || raw.to)
  return {
    employeeId: s(raw.employeeId),
    employeeName: s(raw.employeeName || raw.name),
    name: s(raw.name || raw.employeeName),
    department: s(raw.department),
    managerLoginId: s(raw.managerLoginId),
    contractNo: num(raw.contractNo),
    startDate: s(raw.startDate),
    endDate,
    currentContractEndDate: endDate,
    newContractDate: nextDayYMD(endDate),
    daysLeft: num(raw.daysLeft, 0),

    reminderType: s(raw.reminderType),
    reminderStage: num(raw.reminderStage, 0),

    urgencyKey: s(raw.urgencyKey),
    approvalMode: s(raw.approvalMode),
    employeeLoginId: s(raw.employeeLoginId),

    sentStages:
      raw?.sentStages && typeof raw.sentStages === 'object'
        ? {
            D30: !!raw.sentStages.D30,
            D14: !!raw.sentStages.D14,
            D7: !!raw.sentStages.D7,
            D1: !!raw.sentStages.D1,
          }
        : { D30: false, D14: false, D7: false, D1: false },

    sentAt30: raw?.sentAt30 || null,
    sentAt14: raw?.sentAt14 || null,
    sentAt7: raw?.sentAt7 || null,
    sentAt1: raw?.sentAt1 || null,
  }
}

const activeReminderCount = computed(() => contractReminders.value.length)
const hasContractReminders = computed(() => activeReminderCount.value > 0)
const showContractReminderBanner = computed(() => hasContractReminders.value && !contractReminderDismissed.value)

function markCurrentRemindersSeen(rows = []) {
  for (const row of rows) seenReminderKeys.add(reminderKey(row))
}

function detectNewReminders(rows = []) {
  return rows.some((row) => !seenReminderKeys.has(reminderKey(row)))
}

async function fetchContractReminders({ silent = false, allowAutoOpen = false } = {}) {
  if (contractReminderLoading.value) return
  contractReminderLoading.value = true

  try {
    const res = await api.get('/admin/leave/contracts/reminders')
    const list = Array.isArray(res?.data?.items)
      ? res.data.items
      : Array.isArray(res?.data)
        ? res.data
        : []

    const nextRows = list.map(normalizeReminderRow)
    const hasNew = reminderInitialLoaded ? detectNewReminders(nextRows) : false

    contractReminders.value = nextRows

    if (!reminderInitialLoaded) {
      markCurrentRemindersSeen(nextRows)
      reminderInitialLoaded = true
    } else if (hasNew) {
      contractReminderDismissed.value = false

      if (allowAutoOpen && nextRows.length) {
        contractReminderListOpen.value = true
        showToast({
          type: 'warning',
          title: 'Contract reminder',
          message:
            nextRows.length === 1
              ? 'A contract reminder needs action.'
              : `${nextRows.length} contract reminders need action.`,
        })
      }

      markCurrentRemindersSeen(nextRows)
    } else {
      markCurrentRemindersSeen(nextRows)
    }

    if (!nextRows.length) {
      contractReminderDismissed.value = false
    }
  } catch (e) {
    const status = e?.response?.status
    const msg = e?.response?.data?.message || e?.message || 'Failed to load contract reminders.'

    if (!silent && status !== 404) {
      showToast({ type: 'error', title: 'Reminder load failed', message: msg })
    }

    if (status === 404) {
      contractReminders.value = []
    }
  } finally {
    contractReminderLoading.value = false
  }
}

function startReminderPolling() {
  stopReminderPolling()
  reminderPollTimer = window.setInterval(() => {
    fetchContractReminders({ silent: true, allowAutoOpen: true })
  }, 60 * 1000)
}

function stopReminderPolling() {
  if (reminderPollTimer) {
    window.clearInterval(reminderPollTimer)
    reminderPollTimer = null
  }
}

function handleOpenReminderList() {
  contractReminderListOpen.value = true
  contractReminderDismissed.value = false
  markCurrentRemindersSeen(contractReminders.value)
}

function handleCloseReminderList() {
  contractReminderListOpen.value = false
}

function handleDismissReminderBanner() {
  contractReminderDismissed.value = true
}

function handleOpenReminderProfile(item) {
  const employeeId = s(item?.employeeId)
  if (!employeeId) return
  contractReminderListOpen.value = false
  contractReminderDismissed.value = false
  router.push({ name: 'leave-admin-profile-edit', params: { employeeId } })
}

/* ───────── Renew modal direct open ───────── */
const renewModalOpen = ref(false)
const renewSubmitting = ref(false)
const renewError = ref('')

const renewEmployeeId = ref('')
const renewEmployeeName = ref('')
const renewCurrentContractEndDate = ref('')

const renewForm = reactive({
  newContractDate: '',
  clearOldLeave: true,
  note: '',
})

function resetRenewState() {
  renewError.value = ''
  renewEmployeeId.value = ''
  renewEmployeeName.value = ''
  renewCurrentContractEndDate.value = ''
  renewForm.newContractDate = ''
  renewForm.clearOldLeave = true
  renewForm.note = ''
}

function openRenewModal(item) {
  const employeeId = s(item?.employeeId)
  if (!employeeId) return

  contractReminderListOpen.value = false
  contractReminderDismissed.value = false

  renewError.value = ''
  renewEmployeeId.value = employeeId
  renewEmployeeName.value = s(item?.name || item?.employeeName)

  const currentEndDate = s(item?.currentContractEndDate || item?.endDate || item?.contractEndDate)
  renewCurrentContractEndDate.value = currentEndDate
  renewForm.newContractDate = s(item?.newContractDate) || nextDayYMD(currentEndDate)
  renewForm.clearOldLeave = true
  renewForm.note = ''
  renewModalOpen.value = true
}

function closeRenewModal() {
  if (renewSubmitting.value) return
  renewModalOpen.value = false
  resetRenewState()
}

async function submitRenewModal() {
  if (renewSubmitting.value) return

  const employeeId = s(renewEmployeeId.value)
  if (!employeeId) {
    renewError.value = 'Employee ID is missing.'
    return
  }

  renewSubmitting.value = true
  renewError.value = ''

  try {
    await api.post(`/admin/leave/profiles/${encodeURIComponent(employeeId)}/contracts/renew`, {
      clearUnusedAL: !!renewForm.clearOldLeave,
      note: s(renewForm.note),
    })

    showToast({
      type: 'success',
      title: 'Contract renewed',
      message: `${employeeId} contract renewed successfully.`,
    })

    renewModalOpen.value = false
    resetRenewState()

    await fetchContractReminders({ silent: true, allowAutoOpen: false })

    window.dispatchEvent(
      new CustomEvent('leave-contract-renewed', {
        detail: { employeeId },
      })
    )
  } catch (e) {
    renewError.value = e?.response?.data?.message || e?.message || 'Failed to renew contract.'
  } finally {
    renewSubmitting.value = false
  }
}

function handleRenewReminder(item) {
  openRenewModal(item)
}

/* ───────── Lifecycle ───────── */
onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)
  if (isMobile.value) mobileDrawerOpen.value = false

  await fetchContractReminders({ silent: false, allowAutoOpen: false })
  if (typeof window !== 'undefined') startReminderPolling()
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
  stopReminderPolling()
})
</script>

<template>
  <div class="ui-page flex h-screen w-screen overflow-hidden">
    <ToastContainer />

    <!-- Desktop sidebar -->
    <aside
      class="hidden h-full flex-col border-r dark:border-slate-800 bg-white/80 dark:bg-slate-950/75 backdrop-blur
             shadow-[0_0_18px_rgba(15,23,42,0.06)] md:flex"
      :class="sidebarExpanded ? 'w-64' : 'w-16'"
      style="border-color: rgb(var(--ui-border));"
    >
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
            Expat Leave
          </div>
          <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">Admin Portal</div>
        </div>

        <div v-if="sidebarExpanded" class="w-9" />
      </div>

      <nav class="flex-1 overflow-y-auto ui-scrollbar px-2 py-2">
        <div v-for="g in groups" :key="g.key" class="mb-2">
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
            <span
              class="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full"
              :class="isGroupActive(g) ? 'bg-sky-500' : 'bg-transparent'"
            />

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

      <div v-if="hasContractReminders" class="px-2 pb-2">
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-extrabold text-amber-800
                 hover:bg-amber-100 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100 dark:hover:bg-amber-950/40"
          @click="handleOpenReminderList"
        >
          <i class="fa-solid fa-bell" />
          <span v-if="sidebarExpanded" class="truncate">
            {{ activeReminderCount }} reminder{{ activeReminderCount === 1 ? '' : 's' }}
          </span>
        </button>
      </div>

      <div class="border-t px-2 py-2" style="border-color: rgb(var(--ui-border));">
        <div class="flex items-center gap-2">
          <div class="flex h-9 w-9 items-center justify-center rounded-full bg-sky-600 text-[11px] font-extrabold text-white">
            {{ initials }}
          </div>

          <div v-if="sidebarExpanded" class="min-w-0 flex-1">
            <div class="truncate text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
              {{ auth.user?.name || auth.user?.loginId || 'Expat Admin' }}
            </div>
            <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">
              {{ auth.user?.role || 'LEAVE_ADMIN' }}
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
          class="absolute inset-y-0 left-0 flex w-60 max-w-[70vw] flex-col bg-white dark:bg-slate-950/95 shadow-2xl"
          style="border-right: 1px solid rgb(var(--ui-border));"
        >
          <div class="flex items-center justify-between border-b px-2 py-2" style="border-color: rgb(var(--ui-border));">
            <div class="min-w-0">
              <div class="truncate text-[11px] font-extrabold uppercase tracking-wide text-slate-800 dark:text-slate-100">
                Expat Leave
              </div>
              <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">Admin Portal</div>
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
                <span
                  class="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full"
                  :class="isGroupActive(g) ? 'bg-sky-500' : 'bg-transparent'"
                />
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
                      <div
                        class="truncate text-[12px] font-extrabold"
                        :class="isGroupActive(g) ? 'text-sky-700 dark:text-sky-200' : 'text-slate-800 dark:text-slate-100'"
                      >
                        {{ g.header }}
                      </div>
                      <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">{{ g.children.length }} items</div>
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

          <div v-if="hasContractReminders" class="px-2 pb-2">
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-extrabold text-amber-800
                     hover:bg-amber-100 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-100 dark:hover:bg-amber-950/40"
              @click="handleOpenReminderList"
            >
              <i class="fa-solid fa-bell" />
              <span class="truncate">
                {{ activeReminderCount }} reminder{{ activeReminderCount === 1 ? '' : 's' }}
              </span>
            </button>
          </div>

          <div class="border-t px-2 py-2" style="border-color: rgb(var(--ui-border));">
            <div class="flex items-center gap-2">
              <div class="flex h-9 w-9 items-center justify-center rounded-full bg-sky-600 text-[11px] font-extrabold text-white">
                {{ initials }}
              </div>
              <div class="min-w-0 flex-1">
                <div class="truncate text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                  {{ auth.user?.name || auth.user?.loginId || 'Expat Admin' }}
                </div>
                <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">
                  {{ auth.user?.role || 'LEAVE_ADMIN' }}
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
    <div class="flex flex-1 flex-col min-w-0">
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
        <div class="w-full px-2 sm:px-4 lg:px-6 2xl:px-10 py-3 space-y-3">
          <ContractReminderBanner
            v-if="showContractReminderBanner"
            :reminders="contractReminders"
            :loading="contractReminderLoading"
            @refresh="fetchContractReminders()"
            @open-list="handleOpenReminderList"
            @open-profile="handleOpenReminderProfile"
            @renew="handleRenewReminder"
          />

          <div
            v-if="showContractReminderBanner"
            class="flex justify-end -mt-1"
          >
            <button
              type="button"
              class="ui-btn ui-btn-ghost ui-btn-sm"
              @click="handleDismissReminderBanner"
            >
              <i class="fa-solid fa-eye-slash text-[11px]" />
              Hide banner for now
            </button>
          </div>

          <router-view />
        </div>
      </main>
    </div>

    <ContractReminderList
      :open="contractReminderListOpen"
      :reminders="contractReminders"
      :loading="contractReminderLoading"
      @close="handleCloseReminderList"
      @refresh="fetchContractReminders()"
      @open-profile="handleOpenReminderProfile"
      @renew="handleRenewReminder"
    />

    <RenewModal
      :open="renewModalOpen"
      :submitting="renewSubmitting"
      :error="renewError"
      :currentContractEndDate="renewCurrentContractEndDate"
      :newContractDate="renewForm.newContractDate"
      :clearOldLeave="renewForm.clearOldLeave"
      :note="renewForm.note"
      :employeeId="renewEmployeeId"
      :employeeName="renewEmployeeName"
      @close="closeRenewModal"
      @submit="submitRenewModal"
      @update:clearOldLeave="renewForm.clearOldLeave = $event"
      @update:note="renewForm.note = $event"
    />
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