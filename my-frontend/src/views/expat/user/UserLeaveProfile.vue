<!-- src/views/expat/user/UserLeaveProfile.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/store/auth'
import { subscribeEmployeeIfNeeded, subscribeUserIfNeeded, onSocket } from '@/utils/socket'

defineOptions({ name: 'UserLeaveProfile' })

const { showToast } = useToast()
const auth = useAuth()

/* ───────── small helpers ───────── */
const s = (v) => String(v ?? '').trim()

/* ───────── Identity (✅ IMPORTANT: prefer loginId string, NOT Mongo _id) ───────── */
const employeeId = computed(() =>
  s(auth.user?.employeeId || localStorage.getItem('employeeId') || '')
)

/**
 * ✅ IMPORTANT:
 * - use auth.user.loginId first (your realtime rooms + LeaveRequest store loginId string)
 * - fallback to localStorage loginId
 * - DO NOT prefer auth.user.id because that is often Mongo _id
 */
const loginId = computed(() =>
  s(auth.user?.loginId || localStorage.getItem('loginId') || auth.user?.employeeId || '')
)

/* ───────── responsive ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────── state ───────── */
const loading = ref(false)
const loadError = ref('')
const profile = ref(null)
const lastUpdatedAt = ref('')

function num(v) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/**
 * ✅ IMPORTANT:
 * Trust backend-computed balances. Do NOT recompute remaining here
 * because AL can be negative (SP borrowing + alCarry debt).
 */
const balances = computed(() => {
  const raw = Array.isArray(profile.value?.balances) ? profile.value.balances : []

  const arr = raw.map((b) => ({
    leaveTypeCode: s(b?.leaveTypeCode || '').toUpperCase(),
    yearlyEntitlement: num(b?.yearlyEntitlement),
    used: num(b?.used),
    remaining: num(b?.remaining), // ✅ backend truth (can be negative)
  }))

  const ORDER = ['AL', 'SP', 'MC', 'MA', 'UL']
  arr.sort((a, b) => {
    const ia = ORDER.indexOf(a.leaveTypeCode)
    const ib = ORDER.indexOf(b.leaveTypeCode)
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
    return a.leaveTypeCode.localeCompare(b.leaveTypeCode)
  })

  return arr
})

/* ───────── display rule (✅ only AL shows used/remaining) ───────── */
const SHOW_REMAINING_FOR = new Set(['AL'])

function balText(b) {
  const code = s(b?.leaveTypeCode || '').toUpperCase()
  const used = num(b?.used)
  const remaining = num(b?.remaining)

  // ✅ AL: "used/remaining"
  if (SHOW_REMAINING_FOR.has(code)) return `${used}/${remaining}`

  // ✅ others: show used only (hide remaining)
  return `${used}`
}

function balChipClasses(b) {
  const code = s(b?.leaveTypeCode || '').toUpperCase()

  // ✅ AL keeps the positive/negative color based on remaining
  if (SHOW_REMAINING_FOR.has(code)) {
    return num(b?.remaining) >= 0
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
      : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200'
  }

  // ✅ others: neutral chip (we hide remaining anyway)
  return 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200'
}

/* ───────── contract end + countdown ───────── */
const contractEndYmd = computed(() => {
  const v =
    profile.value?.contractEndDate ||
    profile.value?.contractEnd ||
    profile.value?.contractEndAt ||
    ''
  if (!v) return ''
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD') : ''
})

const contractDaysLeft = computed(() => {
  const ymd = contractEndYmd.value
  if (!ymd) return null
  const end = dayjs(ymd).startOf('day')
  const now = dayjs().startOf('day')
  return end.diff(now, 'day') // can be negative
})

function countdownLabel(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) return '—'
  if (daysLeft < 0) return `Expired ${Math.abs(daysLeft)}d`
  return `${daysLeft}d`
}

/**
 * rule:
 * - <= 30 days : RED warning
 * - 31..200 days: AMBER
 * - > 200 days : GREEN
 * - expired (<0) : RED
 */
function countdownClasses(daysLeft) {
  if (daysLeft === null || daysLeft === undefined) {
    return 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200'
  }
  if (daysLeft < 0 || daysLeft <= 30) {
    return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200'
  }
  if (daysLeft <= 200) {
    return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
  }
  return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
}

async function fetchMyProfile(silent = false) {
  try {
    loading.value = true
    loadError.value = ''

    const res = await api.get('/leave/profile/my')

    // Accept either { ...profile } or { profile: {...} }
    profile.value = res?.data?.profile || res?.data || null
    lastUpdatedAt.value = dayjs().toISOString()
  } catch (e) {
    console.error('fetchMyProfile error', e)
    loadError.value = e?.response?.data?.message || 'Unable to load your leave balance.'

    if (!silent) {
      showToast({
        type: 'error',
        title: 'Failed to load',
        message: loadError.value,
      })
    }
  } finally {
    loading.value = false
  }
}

/* ───────── realtime refresh ───────── */
function isMyDoc(payload = {}) {
  const myEmp = s(employeeId.value)
  const myLogin = s(loginId.value)

  const pEmp = s(payload.employeeId || payload.profileEmployeeId || payload.empId || '')
  const pLogin = s(
    payload.requesterLoginId ||
      payload.loginId ||
      payload.actorLoginId ||
      payload.userLoginId ||
      ''
  )

  return (myEmp && pEmp && pEmp === myEmp) || (myLogin && pLogin && pLogin === myLogin)
}

let refreshTimer = null
function triggerRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    fetchMyProfile(true)
  }, 180)
}

const offHandlers = []
function setupRealtime() {
  // ✅ Subscribe to BOTH employee + user rooms (if available)
  if (employeeId.value) subscribeEmployeeIfNeeded(employeeId.value)
  if (loginId.value) subscribeUserIfNeeded(loginId.value)

  offHandlers.push(
    onSocket('leave:req:created', (p) => { if (isMyDoc(p)) triggerRefresh() }),
    onSocket('leave:req:manager-decision', (p) => { if (isMyDoc(p)) triggerRefresh() }),
    onSocket('leave:req:gm-decision', (p) => { if (isMyDoc(p)) triggerRefresh() }),
    onSocket('leave:req:updated', (p) => { if (isMyDoc(p)) triggerRefresh() }),
    onSocket('leave:profile:updated', (p) => { if (isMyDoc(p)) triggerRefresh() })
  )
}

onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)

  await fetchMyProfile()
  setupRealtime()
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
  if (refreshTimer) clearTimeout(refreshTimer)

  offHandlers.forEach((off) => {
    try { off && off() } catch {}
  })
})
</script>

<template>
  <div
    class="rounded-2xl border border-slate-200 bg-white shadow-sm
           dark:border-slate-800 dark:bg-slate-900"
  >
    <!-- Header -->
    <div
      class="rounded-t-2xl bg-gradient-to-r from-indigo-600 via-sky-500 to-cyan-500
             px-4 py-3 text-white"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-[220px]">
          <div class="mt-0.5 flex items-center gap-2">
            <p class="text-sm font-semibold">My Leave Balance</p>
            <span
              class="inline-flex items-center rounded-full border border-white/25 bg-white/10
                     px-2 py-0.5 text-[10px] font-semibold"
            >
              Read-only
            </span>

            <!-- ✅ contract countdown badge -->
            <span
              v-if="contractEndYmd"
              class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold"
              :class="countdownClasses(contractDaysLeft)"
              title="Contract end countdown"
            >
              <i class="fa-regular fa-clock mr-1 text-[10px]" />
              {{ countdownLabel(contractDaysLeft) }}
            </span>
          </div>

          <p class="mt-1 text-[11px] text-white/90">
            Check remaining days before you submit a new leave request.
          </p>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10
                   px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15
                   disabled:opacity-60 disabled:cursor-not-allowed"
            :disabled="loading"
            @click="fetchMyProfile()"
          >
            <i class="fa-solid fa-rotate text-[11px]" :class="loading ? 'fa-spin' : ''" />
            Refresh
          </button>
        </div>
      </div>
    </div>

    <!-- Body -->
    <div class="px-2 pb-2 pt-3 sm:px-3 sm:pb-3">
      <!-- Error -->
      <div
        v-if="loadError"
        class="mb-2 rounded-md border border-rose-400 bg-rose-50 px-3 py-2 text-[11px] text-rose-700
               dark:border-rose-500/70 dark:bg-rose-950/40 dark:text-rose-100"
      >
        {{ loadError }}
      </div>

      <!-- Skeleton -->
      <div v-if="loading && !profile" class="space-y-2">
        <div class="h-9 w-full animate-pulse rounded-xl bg-slate-200/90 dark:bg-slate-800/70" />
        <div class="h-24 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/60" />
      </div>

      <div v-else>
        <!-- Meta -->
        <div
          class="mb-2 grid gap-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 text-[11px] text-slate-600
                 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-300 sm:grid-cols-6"
        >
          <div class="min-w-0 sm:col-span-2">
            <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
              Employee
            </div>
            <div class="mt-1 font-mono text-[12px] text-slate-900 dark:text-slate-50">
              {{ profile?.employeeId || employeeId || '—' }}
            </div>
            <div v-if="profile?.employeeName" class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {{ profile.employeeName }}
            </div>
          </div>

          <div class="min-w-0">
            <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
              Join date
            </div>
            <div class="mt-1 font-semibold text-slate-900 dark:text-slate-50">
              {{ profile?.joinDate ? dayjs(profile.joinDate).format('YYYY-MM-DD') : '—' }}
            </div>
          </div>

          <div class="min-w-0">
            <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
              Contract date
            </div>
            <div class="mt-1 font-semibold text-slate-900 dark:text-slate-50">
              {{ profile?.contractDate ? dayjs(profile.contractDate).format('YYYY-MM-DD') : '—' }}
            </div>
          </div>

          <!-- ✅ Contract end date -->
          <div class="min-w-0">
            <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
              Contract end
            </div>
            <div class="mt-1 font-semibold text-slate-900 dark:text-slate-50">
              {{ contractEndYmd || '—' }}
            </div>
          </div>

          <!-- ✅ Countdown -->
          <div class="min-w-0">
            <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
              Days left
            </div>
            <div class="mt-1">
              <span
                class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums"
                :class="countdownClasses(contractDaysLeft)"
              >
                <i class="fa-regular fa-clock mr-1 text-[10px]" />
                {{ countdownLabel(contractDaysLeft) }}
              </span>
            </div>
            <div v-if="contractDaysLeft !== null && contractDaysLeft <= 30" class="mt-0.5 text-[10px] text-rose-600 dark:text-rose-400">
              Warning: contract ending soon
            </div>
          </div>

          <!-- Existing field -->
          <div class="min-w-0 sm:col-span-2">
            <div class="text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">
              Annual leave used
            </div>
            <div
              class="mt-1 font-semibold"
              :class="num(profile?.alCarry) < 0
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-slate-900 dark:text-slate-50'"
            >
              {{ num(profile?.alCarry) }}
            </div>
          </div>

          <div v-if="lastUpdatedAt" class="sm:col-span-6 mt-1 text-[10px] text-slate-500 dark:text-slate-400">
            Last updated: {{ dayjs(lastUpdatedAt).format('YYYY-MM-DD HH:mm') }}
          </div>
        </div>

        <p v-if="!balances.length" class="py-4 text-center text-[11px] text-slate-500 dark:text-slate-400">
          No leave balance data found.
        </p>

        <!-- Mobile cards -->
        <div v-else-if="isMobile" class="space-y-2">
          <article
            v-for="b in balances"
            :key="b.leaveTypeCode"
            class="rounded-2xl border border-slate-200 bg-white/95 p-3 text-xs shadow-[0_10px_24px_rgba(15,23,42,0.12)]
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

                <!-- <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Entitlement:
                  <span class="font-semibold text-slate-900 dark:text-slate-50 tabular-nums">
                    {{ b.yearlyEntitlement }}
                  </span>
                </div> -->
              </div>

              <!-- ✅ AL shows used/remaining, others show used only -->
              <div class="text-right">
                <div class="text-[11px] text-slate-500 dark:text-slate-400">
                  {{ b.leaveTypeCode === 'AL' ? 'Balance (U/R)' : 'Used' }}
                </div>
                <span
                  class="mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums"
                  :class="balChipClasses(b)"
                >
                  {{ balText(b) }}
                </span>
              </div>
            </div>
          </article>
        </div>

        <!-- Desktop table -->
        <div v-else class="overflow-x-auto">
          <table class="min-w-[720px] w-full table-fixed text-left text-xs sm:text-[13px] text-slate-700 dark:text-slate-100">
            <colgroup>
              <col style="width: 140px" />
              <col style="width: 240px" />
            </colgroup>

            <thead
              class="bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-500
                     border-b border-slate-200
                     dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-300"
            >
              <tr>
                <th class="table-th">Type</th>
                <th class="table-th text-right">Used / Balance</th>
              </tr>
            </thead>

            <tbody>
              <tr
                v-for="b in balances"
                :key="b.leaveTypeCode"
                class="border-b border-slate-200 text-[12px]
                       hover:bg-slate-50/80
                       dark:border-slate-700 dark:hover:bg-slate-900/70"
              >
                <td class="table-td">
                  <span
                    class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px]
                           font-semibold text-slate-800 border border-slate-200
                           dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700"
                  >
                    {{ b.leaveTypeCode }}
                  </span>
                </td>

                <td class="table-td text-right">
                  <div class="flex justify-end">
                    <span
                      class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tabular-nums"
                      :class="balChipClasses(b)"
                      :title="b.leaveTypeCode === 'AL' ? 'Used/Remaining' : 'Used only'"
                    >
                      {{ balText(b) }}
                    </span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
          If your remaining looks incorrect, please contact HR/Admin (this view is read-only).
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
</style>
