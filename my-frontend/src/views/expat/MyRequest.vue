<!-- src/views/expat/MyRequests.vue
  ✅ Uses your global system:
     - main.css (Kantumruy Pro for all)
     - tailwind.css (ui-* tokens/components)
  ✅ Low color mixing (Cancel uses ui-btn-rose but subtle)
  ✅ Responsive: mobile cards + desktop table (aligned columns)
  ✅ Header controls align with table columns (no overflow / no weird gaps)
  ✅ No duplicate local .ui-btn styles (use global ui-btn / ui-pagebtn / ui-card / ui-table)
-->

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, defineExpose } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/store/auth'
import { subscribeEmployeeIfNeeded, subscribeUserIfNeeded, onSocket } from '@/utils/socket'

defineOptions({ name: 'MyRequests' })

const { showToast } = useToast()
const auth = useAuth()

/* ───────── Identity for realtime ───────── */
const employeeId = computed(() =>
  String(auth.user?.employeeId || localStorage.getItem('employeeId') || '').trim()
)
const loginId = computed(() =>
  String(auth.user?.id || localStorage.getItem('loginId') || '').trim()
)

/* ───────── responsive flag ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────── STATE ───────── */
const loadingMyRequests = ref(false)
const loadError = ref('')
const myRequests = ref([])

const search = ref('')
const statusFilter = ref('ALL')

// pagination
const page = ref(1)
const perPage = ref(10)
const perPageOptions = [10, 20, 50, 'All']

/* ✅ include PENDING_COO in case your data has it */
const STATUS_LABEL = {
  ALL: 'All',
  PENDING_MANAGER: 'Pending (Mgr)',
  PENDING_GM: 'Pending (GM)',
  PENDING_COO: 'Pending (COO)',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
}

function statusLabel(s) {
  const key = String(s || '').toUpperCase()
  return STATUS_LABEL[key] || key || '—'
}

/* ✅ Use your global ui-badge styles (less mixed colors) */
function statusBadgeUiClass(s) {
  const st = String(s || '').toUpperCase()
  if (st === 'APPROVED') return 'ui-badge ui-badge-success'
  if (st === 'REJECTED') return 'ui-badge ui-badge-danger'
  if (st === 'CANCELLED') return 'ui-badge'
  if (st === 'PENDING_MANAGER' || st === 'PENDING_GM' || st === 'PENDING_COO') return 'ui-badge ui-badge-warning'
  return 'ui-badge'
}

/* ✅ Cancel allowed ONLY if not yet approved by anyone */
function canCancel(item) {
  return String(item?.status || '').toUpperCase() === 'PENDING_MANAGER'
}

/* ───────── Cancel modal ───────── */
const confirmOpen = ref(false)
const confirmItem = ref(null)
const cancelling = ref(false)

function openCancel(item) {
  confirmItem.value = item
  confirmOpen.value = true
}

function closeCancel() {
  confirmOpen.value = false
  confirmItem.value = null
}

async function confirmCancel() {
  if (!confirmItem.value?._id) return
  if (!canCancel(confirmItem.value)) {
    showToast({
      type: 'info',
      title: 'Cannot cancel',
      message: 'You can only cancel before manager approval.',
    })
    closeCancel()
    return
  }

  cancelling.value = true
  try {
    await api.post(`/leave/requests/${confirmItem.value._id}/cancel`)
    showToast({ type: 'success', title: 'Cancelled', message: 'Your request has been cancelled.' })
    closeCancel()
    await fetchMyRequests(true)
  } catch (e) {
    const msg = e?.response?.data?.message || 'Failed to cancel request.'
    showToast({ type: 'error', title: 'Cancel failed', message: msg })
  } finally {
    cancelling.value = false
  }
}

/* ───────── COMPUTED ───────── */
const processedRequests = computed(() => {
  const items = [...myRequests.value]

  items.sort((a, b) => {
    const av = a.createdAt ? dayjs(a.createdAt).valueOf() : 0
    const bv = b.createdAt ? dayjs(b.createdAt).valueOf() : 0
    return bv - av
  })

  let result = items

  if (statusFilter.value !== 'ALL') {
    const st = String(statusFilter.value || '').toUpperCase()
    result = result.filter((r) => String(r.status || '').toUpperCase() === st)
  }

  const q = search.value.trim().toLowerCase()
  if (q) {
    result = result.filter((r) => {
      const code = String(r.leaveTypeCode || '').toLowerCase()
      const period = `${r.startDate || ''} ${r.endDate || ''}`.toLowerCase()
      const reason = String(r.reason || '').toLowerCase()
      const st = statusLabel(r.status || '').toLowerCase()
      return code.includes(q) || period.includes(q) || reason.includes(q) || st.includes(q)
    })
  }

  return result
})

const pagedRequests = computed(() => {
  if (perPage.value === 'All') return processedRequests.value
  const per = Number(perPage.value || 10)
  const start = (page.value - 1) * per
  return processedRequests.value.slice(start, start + per)
})

const pageCount = computed(() => {
  if (perPage.value === 'All') return 1
  const per = Number(perPage.value || 10)
  return Math.ceil(processedRequests.value.length / per) || 1
})

watch([search, statusFilter, perPage], () => {
  page.value = 1
})

/* ───────── API ───────── */
async function fetchMyRequests(silent = false) {
  try {
    loadingMyRequests.value = true
    loadError.value = ''
    const res = await api.get('/leave/requests/my')
    myRequests.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    console.error('fetchMyRequests error', e)
    loadError.value = e?.response?.data?.message || 'Unable to load your leave requests.'
    if (!silent) showToast({ type: 'error', title: 'Failed to load', message: loadError.value })
  } finally {
    loadingMyRequests.value = false
  }
}

defineExpose({ reload: fetchMyRequests })

/* ───────── Realtime helpers ───────── */
function isMyDoc(payload = {}) {
  const emp = String(payload.employeeId || '').trim()
  const requester = String(payload.requesterLoginId || '').trim()
  const currentEmp = String(employeeId.value || '').trim()
  const currentLogin = String(loginId.value || '').trim()
  return (currentEmp && emp === currentEmp) || (currentLogin && requester === currentLogin)
}

let refreshTimer = null
function triggerRealtimeRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    fetchMyRequests(true)
  }, 150)
}

const offHandlers = []
function setupRealtime() {
  if (employeeId.value) subscribeEmployeeIfNeeded(employeeId.value)
  if (loginId.value) subscribeUserIfNeeded(loginId.value)

  offHandlers.push(
    onSocket('leave:req:created', (payload = {}) => {
      if (!isMyDoc(payload)) return
      triggerRealtimeRefresh()
      showToast({ type: 'success', title: 'Created', message: 'Your leave request was created.' })
    }),

    onSocket('leave:req:updated', (payload = {}) => {
      if (!isMyDoc(payload)) return
      triggerRealtimeRefresh()

      const st = String(payload.status || '').toUpperCase()
      if (st === 'CANCELLED') showToast({ type: 'info', title: 'Cancelled', message: 'Request cancelled.' })
      if (st === 'REJECTED') showToast({ type: 'error', title: 'Rejected', message: 'Your request was rejected.' })
      if (st === 'APPROVED') showToast({ type: 'success', title: 'Approved', message: 'Your request was approved.' })
      if (st === 'PENDING_GM') showToast({ type: 'success', title: 'Manager approved', message: 'Sent to GM.' })
      if (st === 'PENDING_COO') showToast({ type: 'success', title: 'GM approved', message: 'Sent to COO.' })
    })
  )
}

/* ───────── lifecycle ───────── */
onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)

  await fetchMyRequests(true)
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
  <div class="ui-page">
    <div class="ui-container py-2">
      <div class="ui-card overflow-hidden">
        <!-- Header -->
        <div class="ui-hero-gradient">
          <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div class="min-w-[220px]">
              <div class="text-sm font-extrabold">My Leave Requests</div>
              <div class="text-[11px] text-white/90">Track your submitted leave requests and status.</div>
            </div>

            <!-- Controls: fit nicely, no overflow -->
            <div class="grid w-full gap-2 md:w-auto md:grid-cols-[260px_220px_auto] md:items-end">
              <div>
                <label class="mb-1 block text-[11px] font-extrabold text-white/90">Search</label>
                <div class="flex items-center rounded-xl border border-white/25 bg-white/10 px-2.5 py-2 text-[11px]">
                  <i class="fa-solid fa-magnifying-glass mr-2 text-white/80" />
                  <input
                    v-model="search"
                    type="text"
                    placeholder="Type, status or reason..."
                    class="w-full bg-transparent text-[11px] text-white outline-none placeholder:text-white/70"
                  />
                </div>
              </div>

              <div>
                <label class="mb-1 block text-[11px] font-extrabold text-white/90">Status</label>
                <select
                  v-model="statusFilter"
                  class="w-full rounded-xl border border-white/25 bg-white/10 px-2.5 py-2 text-[11px] text-white outline-none"
                >
                  <option value="ALL">All</option>
                  <option value="PENDING_MANAGER">Pending (Mgr)</option>
                  <option value="PENDING_GM">Pending (GM)</option>
                  <option value="PENDING_COO">Pending (COO)</option>
                  <option value="APPROVED">Approved</option>
                  <option value="REJECTED">Rejected</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </div>

              <button
                type="button"
                class="ui-btn ui-btn-soft !border-white/25 !bg-white/10 !text-white hover:!bg-white/15"
                :disabled="loadingMyRequests"
                @click="fetchMyRequests()"
              >
                <i class="fa-solid fa-rotate text-[11px]" :class="loadingMyRequests ? 'fa-spin' : ''" />
                Refresh
              </button>
            </div>
          </div>
        </div>

        <!-- Body -->
        <div class="p-3">
          <div
            v-if="loadError"
            class="mb-2 rounded-2xl border border-rose-400 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700
                   dark:border-rose-500/70 dark:bg-rose-950/40 dark:text-rose-100"
          >
            {{ loadError }}
          </div>

          <div v-if="loadingMyRequests && !processedRequests.length" class="space-y-2">
            <div class="ui-skeleton h-9 w-full" />
            <div v-for="i in 3" :key="'sk-' + i" class="ui-skeleton h-14 w-full" />
          </div>

          <div v-else>
            <!-- ✅ Mobile cards -->
            <div v-if="isMobile" class="space-y-2">
              <div
                v-if="!pagedRequests.length"
                class="ui-frame p-4 text-center text-[12px] text-slate-500 dark:text-slate-400"
              >
                You have not submitted any leave requests yet.
              </div>

              <div
                v-for="item in pagedRequests"
                :key="item._id"
                class="ui-card p-3"
              >
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400">
                      {{ item.createdAt ? dayjs(item.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
                    </div>
                    <div class="mt-1 flex items-center gap-2">
                      <span class="ui-badge ui-badge-info">{{ item.leaveTypeCode || '—' }}</span>
                      <span :class="statusBadgeUiClass(item.status)">{{ statusLabel(item.status) }}</span>
                    </div>
                  </div>

                  <button
                    v-if="canCancel(item)"
                    type="button"
                    class="ui-btn ui-btn-rose ui-btn-xs"
                    @click="openCancel(item)"
                  >
                    <i class="fa-solid fa-xmark text-[11px]" />
                    Cancel
                  </button>

                  <span v-else class="text-[11px] text-slate-400 dark:text-slate-500">—</span>
                </div>

                <div class="mt-2 ui-divider" />

                <div class="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                  <div class="ui-frame p-2">
                    <div class="ui-label !mb-1">Leave Date</div>
                    <div class="font-mono text-[11px]">{{ item.startDate }} → {{ item.endDate }}</div>
                  </div>
                  <div class="ui-frame p-2">
                    <div class="ui-label !mb-1">Days</div>
                    <div class="font-extrabold tabular-nums">{{ Number(item.totalDays || 0).toLocaleString() }}</div>
                  </div>
                </div>

                <div class="mt-2 ui-frame p-2">
                  <div class="ui-label !mb-1">Reason</div>
                  <div class="text-[11px] text-slate-700 dark:text-slate-200">
                    {{ item.reason || '—' }}
                  </div>
                </div>
              </div>
            </div>

            <!-- ✅ Desktop table (your global ui-table) -->
            <div v-else class="ui-table-wrap">
              <table class="ui-table">
                <thead>
                  <tr>
                    <th class="ui-th">Created</th>
                    <th class="ui-th">Type</th>
                    <th class="ui-th">Leave Date</th>
                    <th class="ui-th">Days</th>
                    <th class="ui-th">Status</th>
                    <th class="ui-th">Reason</th>
                    <th class="ui-th">Action</th>
                  </tr>
                </thead>

                <tbody>
                  <tr v-if="!pagedRequests.length">
                    <td colspan="7" class="ui-td py-8 text-slate-500 dark:text-slate-400">
                      You have not submitted any leave requests yet.
                    </td>
                  </tr>

                  <tr
                    v-for="item in pagedRequests"
                    :key="item._id"
                    class="ui-tr-hover"
                  >
                    <td class="ui-td whitespace-nowrap">
                      {{ item.createdAt ? dayjs(item.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
                    </td>

                    <td class="ui-td">
                      <span class="ui-badge ui-badge-info">{{ item.leaveTypeCode || '—' }}</span>
                    </td>

                    <td class="ui-td whitespace-nowrap font-mono">
                      {{ item.startDate }} → {{ item.endDate }}
                    </td>

                    <td class="ui-td font-extrabold tabular-nums">
                      {{ Number(item.totalDays || 0).toLocaleString() }}
                    </td>

                    <td class="ui-td">
                      <span :class="statusBadgeUiClass(item.status)">{{ statusLabel(item.status) }}</span>
                    </td>

                    <td class="ui-td">
                      <span class="block w-full truncate text-left">
                        {{ item.reason || '—' }}
                      </span>
                    </td>

                    <td class="ui-td">
                      <button
                        v-if="canCancel(item)"
                        type="button"
                        class="ui-btn ui-btn-rose ui-btn-xs"
                        @click="openCancel(item)"               
                      >
                        <i class="fa-solid fa-xmark text-[11px]" />
                        Cancel
                      </button>

                      <span v-else class="text-[11px] text-slate-400 dark:text-slate-500">—</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Pagination (global ui-pagebtn) -->
            <div
              v-if="processedRequests.length"
              class="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-2 text-[11px] text-slate-600
                     dark:border-slate-700 dark:text-slate-300 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="flex items-center gap-2">
                <span>Rows per page</span>
                <select v-model="perPage" class="ui-select !py-1.5 !text-[11px] !rounded-full">
                  <option v-for="opt in perPageOptions" :key="'per-' + opt" :value="opt">{{ opt }}</option>
                </select>
              </div>

              <div class="flex items-center justify-end gap-1">
                <button type="button" class="ui-pagebtn" :disabled="page <= 1" @click="page = 1">«</button>
                <button type="button" class="ui-pagebtn" :disabled="page <= 1" @click="page = Math.max(1, page - 1)">Prev</button>
                <span class="px-2 font-extrabold">Page {{ page }} / {{ pageCount }}</span>
                <button type="button" class="ui-pagebtn" :disabled="page >= pageCount" @click="page = Math.min(pageCount, page + 1)">Next</button>
                <button type="button" class="ui-pagebtn" :disabled="page >= pageCount" @click="page = pageCount">»</button>
              </div>
            </div>

          </div>
        </div>
      </div>

      <!-- ✅ Confirm Cancel Modal (uses global modal styles if you have; fallback here) -->
      <div v-if="confirmOpen" class="ui-modal-backdrop">
        <div class="ui-modal p-4">
          <div class="flex items-start gap-3">
            <div class="grid h-10 w-10 place-items-center rounded-2xl border"
                 style="border-color: rgb(var(--ui-danger) / 0.25); background: rgb(var(--ui-danger) / 0.10); color: rgb(var(--ui-danger));">
              <i class="fa-solid fa-triangle-exclamation" />
            </div>

            <div class="flex-1">
              <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Cancel this request?</div>
              <div class="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                You can only cancel <span class="font-extrabold">before manager approval</span>.
              </div>

              <div class="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
                <span class="ui-badge ui-badge-info">{{ confirmItem?.leaveTypeCode }}</span>
                <span class="mx-1 opacity-60">•</span>
                <span class="font-mono">{{ confirmItem?.startDate }} → {{ confirmItem?.endDate }}</span>
              </div>
            </div>
          </div>

          <div class="mt-4 flex justify-end gap-2">
            <button type="button" class="ui-btn ui-btn-ghost" :disabled="cancelling" @click="closeCancel">
              Close
            </button>
            <button type="button" class="ui-btn ui-btn-rose" :disabled="cancelling" @click="confirmCancel">
              <i v-if="cancelling" class="fa-solid fa-spinner animate-spin text-[11px]" />
              Confirm Cancel
            </button>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
/* no extra local button/colors — rely on global ui-* */
</style>
