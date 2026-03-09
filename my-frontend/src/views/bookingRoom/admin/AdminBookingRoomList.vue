<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'

defineOptions({ name: 'AdminBookingRoomList' })

const { showToast } = useToast()

/* ───────── Formatters ───────── */
function s(v) { return String(v ?? '').trim() }
function up(v) { return s(v).toUpperCase() }
function arr(v) { return Array.isArray(v) ? v : [] }
function fmtDate(v) { return s(v) || '—' }
function fmtTime(v) { return s(v) || '—' }
function fmtDateTime(v) {
  if (!v) return '—'
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : '—'
}
function materialItemsToText(items = []) {
  return arr(items)
    .map((x) => {
      const name = s(x?.materialName) || s(x?.materialCode)
      const qty = Number(x?.qty || 0)
      return name ? `${name}${qty > 0 ? ` x${qty}` : ''}` : ''
    })
    .filter(Boolean)
    .join(', ')
}

/* ───────── UI Badges ───────── */
function statusClass(v) {
  const x = up(v)
  if (x === 'APPROVED') return 'ui-badge-success'
  if (x === 'REJECTED' || x === 'CANCELLED') return 'ui-badge-danger'
  if (x === 'PARTIAL_APPROVED') return 'ui-badge-warning'
  if (x === 'PENDING') return 'ui-badge-warning'
  return 'ui-badge-info'
}
function cleanText(v) {
  return s(v) || '—'
}

/* ───────── Responsive State ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 1024 // lg breakpoint
}

/* ───────── State ───────── */
const loading = ref(false)
const exporting = ref(false)
const rows = ref([])

const filters = ref({
  date: '',
  dateFrom: '',
  dateTo: '',
  overallStatus: 'ALL',
  roomStatus: 'ALL',
  materialStatus: 'ALL',
  roomCode: '',
  materialCode: '',
  q: '',
})

// Pagination
const page = ref(1)
const perPage = ref(10)
const perPageOptions = [10, 20, 50, 'All']

const detailOpen = ref(false)
const detailRow = ref(null)

/* ───────── Computed ───────── */


const pagedRows = computed(() => {
  if (perPage.value === 'All') return rows.value
  const per = Number(perPage.value || 10)
  const start = (page.value - 1) * per
  return rows.value.slice(start, start + per)
})

const pageCount = computed(() => {
  if (perPage.value === 'All') return 1
  const per = Number(perPage.value || 10)
  return Math.ceil(rows.value.length / per) || 1
})

watch(perPage, () => { page.value = 1 })

/* ───────── API ───────── */
function buildParams() {
  const p = {}
  if (s(filters.value.date)) p.date = s(filters.value.date)
  if (s(filters.value.dateFrom)) p.dateFrom = s(filters.value.dateFrom)
  if (s(filters.value.dateTo)) p.dateTo = s(filters.value.dateTo)
  if (up(filters.value.overallStatus) !== 'ALL') p.overallStatus = up(filters.value.overallStatus)
  if (up(filters.value.roomStatus) !== 'ALL') p.roomStatus = up(filters.value.roomStatus)
  if (up(filters.value.materialStatus) !== 'ALL') p.materialStatus = up(filters.value.materialStatus)
  if (s(filters.value.roomCode)) p.roomCode = up(filters.value.roomCode)
  if (s(filters.value.materialCode)) p.materialCode = up(filters.value.materialCode)
  if (s(filters.value.q)) p.q = s(filters.value.q)
  return p
}

async function fetchRows() {
  try {
    loading.value = true
    const { data } = await api.get('/booking-room/admin/list', { params: buildParams() })
    rows.value = Array.isArray(data) ? data : []
    page.value = 1 
  } catch (e) {
    console.error('fetchRows error', e)
    rows.value = []
    showToast({ type: 'error', message: e?.response?.data?.message || 'Unable to load booking list.' })
  } finally {
    loading.value = false
  }
}

async function exportExcel() {
  try {
    exporting.value = true
    const res = await api.get('/booking-room/admin/export', {
      params: buildParams(),
      responseType: 'blob',
    })
    const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'booking-room.xlsx'
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(url)
    showToast({ type: 'success', message: 'Excel exported successfully.' })
  } catch (e) {
    console.error('exportExcel error', e)
    showToast({ type: 'error', message: e?.response?.data?.message || 'Unable to export Excel.' })
  } finally {
    exporting.value = false
  }
}

/* ───────── Actions ───────── */
function resetFilters() {
  filters.value = {
    date: '', dateFrom: '', dateTo: '',
    overallStatus: 'ALL', roomStatus: 'ALL', materialStatus: 'ALL',
    roomCode: '', materialCode: '', q: '',
  }
  fetchRows()
}

function openDetail(row) {
  detailRow.value = row || null
  detailOpen.value = true
}

function closeDetail() {
  detailOpen.value = false
  detailRow.value = null
}

/* ───────── Modal UX: Body Lock & ESC ───────── */
function lockBodyScroll(on) {
  if (typeof document === 'undefined') return
  if (on) document.body.classList.add('overflow-hidden')
  else document.body.classList.remove('overflow-hidden')
}

watch(detailOpen, (val) => lockBodyScroll(val))

function onKeydown(e) {
  if (e.key === 'Escape' && detailOpen.value) closeDetail()
}

/* ───────── Lifecycle ───────── */
onMounted(() => {
  updateIsMobile()
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateIsMobile)
    window.addEventListener('keydown', onKeydown)
  }
  fetchRows()
})

onBeforeUnmount(() => {
  lockBodyScroll(false)
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateIsMobile)
    window.removeEventListener('keydown', onKeydown)
  }
})
</script>

<template>
  <div class="ui-page min-h-[calc(100vh-48px)] p-2 sm:p-4">
    
    <div class="mx-auto w-full max-w-7xl space-y-4">
      
      <div class="ui-card overflow-hidden">
        
        <div class="ui-hero-gradient">
          <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">

            <div class="flex flex-wrap items-center gap-2 shrink-0">
              <button type="button" class="ui-hero-btn" @click="fetchRows" :disabled="loading">
                <i :class="loading ? 'fa-solid fa-spinner animate-spin' : 'fa-solid fa-rotate-right'" class="text-[11px]" />
                Refresh
              </button>
              <button type="button" class="ui-hero-btn ui-hero-btn-primary" @click="exportExcel" :disabled="exporting">
                <i :class="exporting ? 'fa-solid fa-spinner animate-spin' : 'fa-solid fa-file-excel'" class="text-[11px]" />
                Export
              </button>
            </div>
          </div>
        </div>

        <div class="p-4 bg-slate-50/50 dark:bg-slate-900/20">
          <div class="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            <div class="ui-field">
              <label class="ui-label">Keyword</label>
              <input v-model="filters.q" type="text" class="ui-input" placeholder="Employee, room..." @keyup.enter="fetchRows" />
            </div>
            <div class="ui-field">
              <label class="ui-label">Specific Date</label>
              <input v-model="filters.date" type="date" class="ui-date" />
            </div>
            <div class="ui-field">
              <label class="ui-label">From Date</label>
              <input v-model="filters.dateFrom" type="date" class="ui-date" />
            </div>
            <div class="ui-field">
              <label class="ui-label">To Date</label>
              <input v-model="filters.dateTo" type="date" class="ui-date" />
            </div>
            <div class="ui-field">
              <label class="ui-label">Overall Status</label>
              <select v-model="filters.overallStatus" class="ui-select">
                <option value="ALL">All</option>
                <option value="PENDING">Pending</option>
                <option value="PARTIAL_APPROVED">Partial</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
            <div class="ui-field">
              <label class="ui-label">Room Code</label>
              <input v-model="filters.roomCode" type="text" class="ui-input" placeholder="e.g. ROOM_A" />
            </div>
            <div class="ui-field">
              <label class="ui-label">Room Status</label>
              <select v-model="filters.roomStatus" class="ui-select">
                <option value="ALL">All</option>
                <option value="NOT_REQUIRED">Not Required</option>
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>
            <div class="ui-field">
              <label class="ui-label">Material Code</label>
              <input v-model="filters.materialCode" type="text" class="ui-input" placeholder="e.g. PROJ" />
            </div>
            <div class="ui-field">
              <label class="ui-label">Material Status</label>
              <select v-model="filters.materialStatus" class="ui-select">
                <option value="ALL">All</option>
                <option value="NOT_REQUIRED">Not Required</option>
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>
            <div class="flex items-end gap-2 md:col-span-3 lg:col-span-4 xl:col-span-1 h-full pt-1">
              <button type="button" class="ui-btn ui-btn-soft w-full" @click="resetFilters">Reset</button>
              <button type="button" class="ui-btn ui-btn-primary w-full" @click="fetchRows" :disabled="loading">Search</button>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div v-if="loading && !rows.length" class="space-y-3">
          <div class="ui-skeleton h-12 w-full" />
          <div v-for="i in 3" :key="'sk-' + i" class="ui-skeleton h-16 w-full" />
        </div>

        <div v-else>
          <div v-if="isMobile" class="space-y-3">
            <div v-if="!pagedRows.length" class="ui-frame p-6 text-center text-[12px] text-slate-500 dark:text-slate-400">
              No booking records found.
            </div>

            <div v-for="row in pagedRows" :key="row._id" class="ui-card p-4">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-[14px] font-black text-slate-900 dark:text-slate-50 break-words">
                    {{ row.meetingTitle || 'No title' }}
                  </div>
                  <div class="mt-1 text-[12px] font-semibold text-slate-500 dark:text-slate-400">
                    {{ row.employee?.name || '—' }} • {{ row.employeeId || '—' }}
                  </div>
                </div>
                <span class="ui-badge shrink-0" :class="statusClass(row.overallStatus)">{{ row.overallStatus }}</span>
              </div>

              <div class="my-3 ui-divider" />

              <div class="grid grid-cols-2 gap-3">
                <div class="ui-frame p-3">
                  <div class="ui-label">Booking Date</div>
                  <div class="mt-1 text-[12px] font-bold text-slate-900 dark:text-slate-50">{{ fmtDate(row.bookingDate) }}</div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">{{ fmtTime(row.timeStart) }} - {{ fmtTime(row.timeEnd) }}</div>
                </div>
                <div class="ui-frame p-3">
                  <div class="ui-label">Room</div>
                  <div class="mt-1 text-[12px] font-bold text-slate-900 dark:text-slate-50 truncate">{{ row.roomName || '—' }}</div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">{{ row.roomCode || '—' }}</div>
                </div>
              </div>

              <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div class="flex flex-wrap gap-2">
                  <span class="ui-badge" :class="statusClass(row.roomStatus)">Room: {{ row.roomStatus || '—' }}</span>
                  <span class="ui-badge" :class="statusClass(row.materialStatus)">Mat: {{ row.materialStatus || '—' }}</span>
                </div>
                <button type="button" class="ui-btn ui-btn-soft ui-btn-sm shrink-0" @click="openDetail(row)">
                  <i class="fa-solid fa-eye" /> View
                </button>
              </div>
            </div>
          </div>

          <div v-else class="ui-table-wrap ui-scrollbar w-full overflow-x-auto block border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm bg-white dark:bg-slate-900">
            <table class="ui-table min-w-[1000px] w-full text-left">
              <thead>
                <tr>
                  <th class="ui-th w-[130px] pl-4">Date & Time</th>
                  <th class="ui-th w-[160px]">Employee</th>
                  <th class="ui-th min-w-[150px]">Meeting Title</th>
                  <th class="ui-th min-w-[150px]">Room & Materials</th>
                  <th class="ui-th text-center w-[110px]">Room Status</th>
                  <th class="ui-th text-center w-[110px]">Mat Status</th>
                  <th class="ui-th text-center w-[110px]">Overall</th>
                  <th class="ui-th text-center w-[70px] pr-4">View</th>
                </tr>
              </thead>

              <tbody>
                <tr v-if="!pagedRows.length">
                  <td colspan="8" class="ui-td py-10 text-slate-500 dark:text-slate-400 text-center">
                    No booking records found.
                  </td>
                </tr>

                <tr v-for="row in pagedRows" :key="row._id" class="ui-tr-hover">
                  <td class="ui-td whitespace-nowrap pl-4 text-left">
                    <div class="font-bold text-slate-900 dark:text-slate-50">{{ fmtDate(row.bookingDate) }}</div>
                    <div class="text-[10px] text-slate-500 dark:text-slate-400">{{ fmtTime(row.timeStart) }} - {{ fmtTime(row.timeEnd) }}</div>
                  </td>
                  <td class="ui-td text-left">
                    <div class="font-bold text-slate-900 dark:text-slate-50 truncate max-w-[150px]">{{ row.employee?.name || '—' }}</div>
                    <div class="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[150px]">{{ row.employeeId || '—' }} • {{ row.employee?.department || '—' }}</div>
                  </td>
                  <td class="ui-td font-bold text-slate-800 dark:text-slate-100 text-left">{{ row.meetingTitle || '—' }}</td>
                  <td class="ui-td text-left">
                    <div class="font-bold text-slate-900 dark:text-slate-50">{{ row.roomName || '—' }}</div>
                    <div class="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[180px]" :title="materialItemsToText(row.materials)">
                      {{ materialItemsToText(row.materials) || 'No materials' }}
                    </div>
                  </td>
                  <td class="ui-td text-center">
                    <span class="ui-badge" :class="statusClass(row.roomStatus)">{{ row.roomStatus || '—' }}</span>
                  </td>
                  <td class="ui-td text-center">
                    <span class="ui-badge" :class="statusClass(row.materialStatus)">{{ row.materialStatus || '—' }}</span>
                  </td>
                  <td class="ui-td text-center">
                    <span class="ui-badge" :class="statusClass(row.overallStatus)">{{ row.overallStatus || '—' }}</span>
                  </td>
                  <td class="ui-td text-center pr-4">
                    <button type="button" class="ui-btn ui-btn-soft ui-btn-xs" @click="openDetail(row)">
                      <i class="fa-solid fa-eye" />
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div
            v-if="rows.length"
            class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-1"
          >
            <div class="flex items-center gap-2">
              <select v-model="perPage" class="ui-select !py-1 !pr-8 !rounded-full w-auto min-w-[80px]">
                <option v-for="opt in perPageOptions" :key="'per-' + opt" :value="opt">{{ opt }} / page</option>
              </select>
            </div>

            <div class="flex items-center justify-end gap-1.5">
              <button type="button" class="ui-pagebtn" :disabled="page <= 1" @click="page = 1">«</button>
              <button type="button" class="ui-pagebtn" :disabled="page <= 1" @click="page = Math.max(1, page - 1)">Prev</button>
              <span class="px-3 text-[11px] font-extrabold text-slate-600 dark:text-slate-300">Page {{ page }} of {{ pageCount }}</span>
              <button type="button" class="ui-pagebtn" :disabled="page >= pageCount" @click="page = Math.min(pageCount, page + 1)">Next</button>
              <button type="button" class="ui-pagebtn" :disabled="page >= pageCount" @click="page = pageCount">»</button>
            </div>
          </div>
        </div>
      </div>

    </div>

    <div v-if="detailOpen && detailRow" class="ui-modal-backdrop" @click.self="closeDetail">
      <div class="ui-modal !max-w-4xl p-0 overflow-hidden">
        
        <div class="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/20">
          <div class="min-w-0">
            <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Booking Detail</div>
            <div class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">{{ detailRow.meetingTitle || 'No title' }}</div>
          </div>
          <button class="ui-btn ui-btn-ghost ui-btn-sm shrink-0" type="button" @click="closeDetail">
            <i class="fa-solid fa-xmark text-[12px]" /> Close
          </button>
        </div>

        <div class="p-5 space-y-4 max-h-[75vh] overflow-y-auto ui-scrollbar">
          
          <div class="grid gap-4 lg:grid-cols-2">
            <div class="ui-frame p-4">
              <div class="ui-section-title mb-3">Requester Information</div>
              <div class="grid grid-cols-2 gap-3 text-[12px]">
                <div class="ui-field"><div class="ui-label">Name</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ cleanText(detailRow.employee?.name) }}</div></div>
                <div class="ui-field"><div class="ui-label">Employee ID</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ cleanText(detailRow.employeeId) }}</div></div>
                <div class="ui-field"><div class="ui-label">Department</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ cleanText(detailRow.employee?.department) }}</div></div>
                <div class="ui-field"><div class="ui-label">Contact</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ cleanText(detailRow.employee?.contactNumber) }}</div></div>
                <div class="ui-field col-span-2"><div class="ui-label">Submitted Via</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ cleanText(detailRow.submittedVia) }}</div></div>
              </div>
            </div>

            <div class="ui-frame p-4">
              <div class="ui-section-title mb-3">Booking Information</div>
              <div class="grid grid-cols-2 gap-3 text-[12px]">
                <div class="ui-field"><div class="ui-label">Date</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ fmtDate(detailRow.bookingDate) }}</div></div>
                <div class="ui-field"><div class="ui-label">Time</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ fmtTime(detailRow.timeStart) }} - {{ fmtTime(detailRow.timeEnd) }}</div></div>
                <div class="ui-field col-span-2"><div class="ui-label">Purpose</div><div class="font-bold text-slate-900 dark:text-slate-50 whitespace-pre-wrap">{{ cleanText(detailRow.purpose) }}</div></div>
                <div class="ui-field"><div class="ui-label">Participants</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ detailRow.participantEstimate ?? '—' }}</div></div>
                <div class="ui-field"><div class="ui-label">Created At</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ fmtDateTime(detailRow.createdAt) }}</div></div>
              </div>
            </div>
          </div>

          <div class="grid gap-4 lg:grid-cols-2">
            <div class="ui-frame p-4">
              <div class="flex items-center justify-between mb-3 border-b border-slate-200 dark:border-slate-800 pb-2">
                <div class="ui-section-title">Room Details</div>
                <span class="ui-badge" :class="statusClass(detailRow.roomStatus)">{{ detailRow.roomStatus || '—' }}</span>
              </div>
              <div class="grid grid-cols-2 gap-3 text-[12px]">
                <div class="ui-field"><div class="ui-label">Required</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ detailRow.roomRequired ? 'YES' : 'NO' }}</div></div>
                <div class="ui-field"><div class="ui-label">Room Code</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ cleanText(detailRow.roomCode) }}</div></div>
                <div class="ui-field col-span-2"><div class="ui-label">Room Name</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ cleanText(detailRow.roomName) }}</div></div>
                <div class="ui-field"><div class="ui-label">Decision By</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ cleanText(detailRow.roomApproval?.byName || detailRow.roomApproval?.byLoginId) }}</div></div>
                <div class="ui-field"><div class="ui-label">Decision At</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ fmtDateTime(detailRow.roomApproval?.decidedAt) }}</div></div>
                <div class="ui-field col-span-2"><div class="ui-label">Note</div><div class="font-bold text-slate-900 dark:text-slate-50 whitespace-pre-wrap">{{ cleanText(detailRow.roomApproval?.note) }}</div></div>
              </div>
            </div>

            <div class="ui-frame p-4">
              <div class="flex items-center justify-between mb-3 border-b border-slate-200 dark:border-slate-800 pb-2">
                <div class="ui-section-title">Material Details</div>
                <span class="ui-badge" :class="statusClass(detailRow.materialStatus)">{{ detailRow.materialStatus || '—' }}</span>
              </div>
              <div class="grid grid-cols-2 gap-3 text-[12px]">
                <div class="ui-field"><div class="ui-label">Required</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ detailRow.materialRequired ? 'YES' : 'NO' }}</div></div>
                <div class="ui-field"><div class="ui-label">Decision</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ cleanText(detailRow.materialApproval?.decision) }}</div></div>
                <div class="ui-field col-span-2"><div class="ui-label">Materials</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ materialItemsToText(detailRow.materials) || '—' }}</div></div>
                <div class="ui-field"><div class="ui-label">Decision By</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ cleanText(detailRow.materialApproval?.byName || detailRow.materialApproval?.byLoginId) }}</div></div>
                <div class="ui-field"><div class="ui-label">Decision At</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ fmtDateTime(detailRow.materialApproval?.decidedAt) }}</div></div>
                <div class="ui-field col-span-2"><div class="ui-label">Note</div><div class="font-bold text-slate-900 dark:text-slate-50 whitespace-pre-wrap">{{ cleanText(detailRow.materialApproval?.note) }}</div></div>
              </div>
            </div>
          </div>

          <div class="ui-frame p-4 border-l-4 border-l-sky-500">
             <div class="flex items-center justify-between mb-3">
                <div class="ui-section-title">Final Request Status</div>
                <span class="ui-badge" :class="statusClass(detailRow.overallStatus)">{{ detailRow.overallStatus || '—' }}</span>
             </div>
             <div class="grid grid-cols-3 gap-3 text-[12px]">
                <div class="ui-field"><div class="ui-label">Updated At</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ fmtDateTime(detailRow.updatedAt) }}</div></div>
                <div class="ui-field col-span-2"><div class="ui-label">Cancel Reason</div><div class="font-bold text-slate-900 dark:text-slate-50">{{ cleanText(detailRow.cancelReason) }}</div></div>
             </div>
          </div>

        </div>
      </div>
    </div>
  </div>
</template>