<!-- src/views/expat/user/UserLeaveProfile.vue
  ✅ Works with backend controller:
     GET /api/leave/profile/my  (no employeeId param for user)
  ✅ Read-only
  ✅ Shows balances computed by backend (balancesAsOf)
  ✅ Contract history reads LeaveProfile.contracts[] (closeSnapshot.balances)
  ✅ Used includes negative carry debt (carry.AL=-2 => Used shows 2 more)
  ✅ Realtime refresh via socket rooms user:<loginId> + employee:<employeeId>
  ✅ Full-screen edges (no wasted container)
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
const employeeIdFromAuth = computed(() =>
  String(auth.user?.employeeId || localStorage.getItem('employeeId') || '').trim()
)

/* ───────── Responsive ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────── Base state ───────── */
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
function fmtDT(v) {
  if (!v) return '—'
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : '—'
}

/* ───────── Carry / Used helpers ───────── */
function normalizeCarryObj(c) {
  const src = c && typeof c === 'object' ? c : {}
  return {
    AL: num(src.AL),
    SP: num(src.SP),
    MC: num(src.MC),
    MA: num(src.MA),
    UL: num(src.UL),
  }
}
function usedWithCarryDebt(used, carryVal) {
  const debt = carryVal < 0 ? Math.abs(carryVal) : 0
  return num(used) + debt
}

/* ───────── balances (from backend profile.balances) ───────── */
const balances = computed(() => {
  const raw = Array.isArray(profile.value?.balances) ? profile.value.balances : []
  const carry = normalizeCarryObj(profile.value?.carry)

  const arr = raw
    .map((b) => {
      const code = String(b?.leaveTypeCode || b?.code || '').toUpperCase()
      if (!code) return null

      const yearlyEntitlement = num(b?.yearlyEntitlement)
      const used = num(b?.used)
      // backend may already provide remaining; if not, compute
      const remaining = b?.remaining != null ? num(b.remaining) : yearlyEntitlement - used

      return {
        leaveTypeCode: code,
        yearlyEntitlement,
        used,
        usedDisplay: usedWithCarryDebt(used, carry[code]),
        remaining,
      }
    })
    .filter(Boolean)

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
const contractEndYmd = computed(() => {
  const v = pickContractEnd(profile.value || {})
  if (!v) return ''
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD') : ''
})
const daysLeft = computed(() => {
  if (!contractEndYmd.value) return null
  const end = dayjs(contractEndYmd.value).startOf('day')
  const now = dayjs().startOf('day')
  return end.diff(now, 'day')
})
function daysLeftLabel(v) {
  if (v == null) return '—'
  if (v < 0) return `Expired ${Math.abs(v)}d`
  return `${v}d`
}
function daysLeftClass(v) {
  if (v == null) {
    return 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100'
  }
  if (v < 0 || v <= 30) {
    return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200'
  }
  if (v <= 200) {
    return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
  }
  return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
}

/* ───────── Contract history (embedded) ───────── */
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

const contracts = computed(() => {
  const list = Array.isArray(profile.value?.contracts) ? profile.value.contracts : []
  const liveCarry = normalizeCarryObj(profile.value?.carry)
  const liveBalances = Array.isArray(profile.value?.balances) ? profile.value.balances : []

  const mapped = list.map((c, idx) => {
    const id = String(c?._id || c?.id || c?.contractId || c?.contractNo || `${idx}`)
    const start = c?.startDate || c?.contractDate || c?.fromDate || c?.from || c?.start || null
    const end = c?.endDate || c?.contractEndDate || c?.toDate || c?.to || c?.end || null
    const note = String(c?.note || c?.remark || '')
    const openedAt = c?.openedAt || c?.createdAt || null
    const closedAt = c?.closedAt || null

    const snapBalances =
      c?.closeSnapshot?.balances ||
      c?.closeSnapshot?.balance ||
      c?.closeSnapshot?.leaveBalances ||
      null

    const snapAsOf =
      c?.closeSnapshot?.balancesAsOf ||
      c?.closeSnapshot?.asOf ||
      ''

    const isActive = !closedAt
    const balancesForUI = isActive ? normalizeBalancesLike(liveBalances) : normalizeBalancesLike(snapBalances)
    const carryForUI = isActive ? liveCarry : normalizeCarryObj(c?.closeSnapshot?.carry)

    return {
      id,
      contractNo: c?.contractNo ?? idx + 1,
      startDate: start,
      endDate: end,
      openedAt,
      closedAt,
      note,
      snapshotAsOf: snapAsOf || '',
      isActive,
      balances: balancesForUI,
      carry: carryForUI,
    }
  })

  mapped.sort((a, b) => {
    const na = Number(a.contractNo || 0)
    const nb = Number(b.contractNo || 0)
    if (na && nb && na !== nb) return na - nb
    const da = a.startDate ? dayjs(a.startDate).valueOf() : 0
    const db = b.startDate ? dayjs(b.startDate).valueOf() : 0
    return da - db
  })

  return mapped
})

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

  const carry = normalizeCarryObj(c?.carry)
  return arr.map((b) => {
    const code = b.leaveTypeCode
    const usedDisplay = usedWithCarryDebt(num(b.used), carry[code])
    return `${code}: ${usedDisplay}`
  })
}

function toggleContract(id) {
  expandedContractId.value = expandedContractId.value === id ? '' : id
}

/* ───────── Fetch profile ───────── */
async function fetchMyProfile(silent = false) {
  try {
    loading.value = true
    error.value = ''

    // ✅ Controller returns self. Do NOT pass employeeId.
    const res = await api.get('/leave/profile/my')

    profile.value = res?.data?.profile || res?.data || null
    lastUpdatedAt.value = dayjs().toISOString()
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
  // prefer profile employeeId, else auth employeeId, else loginId
  return String(profile.value?.employeeId || employeeIdFromAuth.value || loginId.value || '').trim()
}

function isMyDoc(payload = {}) {
  const emp = String(payload.employeeId || '').trim()
  const requester = String(payload.requesterLoginId || '').trim()
  const meEmp = myEmployeeId()
  const meLogin = String(loginId.value || '').trim()
  return (emp && meEmp && emp === meEmp) || (requester && meLogin && requester === meLogin)
}

let refreshTimer = null
function triggerRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => fetchMyProfile(true), 180)
}

const offHandlers = []
function setupRealtime() {
  // join rooms
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
    try { off && off() } catch {}
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
  <!-- ✅ Full screen width/height area, no wasted edges -->
  <div class="h-full w-full p-0">
    <div class="h-full w-full rounded-none border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <!-- Header -->
      <div class="ui-hero-gradient rounded-t-2xl px-3 py-3 sm:px-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-[240px]">
            <p class="text-[10px] uppercase tracking-[0.35em] font-semibold text-white/90">
              Employee · Expat leave
            </p>

            <div class="mt-0.5 flex items-center gap-2">
              <p class="text-sm font-semibold">My Leave Profile</p>
              <span class="inline-flex items-center rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-[10px] font-semibold">
                Read-only
              </span>
              <span
                v-if="profile?.balancesAsOf"
                class="inline-flex items-center rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-[10px] font-semibold"
              >
                As of: {{ profile?.balancesAsOf }}
              </span>
            </div>

            <p class="mt-1 text-[11px] text-white/90">
              Balances may be negative when SP borrows from AL.
            </p>
          </div>

          <div class="flex items-center gap-2">


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
      <div class="px-2 pb-2 pt-3 sm:px-4 sm:pb-4">
        <div
          v-if="error"
          class="mb-2 rounded-md border border-rose-400 bg-rose-50 px-3 py-2 text-[11px]
                 text-rose-700 dark:border-rose-500/70 dark:bg-rose-950/40 dark:text-rose-100"
        >
          {{ error }}
        </div>

        <div v-if="loading && !profile" class="space-y-2">
          <div class="h-10 w-full animate-pulse rounded-xl bg-slate-200/90 dark:bg-slate-800/70" />
          <div class="h-28 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/60" />
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
                {{ contractEndYmd || '—' }}
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
                  Closed contracts show snapshot usage from <span class="font-semibold">closeSnapshot.balances</span>.
                  Active contract shows live balances.
                </div>
              </div>
            </div>

            <p v-if="!contracts.length" class="mt-3 text-center text-[11px] text-slate-500 dark:text-slate-400">
              No contract history found.
            </p>

            <!-- Mobile contract cards -->
            <div v-else-if="isMobile" class="mt-3 space-y-2">
              <article
                v-for="c in contracts"
                :key="c.id"
                class="rounded-2xl border border-slate-200 bg-white p-3 text-xs
                       shadow-[0_10px_24px_rgba(15,23,42,0.08)]
                       dark:border-slate-800 dark:bg-slate-900/60"
              >
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <div class="flex items-center gap-2">
                      <div class="text-[11px] text-slate-500 dark:text-slate-400">
                        Contract #{{ c.contractNo }}
                      </div>
                      <span
                        class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                        :class="c.isActive
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                          : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100'"
                      >
                        {{ c.isActive ? 'Active' : 'Closed' }}
                      </span>
                    </div>

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
                    Leave used ({{ c.isActive ? 'live' : 'snapshot' }})
                  </div>

                  <div v-if="!contractUsedChips(c).length" class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    No leave balances available for this contract.
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

                  <div v-if="!c.isActive && c.snapshotAsOf" class="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                    Snapshot as of: {{ c.snapshotAsOf }}
                  </div>
                </div>
              </article>
            </div>

            <!-- Desktop contract table -->
            <div v-else class="mt-3 overflow-x-auto">
              <table class="min-w-[1100px] w-full text-left text-xs sm:text-[13px] text-slate-700 dark:text-slate-100">
                <thead
                  class="bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200
                         dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-300"
                >
                  <tr>
                    <th class="table-th">#</th>
                    <th class="table-th">Start</th>
                    <th class="table-th">End</th>
                    <th class="table-th">Status</th>
                    <th class="table-th">Leave used</th>
                    <th class="table-th">Note</th>
                    <th class="table-th text-right">Action</th>
                  </tr>
                </thead>

                <tbody>
                  <template v-for="c in contracts" :key="c.id">
                    <tr class="border-b border-slate-200 hover:bg-slate-50/80 dark:border-slate-700 dark:hover:bg-slate-900/70">
                      <td class="table-td font-semibold">{{ c.contractNo }}</td>
                      <td class="table-td">{{ fmtYMD(c.startDate) }}</td>
                      <td class="table-td">{{ fmtYMD(c.endDate) }}</td>

                      <td class="table-td">
                        <span
                          class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                          :class="c.isActive
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                            : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-100'"
                        >
                          {{ c.isActive ? 'Active' : 'Closed' }}
                        </span>
                      </td>

                      
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
                      <td class="table-td" colspan="9">
                        <div class="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                          <div class="text-[11px] font-semibold text-slate-800 dark:text-slate-100">Contract detail</div>
                          <div class="mt-2 grid gap-2 sm:grid-cols-4 text-[11px] text-slate-600 dark:text-slate-300">
                            <div><span class="font-semibold text-slate-800 dark:text-slate-100">Start:</span> {{ fmtYMD(c.startDate) }}</div>
                            <div><span class="font-semibold text-slate-800 dark:text-slate-100">End:</span> {{ fmtYMD(c.endDate) }}</div>
                          </div>
                          <div class="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
                            <span class="font-semibold text-slate-800 dark:text-slate-100">Note:</span> {{ c.note || '—' }}
                          </div>
                          <div v-if="!c.isActive && c.snapshotAsOf" class="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                            Snapshot as of: {{ c.snapshotAsOf }}
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
                    <span class="font-semibold text-slate-900 dark:text-slate-50">{{ b.usedDisplay }}</span>
                  </div>
                  <div class="mt-0.5">
                    <span class="text-slate-500 dark:text-slate-400">Remaining:dw</span>
                    <span
                      class="ml-1 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                      :class="b.remaining > 0
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                        : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200'"
                    >
                      {{ b.remaining }}assas
                    </span>
                  </div>
                </div>
              </div>
            </article>
          </div>

          <!-- Desktop balances -->
          <!-- <div v-else class="overflow-x-auto">
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
                  <td class="table-td text-right tabular-nums align-middle">{{ b.usedDisplay }}</td>

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
          </div> -->

          <div class="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
            Read-only. If anything looks wrong, contact HR/Leave Admin.
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* keep your global hero gradient class name */
.ui-hero-gradient {
  background: linear-gradient(135deg, rgba(14,165,233,1) 0%, rgba(16,185,129,1) 100%);
  border-radius: 0px;
}
.table-th { padding: 8px 10px; font-size: 11px; font-weight: 800; white-space: nowrap; }
.table-td { padding: 8px 10px; vertical-align: middle; }
</style>
