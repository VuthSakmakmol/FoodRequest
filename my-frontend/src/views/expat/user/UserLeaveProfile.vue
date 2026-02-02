<!-- src/views/expat/user/UserLeaveProfile.vue
  ✅ Employee/User self leave profile (read-only)
  ✅ Tailwind gradient header + mobile cards + desktop table
  ✅ Shows contract end + days left + contract history (if backend provides)
  ✅ Realtime refresh via socket rooms (user:<loginId> + employee:<employeeId>)
  ✅ No SweetAlert / no window alert (uses useToast)
-->
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

/* ───────── base state ───────── */
const loading = ref(false)
const error = ref('')
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
      leaveTypeCode: String(b?.leaveTypeCode || b?.code || '').toUpperCase(),
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

/* ───────── Contract end + days left ───────── */
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

const detailContractEndYmd = computed(() => contractEndYmdFrom(profile.value || {}))
const detailDaysLeft = computed(() => daysLeftFromEndYmd(detailContractEndYmd.value))

/* ───────── Contract history ───────── */
const contractsLoading = ref(false)
const contractsError = ref('')
const contracts = ref([])
const expandedContractId = ref('')

function normalizeBalancesLike(arr) {
  const raw = Array.isArray(arr) ? arr : []
  return raw
    .map((b) => ({
      leaveTypeCode: String(b?.leaveTypeCode || b?.code || '').toUpperCase(),
      used: num(b?.used),
      remaining: b?.remaining != null ? num(b.remaining) : null,
      yearlyEntitlement: b?.yearlyEntitlement != null ? num(b.yearlyEntitlement) : null,
    }))
    .filter((x) => x.leaveTypeCode)
}

function normalizeContracts(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.contracts) ? raw.contracts : []
  const mapped = list.map((c, idx) => {
    const id = String(c?._id || c?.id || c?.contractId || `${idx}`)
    const start =
      c?.startDate || c?.contractDate || c?.newContractDate || c?.fromDate || c?.from || c?.start || null
    const end = c?.endDate || c?.contractEndDate || c?.toDate || c?.to || c?.end || null
    const note = String(c?.note || c?.remark || '')
    const b = c?.balances || c?.balanceSnapshot || c?.leaveBalances || c?.leaveUsed || c?.summaryBalances || null

    return {
      id,
      startDate: start,
      endDate: end,
      note,
      createdAt: c?.createdAt || c?.created_at || null,
      balances: normalizeBalancesLike(b),
      raw: c,
    }
  })

  mapped.sort((a, b) => {
    const da = a.startDate ? dayjs(a.startDate).valueOf() : 0
    const db = b.startDate ? dayjs(b.startDate).valueOf() : 0
    return da - db
  })

  return mapped
}

function contractUsedChips(c) {
  if (!Array.isArray(c?.balances) || !c.balances.length) return []
  const ORDER = ['AL', 'SP', 'MC', 'MA', 'UL']
  const arr = [...c.balances]
  arr.sort((a, b) => {
    const ia = ORDER.indexOf(a.leaveTypeCode)
    const ib = ORDER.indexOf(b.leaveTypeCode)
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
    return a.leaveTypeCode.localeCompare(b.leaveTypeCode)
  })
  return arr.map((b) => `${b.leaveTypeCode}: ${num(b.used)}`)
}

function toggleContract(id) {
  expandedContractId.value = expandedContractId.value === id ? '' : id
}

async function fetchContracts(silent = false) {
  // 1) embedded inside profile
  const embedded =
    profile.value?.contracts ||
    profile.value?.contractHistory ||
    profile.value?.contractHistories ||
    profile.value?.contractPeriods ||
    null

  if (embedded && (Array.isArray(embedded) ? embedded.length : Array.isArray(embedded?.contracts))) {
    contracts.value = normalizeContracts(embedded)
    contractsError.value = ''
    return
  }

  // 2) try endpoint (if exists)
  try {
    contractsLoading.value = true
    contractsError.value = ''

    const res = await api.get('/leave/profile/contracts', {
      params: { employeeId: String(profile.value?.employeeId || loginId.value || '').trim() },
    })

    contracts.value = normalizeContracts(res?.data || [])
  } catch (e) {
    const status = e?.response?.status
    const msg = e?.response?.data?.message || e?.message || ''

    if (status === 404) {
      contracts.value = []
      contractsError.value = ''
      return
    }

    contractsError.value = msg || 'Unable to load contracts.'
    if (!silent) showToast({ type: 'error', title: 'Failed to load contracts', message: contractsError.value })
  } finally {
    contractsLoading.value = false
  }
}

/* ───────── Fetch profile ───────── */
async function fetchMyProfile(silent = false) {
  try {
    loading.value = true
    error.value = ''

    // Accept both backend styles:
    // - /leave/profile/my (auth-based)
    // - /leave/profile/my?employeeId=xxxx (some older impls)
    const res = await api.get('/leave/profile/my', {
      params: loginId.value ? { employeeId: loginId.value } : {},
    })

    profile.value = res?.data?.profile || res?.data || null
    lastUpdatedAt.value = dayjs().toISOString()

    await fetchContracts(true)
  } catch (e) {
    console.error('fetchMyProfile error', e)
    error.value = e?.response?.data?.message || 'Unable to load leave profile.'
    if (!silent) showToast({ type: 'error', title: 'Failed to load', message: error.value })
  } finally {
    loading.value = false
  }
}

/* ───────── realtime ───────── */
function myEmployeeId() {
  return String(profile.value?.employeeId || loginId.value || '').trim()
}
function isMyDoc(payload = {}) {
  const emp = String(payload.employeeId || '').trim()
  return !!emp && emp === myEmployeeId()
}

let refreshTimer = null
function triggerRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => fetchMyProfile(true), 180)
}

const offHandlers = []
function setupRealtime() {
  if (loginId.value) subscribeUserIfNeeded(loginId.value)
  const eid = myEmployeeId()
  if (eid) subscribeEmployeeIfNeeded(eid)

  offHandlers.push(
    onSocket('leave:req:created', (p) => isMyDoc(p) && triggerRefresh()),
    onSocket('leave:req:updated', (p) => isMyDoc(p) && triggerRefresh()),
    onSocket('leave:req:manager-decision', (p) => isMyDoc(p) && triggerRefresh()),
    onSocket('leave:req:gm-decision', (p) => isMyDoc(p) && triggerRefresh()),
    onSocket('leave:req:coo-decision', (p) => isMyDoc(p) && triggerRefresh()),
    onSocket('leave:profile:updated', (p) => isMyDoc(p) && triggerRefresh()),
    onSocket('leave:profile:recalculated', (p) => isMyDoc(p) && triggerRefresh())
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

  await fetchMyProfile(true)
  setupRealtime()
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
  if (refreshTimer) clearTimeout(refreshTimer)
  teardownRealtime()
})
</script>

<template>
  <div class="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
    <!-- Header -->
    <div class="rounded-t-2xl ui-hero-gradient">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-[240px]">
          <p class="text-[10px] uppercase tracking-[0.35em] font-semibold text-white/90">
            Employee · Expat leave
          </p>

          <div class="mt-0.5 flex items-center gap-2">
            <p class="text-sm font-semibold">My Leave Profile</p>
            <span
              class="inline-flex items-center rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-[10px] font-semibold"
            >
              Read-only
            </span>
          </div>

          <p class="mt-1 text-[11px] text-white/90">
            Review remaining days and contract period. Balances may be negative when SP borrows from AL.
          </p>
        </div>

        <div class="flex items-center gap-2">
          <span
            class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tabular-nums"
            :class="daysLeftClass(detailDaysLeft)"
          >
            <i class="fa-regular fa-clock mr-1 text-[10px]" />
            {{ daysLeftLabel(detailDaysLeft) }}
          </span>

          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px]
                   font-semibold text-white hover:bg-white/15 disabled:opacity-60 disabled:cursor-not-allowed"
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
      <div
        v-if="error"
        class="mb-2 rounded-md border border-rose-400 bg-rose-50 px-3 py-2 text-[11px]
               text-rose-700 dark:border-rose-500/70 dark:bg-rose-950/40 dark:text-rose-100"
      >
        {{ error }}
      </div>

      <div v-if="loading && !profile" class="space-y-2">
        <div class="h-9 w-full animate-pulse rounded-xl bg-slate-200/90 dark:bg-slate-800/70" />
        <div class="h-24 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/60" />
      </div>

      <div v-else>
        <!-- Meta -->
        <div
          class="mb-3 grid gap-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-3
                 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-300 sm:grid-cols-5"
        >
          <div class="flex items-center justify-between sm:block">
            <div class="font-semibold text-slate-800 dark:text-slate-100">Employee</div>
            <div>{{ profile?.employeeId || loginId || '—' }}</div>
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
            <div class="font-semibold text-slate-900 dark:text-slate-50">
              {{ detailContractEndYmd || '—' }}
            </div>
          </div>

          <div class="flex items-center justify-between sm:block">
            <div class="font-semibold text-slate-800 dark:text-slate-100">Department</div>
            <div>{{ profile?.department || '—' }}</div>
          </div>

          <div v-if="lastUpdatedAt" class="sm:col-span-5 text-[10px] text-slate-500 dark:text-slate-400">
            Last updated: {{ dayjs(lastUpdatedAt).format('YYYY-MM-DD HH:mm') }}
          </div>
        </div>

        <!-- Contract History -->
        <div class="mb-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/30">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-xs font-semibold text-slate-900 dark:text-slate-50">Contract History</div>
              <div class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                If your backend includes contract balance snapshots, you will see “leave used per type”.
              </div>
            </div>

            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px]
                     font-semibold text-slate-800 hover:bg-slate-50
                     dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:hover:bg-slate-900/60
                     disabled:opacity-60 disabled:cursor-not-allowed"
              :disabled="contractsLoading"
              @click="fetchContracts()"
            >
              <i class="fa-solid fa-rotate text-[11px]" :class="contractsLoading ? 'fa-spin' : ''" />
              Refresh
            </button>
          </div>

          <div
            v-if="contractsError"
            class="mt-2 rounded-md border border-rose-400 bg-rose-50 px-3 py-2 text-[11px]
                   text-rose-700 dark:border-rose-500/70 dark:bg-rose-950/40 dark:text-rose-100"
          >
            {{ contractsError }}
          </div>

          <div v-if="contractsLoading" class="mt-2 space-y-2">
            <div class="h-9 w-full animate-pulse rounded-xl bg-slate-200/90 dark:bg-slate-800/70" />
            <div class="h-20 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/60" />
          </div>

          <p v-else-if="!contracts.length" class="mt-3 text-center text-[11px] text-slate-500 dark:text-slate-400">
            No contract history found.
          </p>

          <!-- Mobile contract cards -->
          <div v-else-if="isMobile" class="mt-3 space-y-2">
            <article
              v-for="(c, idx) in contracts"
              :key="c.id"
              class="rounded-2xl border border-slate-200 bg-white p-3 text-xs
                     shadow-[0_10px_24px_rgba(15,23,42,0.08)]
                     dark:border-slate-800 dark:bg-slate-900/60"
            >
              <div class="flex items-start justify-between gap-2">
                <div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">Contract #{{ idx + 1 }}</div>
                  <div class="mt-0.5 font-semibold text-slate-900 dark:text-slate-50">
                    {{ fmtYMD(c.startDate) }} → {{ fmtYMD(c.endDate) }}
                  </div>
                </div>

                <button
                  class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px]
                         font-semibold text-slate-800 hover:bg-slate-50
                         dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:hover:bg-slate-900/60"
                  @click="toggleContract(c.id)"
                >
                  <i class="fa-solid" :class="expandedContractId === c.id ? 'fa-chevron-up' : 'fa-chevron-down'" />
                  Details
                </button>
              </div>

              <div
                v-if="expandedContractId === c.id"
                class="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40"
              >
                <div class="text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                  Leave used (this contract)
                </div>

                <div v-if="!contractUsedChips(c).length" class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  No per-contract leave snapshot provided by backend.
                </div>

                <div v-else class="mt-2 flex flex-wrap gap-2">
                  <span
                    v-for="chip in contractUsedChips(c)"
                    :key="chip"
                    class="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px]
                           font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100"
                  >
                    {{ chip }}
                  </span>
                </div>

                <div v-if="c.note" class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                  Note: <span class="text-slate-800 dark:text-slate-100 font-semibold">{{ c.note }}</span>
                </div>
              </div>
            </article>
          </div>

          <!-- Desktop contract table -->
          <div v-else class="mt-3 overflow-x-auto">
            <table class="min-w-[980px] w-full text-left text-xs sm:text-[13px] text-slate-700 dark:text-slate-100">
              <thead
                class="bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200
                       dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-300"
              >
                <tr>
                  <th class="table-th">#</th>
                  <th class="table-th">Start</th>
                  <th class="table-th">End</th>
                  <th class="table-th">Leave used (this contract)</th>
                  <th class="table-th">Note</th>
                  <th class="table-th text-right">Action</th>
                </tr>
              </thead>

              <tbody>
                <template v-for="(c, idx) in contracts" :key="c.id">
                  <tr class="border-b border-slate-200 hover:bg-slate-50/80 dark:border-slate-700 dark:hover:bg-slate-900/70">
                    <td class="table-td font-semibold">{{ idx + 1 }}</td>
                    <td class="table-td">{{ fmtYMD(c.startDate) }}</td>
                    <td class="table-td">{{ fmtYMD(c.endDate) }}</td>
                    <td class="table-td">
                      <div v-if="contractUsedChips(c).length" class="flex flex-wrap gap-2">
                        <span
                          v-for="chip in contractUsedChips(c)"
                          :key="chip"
                          class="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px]
                                 font-semibold text-slate-800 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100"
                        >
                          {{ chip }}
                        </span>
                      </div>
                      <span v-else class="text-[11px] text-slate-500 dark:text-slate-400">—</span>
                    </td>
                    <td class="table-td text-[11px] text-slate-600 dark:text-slate-300">
                      {{ c.note || '—' }}
                    </td>

                    <td class="table-td text-right">
                      <button
                        class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px]
                               font-semibold text-slate-800 hover:bg-slate-50
                               dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100 dark:hover:bg-slate-900/60"
                        @click="toggleContract(c.id)"
                      >
                        <i class="fa-solid" :class="expandedContractId === c.id ? 'fa-chevron-up' : 'fa-chevron-down'" />
                        Detail
                      </button>
                    </td>
                  </tr>

                  <tr v-if="expandedContractId === c.id" class="border-b border-slate-200 dark:border-slate-700">
                    <td class="table-td" colspan="6">
                      <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                        <div class="text-[11px] font-semibold text-slate-800 dark:text-slate-100">Contract detail</div>
                        <div class="mt-2 grid gap-2 sm:grid-cols-3 text-[11px] text-slate-600 dark:text-slate-300">
                          <div><span class="font-semibold text-slate-800 dark:text-slate-100">Start:</span> {{ fmtYMD(c.startDate) }}</div>
                          <div><span class="font-semibold text-slate-800 dark:text-slate-100">End:</span> {{ fmtYMD(c.endDate) }}</div>
                          <div><span class="font-semibold text-slate-800 dark:text-slate-100">Note:</span> {{ c.note || '—' }}</div>
                        </div>
                      </div>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
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
            <colgroup>
              <col style="width: 140px" />
              <col style="width: 200px" />
              <col style="width: 160px" />
              <col style="width: 200px" />
            </colgroup>

            <thead
              class="bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-500
                    border-b border-slate-200 dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-300"
            >
              <tr>
                <th class="table-th">Type</th>
                <th class="table-th text-right">Entitlement</th>
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

                <td class="table-td text-right tabular-nums align-middle">{{ b.yearlyEntitlement }}</td>
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
          Read-only. If anything looks wrong, contact HR/Leave Admin.
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
