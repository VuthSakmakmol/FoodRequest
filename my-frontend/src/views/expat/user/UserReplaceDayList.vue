<!-- src/views/expat/user/UserReplaceList.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, defineExpose } from 'vue'
import { useRouter } from 'vue-router'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/store/auth'
import { subscribeEmployeeIfNeeded, subscribeUserIfNeeded, onSocket } from '@/utils/socket'

const router = useRouter()
const { showToast } = useToast()
const auth = useAuth()

/* ───────── Identity for realtime ───────── */
const employeeId = computed(() =>
  String(auth.user?.employeeId || localStorage.getItem('employeeId') || '')
)
const loginId = computed(() =>
  String(auth.user?.id || localStorage.getItem('loginId') || '')
)

/* ───────── responsive flag ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────── STATE ───────── */
const loading = ref(false)
const loadError = ref('')
const rows = ref([])

const search = ref('')
const statusFilter = ref('ALL') // ALL | PENDING_MANAGER | PENDING_GM | APPROVED | REJECTED | CANCELLED

// pagination
const page = ref(1)
const perPage = ref(10)
const perPageOptions = [10, 20, 50, 'All']

/* Evidence modal */
const evidenceOpen = ref(false)
const evidenceFor = ref(null) // request doc
const evidenceLoadingId = ref('') // evidenceId currently downloading/viewing

/* Status maps (same style as MyRequests.vue) */
const STATUS_LABEL = {
  PENDING_MANAGER: 'Pending Manager',
  PENDING_GM: 'Pending GM',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
}
const STATUS_COLOR = {
  PENDING_MANAGER: 'amber',
  PENDING_GM: 'blue',
  APPROVED: 'green',
  REJECTED: 'red',
  CANCELLED: 'grey',
}

function statusLabel(s) {
  return STATUS_LABEL[s] || s
}
function statusColorClass(s) {
  switch (STATUS_COLOR[s]) {
    case 'amber':
      return 'bg-amber-100 text-amber-700 border border-amber-200'
    case 'blue':
      return 'bg-sky-100 text-sky-700 border border-sky-200'
    case 'green':
      return 'bg-emerald-100 text-emerald-700 border border-emerald-200'
    case 'red':
      return 'bg-rose-100 text-rose-700 border border-rose-200'
    case 'grey':
    default:
      return 'bg-slate-100 text-slate-600 border border-slate-200'
  }
}

/* ───────── COMPUTED ───────── */
const processedRows = computed(() => {
  const items = [...rows.value]

  items.sort((a, b) => {
    const av = a.createdAt ? dayjs(a.createdAt).valueOf() : 0
    const bv = b.createdAt ? dayjs(b.createdAt).valueOf() : 0
    return bv - av
  })

  let result = items

  if (statusFilter.value !== 'ALL') {
    result = result.filter(r => String(r.status || '') === String(statusFilter.value))
  }

  const q = search.value.trim().toLowerCase()
  if (q) {
    result = result.filter(r => {
      const dates = `${r.requestDate || ''} ${r.compensatoryDate || ''}`.toLowerCase()
      const reason = String(r.reason || '').toLowerCase()
      const st = statusLabel(String(r.status || '')).toLowerCase()
      return dates.includes(q) || reason.includes(q) || st.includes(q)
    })
  }

  return result
})

const pagedRows = computed(() => {
  if (perPage.value === 'All') return processedRows.value
  const per = Number(perPage.value || 10)
  const start = (page.value - 1) * per
  return processedRows.value.slice(start, start + per)
})

const pageCount = computed(() => {
  if (perPage.value === 'All') return 1
  const per = Number(perPage.value || 10)
  return Math.ceil(processedRows.value.length / per) || 1
})

watch([search, statusFilter], () => {
  page.value = 1
})

/* ───────── API ───────── */
async function fetchMyReplaceDays() {
  try {
    loading.value = true
    loadError.value = ''
    const res = await api.get('/leave/replace-days/my')
    rows.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    console.error('fetchMyReplaceDays error', e)
    loadError.value = e?.response?.data?.message || 'Unable to load your replace-day requests.'
    showToast({
      type: 'error',
      title: 'Failed to load',
      message: loadError.value
    })
  } finally {
    loading.value = false
  }
}

defineExpose({ reload: fetchMyReplaceDays })

/* ───────── Evidence helpers ───────── */
function evidenceCount(item) {
  return Array.isArray(item?.evidences) ? item.evidences.length : 0
}

function openEvidenceList(item) {
  evidenceFor.value = item
  evidenceOpen.value = true
}

function closeEvidence() {
  evidenceOpen.value = false
  evidenceFor.value = null
  evidenceLoadingId.value = ''
}

function prettyBytes(bytes) {
  const n = Number(bytes || 0)
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function safeFilename(name) {
  const s = String(name || 'evidence')
  // very simple sanitize
  return s.replace(/[\\/:*?"<>|]+/g, '_')
}

function openBlobInNewTab(blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = safeFilename(filename)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Requires backend endpoint:
 * GET /api/leave/replace-days/:id/evidences/:evidenceId
 * (returns Buffer as file stream)
 */
async function fetchEvidenceBlob(reqId, evidenceId) {
  return api.get(`/leave/replace-days/${reqId}/evidences/${evidenceId}`, {
    responseType: 'blob',
  })
}

async function viewEvidence(reqId, ev) {
  try {
    evidenceLoadingId.value = String(ev?._id || '')
    const res = await fetchEvidenceBlob(reqId, ev._id)
    openBlobInNewTab(res.data)
  } catch (e) {
    console.error('viewEvidence error', e)
    showToast({
      type: 'error',
      title: 'Cannot open evidence',
      message: e?.response?.data?.message || 'Evidence download failed. (Check backend evidence endpoint)',
    })
  } finally {
    evidenceLoadingId.value = ''
  }
}

async function downloadEvidence(reqId, ev) {
  try {
    evidenceLoadingId.value = String(ev?._id || '')
    const res = await fetchEvidenceBlob(reqId, ev._id)
    downloadBlob(res.data, ev?.filename || 'evidence')
  } catch (e) {
    console.error('downloadEvidence error', e)
    showToast({
      type: 'error',
      title: 'Download failed',
      message: e?.response?.data?.message || 'Evidence download failed. (Check backend evidence endpoint)',
    })
  } finally {
    evidenceLoadingId.value = ''
  }
}

/* ───────── Actions ───────── */
function goCreate() {
  router.push({ name: 'leave-user-replace-day' })
}

function fmtYMD(d) {
  return d ? String(d) : '—'
}

/* ───────── Realtime helpers ───────── */
function isMyDoc(payload = {}) {
  const emp = String(payload.employeeId || '')
  const requester = String(payload.requesterLoginId || '')

  const currentEmp = String(employeeId.value || '')
  const currentLogin = String(loginId.value || '')

  return (currentEmp && emp === currentEmp) || (currentLogin && requester === currentLogin)
}

let refreshTimer = null
function triggerRealtimeRefresh(reason = '') {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    // console.log('[UserReplaceList] realtime refresh:', reason)
    fetchMyReplaceDays()
  }, 150)
}

const offHandlers = []

function setupRealtime() {
  if (employeeId.value) subscribeEmployeeIfNeeded(employeeId.value)
  if (loginId.value) subscribeUserIfNeeded(loginId.value)

  const offCreated = onSocket('replace:created', (payload = {}) => {
    if (!isMyDoc(payload)) return
    triggerRealtimeRefresh('created')
    showToast({
      type: 'success',
      title: 'Request created',
      message: 'Your replace-day request was created successfully.'
    })
  })

  const offManager = onSocket('replace:manager-decision', (payload = {}) => {
    if (!isMyDoc(payload)) return
    triggerRealtimeRefresh('manager-decision')

    const st = String(payload.status || '')
    if (st === 'PENDING_GM') {
      showToast({
        type: 'success',
        title: 'Manager approved',
        message: 'Manager approved your replace-day request and sent it to GM.'
      })
    } else if (st === 'REJECTED') {
      showToast({
        type: 'error',
        title: 'Manager rejected',
        message: 'Manager rejected your replace-day request.'
      })
    }
  })

  const offGm = onSocket('replace:gm-decision', (payload = {}) => {
    if (!isMyDoc(payload)) return
    triggerRealtimeRefresh('gm-decision')

    const st = String(payload.status || '')
    if (st === 'APPROVED') {
      showToast({
        type: 'success',
        title: 'GM approved',
        message: 'GM approved your replace-day request.'
      })
    } else if (st === 'REJECTED') {
      showToast({
        type: 'error',
        title: 'GM rejected',
        message: 'GM rejected your replace-day request.'
      })
    }
  })

  const offUpdated = onSocket('replace:updated', (payload = {}) => {
    if (!isMyDoc(payload)) return
    triggerRealtimeRefresh('updated')
  })

  offHandlers.push(offCreated, offManager, offGm, offUpdated)
}

/* ───────── lifecycle ───────── */
onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)

  await fetchMyReplaceDays()
  setupRealtime()
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
  if (refreshTimer) clearTimeout(refreshTimer)
  offHandlers.forEach(off => {
    try { off && off() } catch {}
  })
})
</script>

<template>
  <div class="px-1 py-1 sm:px-3">
    <div
      class="rounded-2xl border border-slate-200 bg-white shadow-sm
             dark:border-slate-800 dark:bg-slate-900"
    >
      <!-- Gradient header (same style as MyRequests.vue) -->
      <div
        class="rounded-t-2xl bg-gradient-to-r from-sky-600 via-sky-500 to-indigo-500
               px-4 py-3 text-white"
      >
        <!-- Desktop header / filters -->
        <div
          v-if="!isMobile"
          class="flex flex-wrap items-end justify-between gap-4"
        >
          <div class="flex flex-col gap-1 min-w-[220px]">
            <p class="text-sm font-semibold">My Replace Day Requests</p>
            <p class="text-[11px] text-sky-50/90">
              Track your replace-day submissions and approval status.
            </p>
          </div>

          <div class="flex flex-1 flex-wrap items-end justify-end gap-3">
            <!-- Create -->
            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-xl bg-white/95 px-3 py-1.5
                     text-[11px] font-semibold text-sky-700 shadow-sm
                     hover:bg-white"
              @click="goCreate"
            >
              <i class="fa-solid fa-plus text-[11px]" />
              New Request
            </button>

            <!-- Search -->
            <div class="min-w-[220px] max-w-xs">
              <label class="mb-1 block text-[11px] font-medium text-sky-50">Search</label>
              <div
                class="flex items-center rounded-xl border border-sky-100/80 bg-sky-900/25
                       px-2.5 py-1.5 text-xs"
              >
                <i class="fa-solid fa-magnifying-glass mr-2 text-xs text-sky-50/80" />
                <input
                  v-model="search"
                  type="text"
                  placeholder="Date, status or reason..."
                  class="flex-1 bg-transparent text-[11px] outline-none
                         placeholder:text-sky-100/80"
                />
              </div>
            </div>

            <!-- Status filter -->
            <div class="flex items-center gap-1 text-[11px]">
              <span class="mr-1 text-sky-50/80">Status</span>
              <div class="flex rounded-full bg-sky-900/20 p-0.5">
                <button
                  type="button"
                  class="rounded-full px-2.5 py-1 text-[11px] font-medium"
                  :class="statusFilter === 'ALL'
                    ? 'bg-white/95 text-sky-700 shadow-sm'
                    : 'text-sky-100 hover:bg-sky-900/40'"
                  @click="statusFilter = 'ALL'"
                >
                  All
                </button>
                <button
                  type="button"
                  class="rounded-full px-2.5 py-1 text-[11px] font-medium"
                  :class="statusFilter === 'PENDING_MANAGER'
                    ? 'bg-white/95 text-sky-700 shadow-sm'
                    : 'text-sky-100 hover:bg-sky-900/40'"
                  @click="statusFilter = 'PENDING_MANAGER'"
                >
                  Manager
                </button>
                <button
                  type="button"
                  class="rounded-full px-2.5 py-1 text-[11px] font-medium"
                  :class="statusFilter === 'PENDING_GM'
                    ? 'bg-white/95 text-sky-700 shadow-sm'
                    : 'text-sky-100 hover:bg-sky-900/40'"
                  @click="statusFilter = 'PENDING_GM'"
                >
                  GM
                </button>
                <button
                  type="button"
                  class="rounded-full px-2.5 py-1 text-[11px] font-medium"
                  :class="statusFilter === 'APPROVED'
                    ? 'bg-white/95 text-sky-700 shadow-sm'
                    : 'text-sky-100 hover:bg-sky-900/40'"
                  @click="statusFilter = 'APPROVED'"
                >
                  Approved
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Mobile header / filters -->
        <div v-else class="space-y-2">
          <div>
            <p class="text-[10px] uppercase tracking-[0.25em] text-sky-100/80">Expat leave</p>
            <p class="text-sm font-semibold">My Replace Day Requests</p>
            <p class="text-[11px] text-sky-50/90">All your replace-day requests & status.</p>
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between gap-2">
              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-xl bg-white/95 px-3 py-1.5
                       text-[11px] font-semibold text-sky-700 shadow-sm"
                @click="goCreate"
              >
                <i class="fa-solid fa-plus text-[11px]" />
                New
              </button>

              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-xl border border-sky-100/70 bg-sky-900/25 px-3 py-1.5
                       text-[11px] font-semibold text-sky-50/95 hover:bg-sky-900/35 disabled:opacity-60"
                @click="fetchMyReplaceDays"
                :disabled="loading"
              >
                <i class="fa-solid" :class="loading ? 'fa-spinner animate-spin' : 'fa-rotate-right'"></i>
                Refresh
              </button>
            </div>

            <div class="space-y-1">
              <label class="mb-1 block text-[11px] font-medium text-sky-50">Search</label>
              <div
                class="flex items-center rounded-xl border border-sky-100/80 bg-sky-900/25
                       px-2.5 py-1.5 text-[11px]"
              >
                <i class="fa-solid fa-magnifying-glass mr-2 text-xs text-sky-50/80" />
                <input
                  v-model="search"
                  type="text"
                  placeholder="Date, status or reason..."
                  class="flex-1 bg-transparent text-[11px] outline-none
                         placeholder:text-sky-100/80"
                />
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <div class="flex items-center gap-1">
                <span class="text-sky-50/80">Status</span>
                <div class="flex rounded-full bg-sky-900/20 p-0.5">
                  <button
                    type="button"
                    class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    :class="statusFilter === 'ALL'
                      ? 'bg-white/95 text-sky-700 shadow-sm'
                      : 'text-sky-100 hover:bg-sky-900/40'"
                    @click="statusFilter = 'ALL'"
                  >
                    All
                  </button>
                  <button
                    type="button"
                    class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    :class="statusFilter === 'PENDING_MANAGER'
                      ? 'bg-white/95 text-sky-700 shadow-sm'
                      : 'text-sky-100 hover:bg-sky-900/40'"
                    @click="statusFilter = 'PENDING_MANAGER'"
                  >
                    Manager
                  </button>
                  <button
                    type="button"
                    class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    :class="statusFilter === 'PENDING_GM'
                      ? 'bg-white/95 text-sky-700 shadow-sm'
                      : 'text-sky-100 hover:bg-sky-900/40'"
                    @click="statusFilter = 'PENDING_GM'"
                  >
                    GM
                  </button>
                  <button
                    type="button"
                    class="rounded-full px-2 py-0.5 text-[11px] font-medium"
                    :class="statusFilter === 'APPROVED'
                      ? 'bg-white/95 text-sky-700 shadow-sm'
                      : 'text-sky-100 hover:bg-sky-900/40'"
                    @click="statusFilter = 'APPROVED'"
                  >
                    Approved
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div><!-- /header -->

      <!-- Body -->
      <div class="px-2 pb-2 pt-3 sm:px-3 sm:pb-3">
        <!-- Error banner -->
        <div
          v-if="loadError"
          class="mb-2 rounded-md border border-rose-400 bg-rose-50 px-3 py-2 text-[11px]
                 text-rose-700 dark:border-rose-500/70 dark:bg-rose-950/40 dark:text-rose-100"
        >
          {{ loadError }}
        </div>

        <!-- Loading skeleton -->
        <div v-if="loading && !processedRows.length" class="space-y-2">
          <div class="h-9 w-full animate-pulse rounded-xl bg-slate-200/90 dark:bg-slate-800/70"></div>
          <div
            v-for="i in 3"
            :key="'sk-' + i"
            class="h-14 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/60"
          ></div>
        </div>

        <!-- Content -->
        <div v-else>
          <!-- MOBILE: cards -->
          <div v-if="isMobile" class="space-y-2">
            <p
              v-if="!pagedRows.length"
              class="py-4 text-center text-[11px] text-slate-500 dark:text-slate-400"
            >
              You have not submitted any replace-day requests yet.
            </p>

            <article
              v-for="item in pagedRows"
              :key="item._id"
              class="rounded-2xl border border-slate-200 bg-white/95 p-3 text-xs
                     shadow-[0_10px_24px_rgba(15,23,42,0.12)]
                     dark:border-slate-700 dark:bg-slate-900/95"
            >
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="flex items-center gap-2">
                    <span
                      class="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5
                             text-[11px] font-semibold text-sky-700
                             border border-sky-100 dark:bg-sky-900/40 dark:text-sky-200 dark:border-sky-800/80"
                    >
                      Replace Day
                    </span>
                    <span
                      class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border"
                      :class="statusColorClass(item.status)"
                    >
                      {{ statusLabel(item.status) }}
                    </span>
                  </div>

                  <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    Worked:
                    <span class="font-medium text-slate-800 dark:text-slate-100">
                      {{ fmtYMD(item.requestDate) }}
                    </span>
                    &nbsp;→ Day off:
                    <span class="font-medium text-slate-800 dark:text-slate-100">
                      {{ fmtYMD(item.compensatoryDate) }}
                    </span>
                  </div>

                  <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    Requested:
                    <span class="font-medium text-slate-800 dark:text-slate-100">
                      {{ item.createdAt ? dayjs(item.createdAt).format('YYYY-MM-DD') : '—' }}
                    </span>
                  </div>
                </div>

                <div class="text-right text-[11px] text-slate-600 dark:text-slate-300">
                  <div>
                    Evidence:
                    <button
                      v-if="evidenceCount(item)"
                      type="button"
                      class="ml-1 inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold
                             border border-slate-200 text-slate-700 hover:bg-slate-50
                             dark:bg-slate-950 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-900"
                      @click="openEvidenceList(item)"
                    >
                      <i class="fa-regular fa-file-lines"></i>
                      {{ evidenceCount(item) }}
                    </button>
                    <span v-else class="font-semibold text-slate-900 dark:text-slate-50">0</span>
                  </div>
                </div>
              </div>

              <div class="mt-2 border-t border-slate-200 pt-1 dark:border-slate-700" />

              <div class="mt-1 text-[11px] text-slate-600 dark:text-slate-200">
                <span class="font-medium">Reason:</span>
                <span> {{ item.reason || '—' }} </span>
              </div>
            </article>
          </div>

          <!-- DESKTOP: table -->
          <div v-else class="overflow-x-auto">
            <table
              class="min-w-[900px] w-full text-left text-xs sm:text-[13px]
                     text-slate-700 dark:text-slate-100"
            >
              <thead
                class="bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-500
                       border-b border-slate-200
                       dark:bg-slate-800/80 dark:border-slate-700 dark:text-slate-300"
              >
                <tr>
                  <th class="table-th">Created</th>
                  <th class="table-th">Worked Date</th>
                  <th class="table-th">Compensatory Day Off</th>
                  <th class="table-th">Status</th>
                  <th class="table-th">Evidence</th>
                  <th class="table-th">Reason</th>
                </tr>
              </thead>

              <tbody>
                <tr v-if="!pagedRows.length">
                  <td
                    colspan="6"
                    class="px-3 py-6 text-center text-[12px] text-slate-500
                           border-t border-slate-200
                           dark:border-slate-700 dark:text-slate-400"
                  >
                    You have not submitted any replace-day requests yet.
                  </td>
                </tr>

                <tr
                  v-for="item in pagedRows"
                  :key="item._id"
                  class="border-b border-slate-200 text-[12px]
                         hover:bg-slate-50/80
                         dark:border-slate-700 dark:hover:bg-slate-900/70"
                >
                  <td class="table-td whitespace-nowrap">
                    {{ item.createdAt ? dayjs(item.createdAt).format('YYYY-MM-DD') : '—' }}
                  </td>

                  <td class="table-td whitespace-nowrap">
                    {{ fmtYMD(item.requestDate) }}
                  </td>

                  <td class="table-td whitespace-nowrap">
                    {{ fmtYMD(item.compensatoryDate) }}
                  </td>

                  <td class="table-td">
                    <span
                      class="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                      :class="statusColorClass(item.status)"
                    >
                      {{ statusLabel(item.status) }}
                    </span>
                  </td>

                  <td class="table-td whitespace-nowrap">
                    <button
                      v-if="evidenceCount(item)"
                      type="button"
                      class="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px]
                             border border-slate-200 text-slate-700 hover:bg-slate-50
                             dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800"
                      @click="openEvidenceList(item)"
                    >
                      <i class="fa-regular fa-file-lines mr-1"></i>
                      {{ evidenceCount(item) }} file(s)
                    </button>
                    <span
                      v-else
                      class="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px]
                             border border-slate-200 text-slate-600
                             dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700"
                    >
                      0
                    </span>
                  </td>

                  <td class="table-td">
                    <span class="block max-w-xs truncate text-xs sm:text-[13px] text-slate-700 dark:text-slate-100">
                      {{ item.reason || '—' }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Pagination -->
          <div
            v-if="processedRows.length"
            class="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-2
                   text-[11px] text-slate-600
                   dark:border-slate-700 dark:text-slate-300
                   sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="flex items-center gap-2">
              <span>Rows per page</span>
              <select
                v-model="perPage"
                class="rounded-lg border border-slate-300 bg-white px-2 py-1
                       text-[11px] dark:border-slate-600 dark:bg-slate-900"
              >
                <option v-for="opt in perPageOptions" :key="'per-' + opt" :value="opt">
                  {{ opt }}
                </option>
              </select>
            </div>

            <div class="flex items-center justify-end gap-1">
              <button type="button" class="pagination-btn" :disabled="page <= 1" @click="page = 1">«</button>
              <button
                type="button"
                class="pagination-btn"
                :disabled="page <= 1"
                @click="page = Math.max(1, page - 1)"
              >
                Prev
              </button>
              <span class="px-2">Page {{ page }} / {{ pageCount }}</span>
              <button
                type="button"
                class="pagination-btn"
                :disabled="page >= pageCount"
                @click="page = Math.min(pageCount, page + 1)"
              >
                Next
              </button>
              <button type="button" class="pagination-btn" :disabled="page >= pageCount" @click="page = pageCount">»</button>
            </div>
          </div>

          <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            Tip: Replace day flow is <span class="font-medium">Manager → GM → Approved</span>.
          </div>
        </div>
      </div>
    </div>

    <!-- Evidence Modal -->
    <div v-if="evidenceOpen" class="fixed inset-0 z-50">
      <div class="absolute inset-0 bg-black/55" @click="closeEvidence"></div>

      <div class="absolute inset-0 flex items-center justify-center p-3 sm:p-6">
        <div
          class="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl
                 dark:border-slate-800 dark:bg-slate-900"
        >
          <div
            class="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3
                   dark:border-slate-800"
          >
            <div>
              <p class="text-sm font-semibold">Evidence files</p>
              <p class="text-[11px] text-slate-500 dark:text-slate-300">
                Worked: <span class="font-medium">{{ fmtYMD(evidenceFor?.requestDate) }}</span>
                &nbsp;→ Day off: <span class="font-medium">{{ fmtYMD(evidenceFor?.compensatoryDate) }}</span>
              </p>
            </div>

            <button
              type="button"
              class="inline-flex h-8 w-8 items-center justify-center rounded-md
                     hover:bg-slate-100 dark:hover:bg-slate-800"
              @click="closeEvidence"
              aria-label="Close"
            >
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>

          <div class="p-4">
            <div v-if="!evidenceCount(evidenceFor)" class="py-6 text-center text-sm text-slate-500 dark:text-slate-300">
              No evidence attached.
            </div>

            <div v-else class="space-y-2">
              <div
                v-for="ev in (evidenceFor?.evidences || [])"
                :key="ev._id"
                class="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2
                       dark:border-slate-800 dark:bg-slate-950/40"
              >
                <div class="min-w-0">
                  <p class="truncate text-sm font-semibold text-slate-900 dark:text-slate-50">
                    {{ ev.filename || 'evidence' }}
                  </p>
                  <p class="mt-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                    {{ ev.mimetype || 'file' }}
                    · {{ prettyBytes(ev.size) }}
                    · {{ ev.uploadedAt ? dayjs(ev.uploadedAt).format('YYYY-MM-DD HH:mm') : '—' }}
                  </p>
                </div>

                <div class="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px]
                           hover:bg-slate-50 disabled:opacity-60
                           dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                    :disabled="evidenceLoadingId === String(ev._id)"
                    @click="viewEvidence(evidenceFor?._id, ev)"
                    title="Open in new tab"
                  >
                    <i class="fa-regular" :class="evidenceLoadingId === String(ev._id) ? 'fa-spinner animate-spin' : 'fa-eye'"></i>
                    View
                  </button>

                  <button
                    type="button"
                    class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px]
                           hover:bg-slate-50 disabled:opacity-60
                           dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                    :disabled="evidenceLoadingId === String(ev._id)"
                    @click="downloadEvidence(evidenceFor?._id, ev)"
                    title="Download"
                  >
                    <i class="fa-solid" :class="evidenceLoadingId === String(ev._id) ? 'fa-spinner animate-spin' : 'fa-download'"></i>
                    Download
                  </button>
                </div>
              </div>

              <p class="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
                If View/Download fails, confirm backend route:
                <span class="font-medium">GET /api/leave/replace-days/:id/evidences/:evidenceId</span>
              </p>
            </div>
          </div>

          <div class="border-t border-slate-200 px-4 py-3 text-right dark:border-slate-800">
            <button
              type="button"
              class="rounded-xl border border-slate-300 bg-white px-4 py-2 text-[12px]
                     hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
              @click="closeEvidence"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.table-th {
  padding: 8px 10px;
  text-align: left;
  font-size: 11px;
  font-weight: 700;
}
.table-td {
  padding: 8px 10px;
  vertical-align: top;
}

/* Pagination (same standard) */
.pagination-btn {
  padding: 4px 8px;
  border-radius: 999px;
  border: 1.5px solid rgba(100, 116, 139, 0.95);
  background: white;
  font-size: 11px;
  color: #0f172a;
}
.pagination-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.pagination-btn:not(:disabled):hover {
  background: #e5edff;
}
.dark .pagination-btn {
  background: #020617;
  border-color: rgba(148, 163, 184, 0.9);
  color: #e5e7eb;
}
.dark .pagination-btn:not(:disabled):hover {
  background: #1e293b;
}
</style>
