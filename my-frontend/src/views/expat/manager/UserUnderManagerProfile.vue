<!-- src/views/expat/manager/UserUnderManagerProfile.vue
  ✅ Manager view: list employees under this manager + view employee leave balances (read-only)
  ✅ Supports user has 2 roles (manager + employee) safely
  ✅ Uses your endpoints:
      - GET /api/leave/user/profile/managed   (list)
      - GET /api/leave/user/profile?employeeId=... (detail)
  ✅ Realtime refresh (optional) via socket rooms:
      - user:<loginId>
      - employee:<employeeId> (when in detail)
  ✅ Tailwind fullscreen feel (no wasted edges), dark mode
  ✅ No SweetAlert / no window alert (useToast)
-->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/store/auth'
import { subscribeEmployeeIfNeeded, subscribeUserIfNeeded, onSocket } from '@/utils/socket'

defineOptions({ name: 'UserUnderManagerProfile' })

const { showToast } = useToast()
const auth = useAuth()
const route = useRoute()
const router = useRouter()

/* ───────── Identity ───────── */
const loginId = computed(() =>
  String(auth.user?.loginId || auth.user?.id || localStorage.getItem('loginId') || '').trim()
)

/* ───────── responsive ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────── mode ───────── */
const targetEmployeeId = computed(() => String(route.query?.employeeId || '').trim())
const isDetailMode = computed(() => !!targetEmployeeId.value)

/* ───────── list state ───────── */
const listLoading = ref(false)
const listError = ref('')
const rows = ref([]) // managed employees
const q = ref('')

async function fetchManagedList(silent = false) {
  try {
    listLoading.value = true
    listError.value = ''

    // ✅ endpoint you added: /api/leave/user/profile/managed
    const res = await api.get('/leave/user/profile/managed')

    // Accept either [] or { rows: [] }
    const data = res?.data
    rows.value = Array.isArray(data?.rows) ? data.rows : Array.isArray(data) ? data : []
  } catch (e) {
    console.error('fetchManagedList error', e)
    listError.value = e?.response?.data?.message || 'Unable to load employees.'
    if (!silent) showToast({ type: 'error', title: 'Failed to load', message: listError.value })
  } finally {
    listLoading.value = false
  }
}

const filteredRows = computed(() => {
  const s = q.value.trim().toLowerCase()
  if (!s) return rows.value
  return rows.value.filter((r) => {
    const a = String(r.employeeId || '').toLowerCase()
    const b = String(r.name || '').toLowerCase()
    const c = String(r.department || '').toLowerCase()
    return a.includes(s) || b.includes(s) || c.includes(s)
  })
})

function openDetail(employeeId) {
  router.push({ path: route.path, query: { employeeId: String(employeeId) } })
}
function backToList() {
  router.push({ path: route.path, query: {} })
}

/* ───────── detail state ───────── */
const loading = ref(false)
const loadError = ref('')
const profile = ref(null)
const lastUpdatedAt = ref('')

function num(v) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}
function fmtYMD(v) {
  if (!v) return '—'
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD') : '—'
}

/**
 * ✅ IMPORTANT:
 * Trust backend remaining (can be negative for AL debt / SP borrowing).
 * DO NOT clamp to 0.
 */
const balances = computed(() => {
  const raw = Array.isArray(profile.value?.balances) ? profile.value.balances : []

  const arr = raw
    .map((b) => ({
      leaveTypeCode: String(b?.leaveTypeCode || '').toUpperCase(),
      yearlyEntitlement: num(b?.yearlyEntitlement),
      used: num(b?.used),
      remaining:
        b?.remaining != null
          ? num(b.remaining) // ✅ backend truth (can be negative)
          : num(b?.yearlyEntitlement) - num(b?.used), // fallback (no clamp)
    }))
    .filter((x) => x.leaveTypeCode)

  const ORDER = ['AL', 'SP', 'MC', 'MA', 'UL']
  arr.sort((a, b) => {
    const ia = ORDER.indexOf(a.leaveTypeCode)
    const ib = ORDER.indexOf(b.leaveTypeCode)
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
    return a.leaveTypeCode.localeCompare(b.leaveTypeCode)
  })

  return arr
})

/* ───────── Contract end + days left (LIST + DETAIL) ───────── */
function pickContractEnd(obj = {}) {
  return (
    obj.contractEndDate ||
    obj.contractEnd ||
    obj.contractEndAt ||
    obj.currentContractEnd ||
    obj.currentContract?.endDate ||
    obj.currentContract?.end ||
    obj.latestContractEnd ||
    ''
  )
}
function contractEndYmdFrom(obj = {}) {
  const v = pickContractEnd(obj)
  if (!v) return ''
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD') : ''
}
function daysLeftFromEndYmd(endYmd) {
  if (!endYmd) return null
  const end = dayjs(endYmd).startOf('day')
  const now = dayjs().startOf('day')
  return end.diff(now, 'day')
}
function daysLeftLabel(daysLeft) {
  if (daysLeft == null) return '—'
  if (daysLeft < 0) return `Expired ${Math.abs(daysLeft)}d`
  return `${daysLeft}d`
}
function daysLeftClass(daysLeft) {
  if (daysLeft == null) {
    return 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100'
  }
  if (daysLeft < 0 || daysLeft <= 30) {
    return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200'
  }
  if (daysLeft <= 200) {
    return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
  }
  return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
}

/* Detail computed */
const detailContractEndYmd = computed(() => contractEndYmdFrom(profile.value || {}))
const detailDaysLeft = computed(() => daysLeftFromEndYmd(detailContractEndYmd.value))

async function fetchEmployeeProfile(silent = false) {
  if (!targetEmployeeId.value) {
    profile.value = null
    loadError.value = ''
    return
  }

  try {
    loading.value = true
    loadError.value = ''

    // ✅ manager view uses same user profile endpoint but with employeeId param
    const res = await api.get('/leave/user/profile', {
      params: { employeeId: targetEmployeeId.value },
    })

    // Accept either { profile: {...} } OR direct profile object
    profile.value = res?.data?.profile || res?.data?.data?.profile || res?.data || null
    lastUpdatedAt.value = dayjs().toISOString()
  } catch (e) {
    console.error('fetchEmployeeProfile error', e)
    loadError.value = e?.response?.data?.message || 'Unable to load leave balance.'
    if (!silent) showToast({ type: 'error', title: 'Failed to load', message: loadError.value })
  } finally {
    loading.value = false
  }
}

/* ───────── realtime (detail only) ───────── */
function isTargetDoc(payload = {}) {
  const emp = String(payload.employeeId || '')
  return targetEmployeeId.value && emp === targetEmployeeId.value
}

let refreshTimer = null
function triggerRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => fetchEmployeeProfile(true), 180)
}

const offHandlers = []
function setupRealtime() {
  if (loginId.value) subscribeUserIfNeeded(loginId.value)
  if (targetEmployeeId.value) subscribeEmployeeIfNeeded(targetEmployeeId.value)

  offHandlers.push(
    onSocket('leave:req:created', (p) => isTargetDoc(p) && triggerRefresh()),
    onSocket('leave:req:manager-decision', (p) => isTargetDoc(p) && triggerRefresh()),
    onSocket('leave:req:gm-decision', (p) => isTargetDoc(p) && triggerRefresh()),
    onSocket('leave:req:coo-decision', (p) => isTargetDoc(p) && triggerRefresh()),
    onSocket('leave:req:updated', (p) => isTargetDoc(p) && triggerRefresh()),
    onSocket('leave:profile:updated', (p) => isTargetDoc(p) && triggerRefresh()),
    onSocket('leave:profile:recalculated', (p) => isTargetDoc(p) && triggerRefresh())
  )
}
function teardownRealtime() {
  offHandlers.forEach((off) => {
    try {
      off && off()
    } catch {}
  })
  offHandlers.length = 0
}

/* ───────── lifecycle ───────── */
onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)

  // join personal room always (dual role safe)
  if (loginId.value) subscribeUserIfNeeded(loginId.value)

  await fetchManagedList(true)

  if (isDetailMode.value) {
    await fetchEmployeeProfile(true)
    setupRealtime()
  }
})

watch(
  () => targetEmployeeId.value,
  async () => {
    teardownRealtime()
    await fetchEmployeeProfile(true)
    if (isDetailMode.value) setupRealtime()
  }
)

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
  if (refreshTimer) clearTimeout(refreshTimer)
  teardownRealtime()
})
</script>

<template>
  <!-- Full width, no wasted edges -->
  <div class="w-full">
    <div class="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <!-- Header -->
      <div class="rounded-t-2xl ui-hero-gradient">
        <div class="flex flex-wrap items-start justify-between gap-3 px-3 py-3 sm:px-4 sm:py-4">
          <div class="min-w-[220px]">
            <p class="text-[10px] uppercase tracking-[0.35em] font-semibold text-white/90">
              Manager · Expat leave
            </p>

            <div class="mt-0.5 flex items-center gap-2">
              <p class="text-sm font-semibold text-white">
                {{ isDetailMode ? 'Employee Leave Balance' : 'Employees Under Me' }}
              </p>
              <span
                class="inline-flex items-center rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white"
              >
                Read-only (review)
              </span>
            </div>

            <p class="mt-1 text-[11px] text-white/90">
              {{
                isDetailMode
                  ? 'Review remaining days before you approve or reject the request.'
                  : 'List of employees who report to you. Click View to open leave balance.'
              }}
            </p>
          </div>

          <div class="flex items-center gap-2">
            <button
              v-if="isDetailMode"
              type="button"
              class="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15"
              @click="backToList()"
            >
              <i class="fa-solid fa-arrow-left text-[11px]" />
              Back to list
            </button>

            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15 disabled:opacity-60 disabled:cursor-not-allowed"
              :disabled="isDetailMode ? loading : listLoading"
              @click="isDetailMode ? fetchEmployeeProfile() : fetchManagedList()"
            >
              <i
                class="fa-solid fa-rotate text-[11px]"
                :class="(isDetailMode ? loading : listLoading) ? 'fa-spin' : ''"
              />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <!-- Body -->
      <div class="px-2 pb-2 pt-3 sm:px-3 sm:pb-3">
        <!-- LIST MODE -->
        <div v-if="!isDetailMode">
          <div class="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div class="relative w-full sm:max-w-md">
              <i
                class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"
              />
              <input
                v-model="q"
                type="text"
                placeholder="Search employeeId / name / department"
                class="w-full rounded-xl border border-slate-200 bg-white px-9 py-2 text-xs text-slate-800
                       shadow-sm outline-none focus:ring-2 focus:ring-sky-300
                       dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:focus:ring-sky-700"
              />
            </div>

            <div class="text-[11px] text-slate-500 dark:text-slate-400">
              Total:
              <span class="font-semibold text-slate-800 dark:text-slate-100">{{ filteredRows.length }}</span>
            </div>
          </div>

          <div
            v-if="listError"
            class="mb-2 rounded-md border border-rose-400 bg-rose-50 px-3 py-2 text-[11px]
                   text-rose-700 dark:border-rose-500/70 dark:bg-rose-950/40 dark:text-rose-100"
          >
            {{ listError }}
          </div>

          <div v-if="listLoading" class="space-y-2">
            <div class="h-9 w-full animate-pulse rounded-xl bg-slate-200/90 dark:bg-slate-800/70" />
            <div class="h-24 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/60" />
          </div>

          <p v-else-if="!filteredRows.length" class="py-6 text-center text-[11px] text-slate-500 dark:text-slate-400">
            No employees found.
          </p>

          <!-- Mobile cards -->
          <div v-else-if="isMobile" class="space-y-2">
            <article
              v-for="r in filteredRows"
              :key="r.employeeId"
              class="rounded-2xl border border-slate-200 bg-white/95 p-3 text-xs
                     shadow-[0_10px_24px_rgba(15,23,42,0.12)]
                     dark:border-slate-700 dark:bg-slate-900/95"
            >
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">{{ r.employeeId }}</div>
                  <div class="mt-0.5 font-semibold text-slate-900 dark:text-slate-50">{{ r.name || '—' }}</div>
                  <div class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{{ r.department || '—' }}</div>
                </div>

                <button
                  class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px]
                         font-semibold text-slate-800 hover:bg-slate-50
                         dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:hover:bg-slate-900/60"
                  @click="openDetail(r.employeeId)"
                >
                  <i class="fa-solid fa-eye text-[11px]" />
                  View
                </button>
              </div>

              <div class="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <div>
                  Join:
                  <span class="text-slate-800 dark:text-slate-100 font-semibold">
                    {{ r.joinDate ? dayjs(r.joinDate).format('YYYY-MM-DD') : '—' }}
                  </span>
                </div>
                <div>
                  Contract:
                  <span class="text-slate-800 dark:text-slate-100 font-semibold">
                    {{ r.contractDate ? dayjs(r.contractDate).format('YYYY-MM-DD') : '—' }}
                  </span>
                </div>

                <div class="col-span-2 flex items-center justify-between">
                  <div>
                    End:
                    <span class="font-semibold text-slate-800 dark:text-slate-100">
                      {{ contractEndYmdFrom(r) || '—' }}
                    </span>
                  </div>
                  <span
                    class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums"
                    :class="daysLeftClass(daysLeftFromEndYmd(contractEndYmdFrom(r)))"
                  >
                    <i class="fa-regular fa-clock mr-1 text-[10px]" />
                    {{ daysLeftLabel(daysLeftFromEndYmd(contractEndYmdFrom(r))) }}
                  </span>
                </div>
              </div>
            </article>
          </div>

          <!-- Desktop table -->
          <div v-else class="overflow-x-auto">
            <table class="min-w-[1050px] w-full text-left text-xs sm:text-[13px] text-slate-700 dark:text-slate-100">
              <thead
                class="bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200
                       dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-300"
              >
                <tr>
                  <th class="table-th">Employee ID</th>
                  <th class="table-th">Name</th>
                  <th class="table-th">Department</th>
                  <th class="table-th">Join date</th>
                  <th class="table-th">Contract date</th>
                  <th class="table-th">Contract end</th>
                  <th class="table-th text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="r in filteredRows"
                  :key="r.employeeId"
                  class="border-b border-slate-200 text-[12px] hover:bg-slate-50/80
                         dark:border-slate-700 dark:hover:bg-slate-900/70"
                >
                  <td class="table-td font-semibold">{{ r.employeeId }}</td>
                  <td class="table-td">{{ r.name || '—' }}</td>
                  <td class="table-td">{{ r.department || '—' }}</td>
                  <td class="table-td">{{ r.joinDate ? dayjs(r.joinDate).format('YYYY-MM-DD') : '—' }}</td>
                  <td class="table-td">{{ r.contractDate ? dayjs(r.contractDate).format('YYYY-MM-DD') : '—' }}</td>
                  <td class="table-td">{{ contractEndYmdFrom(r) || '—' }}</td>

                  <td class="table-td text-right">
                    <button
                      class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px]
                             font-semibold text-slate-800 hover:bg-slate-50
                             dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:hover:bg-slate-900/60"
                      @click="openDetail(r.employeeId)"
                    >
                      <i class="fa-solid fa-eye text-[11px]" />
                      View
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
            Read-only list. Click “View” to open employee leave balance.
          </div>
        </div>

        <!-- DETAIL MODE -->
        <div v-else>
          <div
            v-if="loadError"
            class="mb-2 rounded-md border border-rose-400 bg-rose-50 px-3 py-2 text-[11px]
                   text-rose-700 dark:border-rose-500/70 dark:bg-rose-950/40 dark:text-rose-100"
          >
            {{ loadError }}
          </div>

          <div v-if="loading && !profile" class="space-y-2">
            <div class="h-9 w-full animate-pulse rounded-xl bg-slate-200/90 dark:bg-slate-800/70" />
            <div class="h-24 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/60" />
          </div>

          <div v-else>
            <!-- Detail meta -->
            <div
              class="mb-2 grid gap-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-3
                     text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-300 sm:grid-cols-5"
            >
              <div class="flex items-center justify-between sm:block">
                <div class="font-semibold text-slate-800 dark:text-slate-100">Employee</div>
                <div>{{ profile?.employeeId || targetEmployeeId || '—' }}</div>
              </div>

              <div class="flex items-center justify-between sm:block">
                <div class="font-semibold text-slate-800 dark:text-slate-100">Join date</div>
                <div>{{ profile?.joinDate ? dayjs(profile.joinDate).format('YYYY-MM-DD') : '—' }}</div>
              </div>

              <div class="flex items-center justify-between sm:block">
                <div class="font-semibold text-slate-800 dark:text-slate-100">Contract date</div>
                <div>{{ profile?.contractDate ? dayjs(profile.contractDate).format('YYYY-MM-DD') : '—' }}</div>
              </div>

              <div class="flex items-center justify-between sm:block">
                <div class="font-semibold text-slate-800 dark:text-slate-100">Contract end</div>
                <div class="font-semibold text-slate-900 dark:text-slate-50">{{ detailContractEndYmd || '—' }}</div>
              </div>

              <div class="flex items-center justify-between sm:block">
                <div class="font-semibold text-slate-800 dark:text-slate-100">Days left</div>
                <div class="flex justify-end sm:justify-start">
                  <span
                    class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums"
                    :class="daysLeftClass(detailDaysLeft)"
                  >
                    <i class="fa-regular fa-clock mr-1 text-[10px]" />
                    {{ daysLeftLabel(detailDaysLeft) }}
                  </span>
                </div>
              </div>

              <div v-if="lastUpdatedAt" class="sm:col-span-5 text-[10px] text-slate-500 dark:text-slate-400">
                Last updated: {{ dayjs(lastUpdatedAt).format('YYYY-MM-DD HH:mm') }}
              </div>
            </div>

            <!-- Balances -->
            <p v-if="!balances.length" class="py-4 text-center text-[11px] text-slate-500 dark:text-slate-400">
              No leave balance data found.
            </p>

            <!-- Mobile balances -->
            <div v-else-if="isMobile" class="space-y-2">
              <article
                v-for="b in balances"
                :key="b.leaveTypeCode"
                class="rounded-2xl border border-slate-200 bg-white/95 p-3 text-xs
                       shadow-[0_10px_24px_rgba(15,23,42,0.12)]
                       dark:border-slate-700 dark:bg-slate-900/95"
              >
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <span
                      class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px]
                             font-semibold text-slate-800 border border-slate-200
                             dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700"
                    >
                      {{ b.leaveTypeCode }}
                    </span>
                    <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      Entitlement:
                      <span class="font-semibold text-slate-900 dark:text-slate-50">{{ b.yearlyEntitlement }}</span>
                    </div>
                  </div>

                  <div class="text-right text-[11px]">
                    <div class="text-slate-500 dark:text-slate-400">
                      Used:
                      <span class="font-semibold text-slate-900 dark:text-slate-50">{{ b.used }}</span>
                    </div>
                    <div class="mt-0.5">
                      <span class="text-slate-500 dark:text-slate-400">Remaining:</span>
                      <span
                        class="ml-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                        :class="b.remaining > 0
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                          : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200'"
                      >
                        {{ b.remaining }}
                      </span>
                    </div>
                  </div>
                </div>
              </article>
            </div>

            <!-- Desktop balances -->
            <div v-else class="overflow-x-auto">
              <table class="min-w-[760px] w-full table-fixed text-left text-xs sm:text-[13px] text-slate-700 dark:text-slate-100">
                <thead
                  class="bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-500
                        border-b border-slate-200 dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-300"
                >
                  <tr>
                    <th class="table-th">Type</th>
                    <th class="table-th text-right">Used</th>
                    <th class="table-th text-right">Remaining</th>
                  </tr>
                </thead>

                <tbody>
                  <tr
                    v-for="b in balances"
                    :key="b.leaveTypeCode"
                    class="border-b border-slate-200 text-[12px] hover:bg-slate-50/80
                          dark:border-slate-700 dark:hover:bg-slate-900/70"
                  >
                    <td class="table-td align-middle">
                      <span
                        class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px]
                              font-semibold text-slate-800 border border-slate-200
                              dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700"
                      >
                        {{ b.leaveTypeCode }}
                      </span>
                    </td>

                    <td class="table-td text-right tabular-nums align-middle">{{ b.used }}</td>

                    <td class="table-td text-right align-middle">
                      <div class="flex justify-end">
                        <span
                          class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px]
                                font-semibold tabular-nums"
                          :class="b.remaining > 0
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                            : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200'"
                        >
                          {{ b.remaining }}
                        </span>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
              Read-only. Use this to verify balance before approve/reject in the inbox.
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Keep table spacing consistent */
.table-th {
  padding: 8px 10px;
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
}
.table-td {
  padding: 8px 10px;
  vertical-align: middle;
}

/* Premium gradient header (match your admin style vibe) */
.ui-hero-gradient {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.95), rgba(14, 165, 233, 0.92));
  padding: 0;
}
</style>
