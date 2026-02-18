<!-- src/views/expat/ManagerLeaveInbox.vue
  ✅ Same UI system (ui-page / ui-card / ui-hero-gradient / ui-table)
  ✅ TRUE FULL WIDTH on laptop (no container max-width)
  ✅ Responsive: mobile cards + desktop table
  ✅ Filters: search + requested date range + optional expat id
  ✅ Actions: Export CSV + Refresh + Clear
  ✅ Approve + Reject (Manager) = ICON ONLY (save column width)
  ✅ Realtime refresh
  ✅ Attachments: READ-ONLY + blob preview (fix 401)
  ✅ NO SweetAlert / NO window.alert (custom modals)
-->

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/store/auth'
import { subscribeRoleIfNeeded, onSocket } from '@/utils/socket'
import * as XLSX from 'xlsx'

defineOptions({ name: 'ManagerLeaveInbox' })

const { showToast } = useToast()
const auth = useAuth()

/* ───────── responsive flag ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────── STATE ───────── */
const loading = ref(false)
const rows = ref([])

const search = ref('')
const fromDate = ref('') // Requested at (createdAt)
const toDate = ref('') // Requested at (createdAt)
const employeeFilter = ref('') // optional expat id filter

/* Pagination */
const page = ref(1)
const perPage = ref(20)
const perPageOptions = [20, 50, 100, 'All']

/* ───────── helpers ───────── */
function formatRange(row) {
  const s = row.startDate ? dayjs(row.startDate).format('DD-MM-YYYY') : ''
  const e = row.endDate ? dayjs(row.endDate).format('DD-MM-YYYY') : ''
  if (!s && !e) return '—'
  if (s === e) return s
  return `${s} → ${e}`
}

function statusChipClasses(status) {
  switch (String(status || '').toUpperCase()) {
    case 'PENDING_MANAGER':
      return 'bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700/80'
    case 'PENDING_GM':
      return 'bg-indigo-100 text-indigo-700 border border-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-200 dark:border-indigo-700/80'
    case 'PENDING_COO':
      return 'bg-sky-100 text-sky-700 border border-sky-200 dark:bg-sky-900/40 dark:text-sky-200 dark:border-sky-700/80'
    case 'APPROVED':
      return 'bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700/80'
    case 'REJECTED':
      return 'bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-900/40 dark:text-rose-200 dark:border-rose-700/80'
    case 'CANCELLED':
    default:
      return 'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800/60 dark:text-slate-200 dark:border-slate-700/80'
  }
}

function statusWeight(s) {
  switch (String(s || '').toUpperCase()) {
    case 'PENDING_MANAGER':
      return 0
    case 'PENDING_GM':
      return 1
    case 'PENDING_COO':
      return 2
    case 'APPROVED':
      return 3
    case 'REJECTED':
      return 4
    case 'CANCELLED':
      return 5
    default:
      return 99
  }
}

function clearFilters() {
  search.value = ''
  fromDate.value = ''
  toDate.value = ''
  employeeFilter.value = ''
}

/* ───────── API ───────── */
async function fetchInbox() {
  try {
    loading.value = true
    const res = await api.get('/leave/requests/manager/inbox?scope=ALL')
    rows.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    console.error('fetchInbox error', e)
    showToast({
      type: 'error',
      title: 'Failed to load',
      message: e?.response?.data?.message || 'Unable to load manager inbox.',
    })
  } finally {
    loading.value = false
  }
}

/* ───────── Filters ───────── */
const filteredRows = computed(() => {
  const q = search.value.trim().toLowerCase()
  const empQ = employeeFilter.value.trim().toLowerCase()

  let list = [...rows.value]

  if (empQ) list = list.filter((r) => String(r.employeeId || '').toLowerCase().includes(empQ))

  if (q) {
    list = list.filter(
      (r) =>
        String(r.employeeId || '').toLowerCase().includes(q) ||
        String(r.employeeName || '').toLowerCase().includes(q) ||
        String(r.department || '').toLowerCase().includes(q) ||
        String(r.leaveTypeCode || '').toLowerCase().includes(q) ||
        String(r.reason || '').toLowerCase().includes(q) ||
        String(r.status || '').toLowerCase().includes(q)
    )
  }

  const fromVal = fromDate.value ? dayjs(fromDate.value).startOf('day').valueOf() : null
  const toVal = toDate.value ? dayjs(toDate.value).endOf('day').valueOf() : null

  if (fromVal !== null || toVal !== null) {
    list = list.filter((r) => {
      if (!r.createdAt) return false
      const t = dayjs(r.createdAt).valueOf()
      if (fromVal !== null && t < fromVal) return false
      if (toVal !== null && t > toVal) return false
      return true
    })
  }

  list.sort((a, b) => {
    const sw = statusWeight(a.status) - statusWeight(b.status)
    if (sw !== 0) return sw
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  })

  return list
})

const pagedRows = computed(() => {
  if (perPage.value === 'All') return filteredRows.value
  const per = Number(perPage.value || 20)
  const start = (page.value - 1) * per
  return filteredRows.value.slice(start, start + per)
})

const pageCount = computed(() => {
  if (perPage.value === 'All') return 1
  const per = Number(perPage.value || 20)
  return Math.ceil(filteredRows.value.length / per) || 1
})

const totalCount = computed(() => rows.value.length)
const filteredCount = computed(() => filteredRows.value.length)

watch(
  () => [search.value, fromDate.value, toDate.value, employeeFilter.value, perPage.value],
  () => {
    page.value = 1
  }
)

/* ───────── Export CSV ───────── */
function csvEscape(v) {
  const s = String(v ?? '')
  const needs = /[",\n\r]/.test(s)
  const escaped = s.replace(/"/g, '""')
  return needs ? `"${escaped}"` : escaped
}

function downloadTextFile(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}

function buildExportRows(list) {
  return (list || []).map((r) => ({
    RequestedAt: r.createdAt ? dayjs(r.createdAt).format('YYYY-MM-DD HH:mm') : '',
    EmployeeId: r.employeeId || '',
    EmployeeName: r.employeeName || '',
    Department: r.department || '',
    LeaveType: r.leaveTypeCode || '',
    LeaveStart: r.startDate ? dayjs(r.startDate).format('YYYY-MM-DD') : '',
    LeaveEnd: r.endDate ? dayjs(r.endDate).format('YYYY-MM-DD') : '',
    TotalDays: Number(r.totalDays || 0),
    Status: r.status || '',
    Reason: (r.reason || '').replace(/\s+/g, ' ').trim(),
  }))
}

function exportExcel(scope = 'FILTERED') {
  try {
    const list = scope === 'ALL' ? rows.value : filteredRows.value
    if (!list.length) {
      showToast({ type: 'warning', title: 'Nothing to export', message: 'No rows available for export.' })
      return
    }

    // data rows (LeaveType includes BL automatically)
    const data = buildExportRows(list)

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(data)

    // nice widths (optional)
    ws['!cols'] = [
      { wch: 18 }, // RequestedAt
      { wch: 12 }, // EmployeeId
      { wch: 22 }, // EmployeeName
      { wch: 20 }, // Department
      { wch: 10 }, // LeaveType (AL/SP/BL/etc)
      { wch: 12 }, // LeaveStart
      { wch: 12 }, // LeaveEnd
      { wch: 10 }, // TotalDays
      { wch: 16 }, // Status
      { wch: 45 }, // Reason
    ]

    XLSX.utils.book_append_sheet(wb, ws, 'ManagerInbox')

    const tag =
      scope === 'ALL'
        ? 'ALL'
        : `${fromDate.value ? `_${fromDate.value}` : ''}${toDate.value ? `_${toDate.value}` : ''}` || 'FILTERED'

    const filename = `ManagerInbox_${tag}_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`
    XLSX.writeFile(wb, filename)

    showToast({ type: 'success', title: 'Exported', message: 'Downloaded Excel (.xlsx).' })
  } catch (e) {
    console.error('exportExcel error', e)
    showToast({ type: 'error', title: 'Export failed', message: 'Unable to export. Please try again.' })
  }
}

/* ───────── Approve / Reject ───────── */
const deciding = ref(false)
const decideId = ref('')
const decideAction = ref('') // 'APPROVE' | 'REJECT'
const rejectNote = ref('')

const canDecide = (row) => String(row?.status || '').toUpperCase() === 'PENDING_MANAGER'

function openApprove(row) {
  if (!row?._id) return
  decideId.value = row._id
  decideAction.value = 'APPROVE'
  rejectNote.value = ''
}

function openReject(row) {
  if (!row?._id) return
  decideId.value = row._id
  decideAction.value = 'REJECT'
  rejectNote.value = ''
}

function closeDecisionModal(force = false) {
  if (!force && deciding.value) return
  decideId.value = ''
  decideAction.value = ''
  rejectNote.value = ''
}

async function confirmDecision() {
  if (!decideId.value || !decideAction.value) return

  const action = decideAction.value === 'APPROVE' ? 'APPROVE' : 'REJECT'
  const comment = action === 'REJECT' ? rejectNote.value.trim() : ''

  if (action === 'REJECT' && !comment) {
    showToast({ type: 'warning', title: 'Reject reason required', message: 'Please enter a short reason to reject.' })
    return
  }

  try {
    deciding.value = true
    await api.post(`/leave/requests/${decideId.value}/manager-decision`, { action, comment })

    showToast({
      type: 'success',
      title: action === 'APPROVE' ? 'Approved' : 'Rejected',
      message: action === 'APPROVE' ? 'Sent to GM queue.' : 'Request rejected.',
    })

    closeDecisionModal(true)
    await fetchInbox()
  } catch (e) {
    console.error('confirmDecision error', e)
    showToast({
      type: 'error',
      title: 'Action failed',
      message: e?.response?.data?.message || 'Unable to update request. Please try again.',
    })
  } finally {
    deciding.value = false
  }
}

/* ───────── Attachments (READ ONLY) ───────── */
const attOpen = ref(false)
const attLoading = ref(false)
const attError = ref('')
const attReq = ref(null)
const attItems = ref([])

function niceBytes(n) {
  const v = Number(n || 0)
  if (!Number.isFinite(v) || v <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let idx = 0
  let val = v
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024
    idx++
  }
  return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`
}

function iconForMime(m) {
  const s = String(m || '').toLowerCase()
  if (s.includes('pdf')) return 'fa-file-pdf'
  if (s.includes('word')) return 'fa-file-word'
  if (s.includes('excel') || s.includes('spreadsheet')) return 'fa-file-excel'
  if (s.includes('image')) return 'fa-file-image'
  return 'fa-file'
}

function canPreviewInline(m) {
  const s = String(m || '').toLowerCase()
  return s.startsWith('image/') || s.includes('pdf')
}

/* Preview uses blob URLs to avoid 401 */
const previewOpen = ref(false)
const previewUrl = ref('')
const previewType = ref('')
const previewName = ref('')

function revokeBlobUrl(url) {
  try {
    if (url && String(url).startsWith('blob:')) URL.revokeObjectURL(url)
  } catch {}
}

function closePreview() {
  revokeBlobUrl(previewUrl.value)
  previewOpen.value = false
  previewUrl.value = ''
  previewType.value = ''
  previewName.value = ''
}

async function openPreview(item) {
  if (!item?.url) return
  try {
    const res = await api.request({
      url: item.url, // backend returns /api/leave/...
      method: 'GET',
      responseType: 'blob',
    })

    const blobUrl = URL.createObjectURL(res.data)
    previewUrl.value = blobUrl
    previewType.value = String(item.contentType || '')
    previewName.value = item.filename || 'Attachment'
    previewOpen.value = true
  } catch (e) {
    console.error('openPreview error', e)
    showToast({
      type: 'error',
      title: 'Preview failed',
      message: e?.response?.data?.message || e?.message || 'Unable to preview file.',
    })
  }
}

async function downloadAttachment(it) {
  if (!it?.url) return
  try {
    const res = await api.request({
      url: it.url,
      method: 'GET',
      responseType: 'blob',
    })

    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = it.filename || 'attachment'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  } catch (e) {
    console.error('downloadAttachment error', e)
    showToast({ type: 'error', title: 'Download failed', message: e?.message || 'Unable to download.' })
  }
}

async function openAttachments(row) {
  if (!row?._id) return
  attOpen.value = true
  attReq.value = row
  attItems.value = []
  attError.value = ''
  closePreview()

  try {
    attLoading.value = true
    const res = await api.get(`/leave/requests/${row._id}/attachments`)
    const items = Array.isArray(res?.data?.items) ? res.data.items : []
    attItems.value = items
  } catch (e) {
    console.error('openAttachments error', e)
    attError.value = e?.response?.data?.message || 'Unable to load attachments.'
  } finally {
    attLoading.value = false
  }
}

function closeAttachments() {
  if (attLoading.value) return
  closePreview()
  attOpen.value = false
  attReq.value = null
  attItems.value = []
  attError.value = ''
}

/* ───────── Realtime ───────── */
const offHandlers = []
let refreshTimer = null

function triggerRealtimeRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => fetchInbox(), 150)
}

function setupRealtime() {
  subscribeRoleIfNeeded({
    role: auth.user?.role,
    employeeId: auth.user?.employeeId,
    loginId: auth.user?.loginId || auth.user?.employeeId || auth.user?.id,
    company: auth.user?.companyCode,
  })

  const offCreated = onSocket('leave:req:created', () => triggerRealtimeRefresh())
  const offUpdated = onSocket('leave:req:updated', () => triggerRealtimeRefresh())
  const offManager = onSocket('leave:req:manager-decision', () => triggerRealtimeRefresh())
  const offGm = onSocket('leave:req:gm-decision', () => triggerRealtimeRefresh())
  const offCoo = onSocket('leave:req:coo-decision', () => triggerRealtimeRefresh())

  offHandlers.push(offCreated, offUpdated, offManager, offGm, offCoo)
}

onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)
  await fetchInbox()
  setupRealtime()
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
  if (refreshTimer) clearTimeout(refreshTimer)
  offHandlers.forEach((off) => {
    try {
      off && off()
    } catch {}
  })
  closePreview()
})
</script>

<template>
  <div class="ui-page min-h-screen w-full">
    <!-- ✅ FULL WIDTH FIX (no max-width container) -->
    <div class="w-full">
      <div class="ui-card rounded-none border-x-0 border-t-0">
        <div class="ui-hero-gradient">
          <!-- Desktop header -->
          <div v-if="!isMobile" class="flex flex-wrap items-end justify-between gap-4">
            <div class="flex flex-col gap-1 min-w-[240px]">
              <p class="text-[15px] font-extrabold">Manager Inbox</p>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <span class="ui-badge ui-badge-info">Total: {{ totalCount }}</span>
                <span class="ui-badge ui-badge-info">Showing: {{ filteredCount }}</span>
              </div>
            </div>

            <div class="flex flex-1 flex-wrap items-end justify-end gap-3">
              <!-- Search -->
              <div class="min-w-[240px] max-w-xs">
                <div class="ui-field">
                  <label class="text-[11px] font-extrabold text-white/90">Search</label>
                  <div class="flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-3 py-2">
                    <i class="fa-solid fa-magnifying-glass text-[12px] text-white/80" />
                    <input
                      v-model="search"
                      type="text"
                      placeholder="Employee / type / reason..."
                      class="w-full bg-transparent text-[12px] text-white outline-none placeholder:text-white/70"
                    />
                  </div>
                </div>
              </div>

              <!-- Requested at range filter -->
              <div class="flex items-end gap-2">
                <div class="ui-field w-[150px]">
                  <label class="text-[11px] font-extrabold text-white/90">Requested from</label>
                  <input v-model="fromDate" type="date" class="ui-date" />
                </div>
                <div class="ui-field w-[150px]">
                  <label class="text-[11px] font-extrabold text-white/90">Requested to</label>
                  <input v-model="toDate" type="date" class="ui-date" />
                </div>
              </div>
              <!-- Actions -->
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="ui-btn ui-btn-sm ui-btn-indigo"
                  @click="exportExcel('FILTERED')"
                  :disabled="loading || !filteredRows.length"
                  title="Export filtered list"
                >
                  <i class="fa-solid fa-file-excel text-[11px]" />
                  Export
                </button>

                <button type="button" class="ui-btn ui-btn-sm ui-btn-soft" @click="fetchInbox" :disabled="loading" title="Refresh">
                  <i class="fa-solid fa-rotate text-[11px]" />
                </button>

                <button type="button" class="ui-btn ui-btn-sm ui-btn-ghost" @click="clearFilters" :disabled="loading" title="Clear filters">
                  <i class="fa-solid fa-broom text-[11px]" />
                </button>
              </div>
            </div>
          </div>

          <!-- Mobile header -->
          <div v-else class="space-y-3">
            <div>
              <p class="text-[15px] font-extrabold">Manager Inbox</p>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <span class="ui-badge ui-badge-info">Total: {{ totalCount }}</span>
                <span class="ui-badge ui-badge-info">Showing: {{ filteredCount }}</span>
              </div>
            </div>

            <div class="space-y-2">
              <div class="ui-field">
                <label class="text-[11px] font-extrabold text-white/90">Search</label>
                <div class="flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-3 py-2">
                  <i class="fa-solid fa-magnifying-glass text-[12px] text-white/80" />
                  <input
                    v-model="search"
                    type="text"
                    placeholder="Employee / type / reason..."
                    class="w-full bg-transparent text-[12px] text-white outline-none placeholder:text-white/70"
                  />
                </div>
              </div>

              <div class="grid grid-cols-2 gap-2">
                <div class="ui-field">
                  <label class="text-[11px] font-extrabold text-white/90">Requested from</label>
                  <input v-model="fromDate" type="date" class="ui-date" />
                </div>
                <div class="ui-field">
                  <label class="text-[11px] font-extrabold text-white/90">Requested to</label>
                  <input v-model="toDate" type="date" class="ui-date" />
                </div>
              </div>

              <div class="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  class="ui-btn ui-btn-sm ui-btn-indigo"
                  @click="exportExcel('FILTERED')"
                  :disabled="loading || !filteredRows.length"
                >
                  <i class="fa-solid fa-file-excel text-[11px]" />
                  Export
                </button>

                <button type="button" class="ui-btn ui-btn-sm ui-btn-soft" @click="fetchInbox" :disabled="loading" title="Refresh">
                  <i class="fa-solid fa-rotate text-[11px]" />
                </button>

                <button type="button" class="ui-btn ui-btn-sm ui-btn-ghost" @click="clearFilters" :disabled="loading" title="Clear">
                  <i class="fa-solid fa-broom text-[11px]" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Body -->
        <div class="px-2 pb-3 pt-3 sm:px-4 lg:px-6">
          <div
            v-if="loading && !filteredRows.length"
            class="mb-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-700
                   dark:border-sky-700/70 dark:bg-sky-950/40 dark:text-sky-100"
          >
            Loading manager inbox...
          </div>

          <!-- Mobile cards -->
          <div v-if="isMobile" class="space-y-2">
            <p v-if="!pagedRows.length && !loading" class="py-6 text-center text-[11px] text-slate-500 dark:text-slate-400">
              No leave requests in your manager queue.
            </p>

            <article v-for="row in pagedRows" :key="row._id" class="ui-card p-3">
              <div class="flex items-start justify-between gap-3">
                <div class="space-y-1">
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    Requested:
                    <span class="font-semibold text-slate-900 dark:text-slate-50">
                      {{ row.createdAt ? dayjs(row.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
                    </span>
                  </div>

                  <div class="text-xs font-mono text-slate-900 dark:text-slate-50">
                    {{ row.employeeId || '—' }}
                  </div>
                  <div class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                    {{ row.employeeName || '—' }}
                  </div>

                  <div v-if="row.department" class="text-[11px] text-slate-500 dark:text-slate-400">
                    {{ row.department }}
                  </div>

                  <div class="text-[11px] text-slate-600 dark:text-slate-300">
                    Date: <span class="font-semibold">{{ formatRange(row) }}</span>
                    · Days: <span class="font-extrabold">{{ Number(row.totalDays || 0).toLocaleString() }}</span>
                  </div>
                </div>

                <div class="text-right space-y-1 text-[11px]">
                  <span class="ui-badge ui-badge-info">{{ row.leaveTypeCode || '—' }}</span>
                  <div>
                    <span
                      class="inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-[11px] font-extrabold"
                      :class="statusChipClasses(row.status)"
                    >
                      {{ row.status }}
                    </span>
                  </div>
                </div>
              </div>

              <div class="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
                <span class="font-semibold">Reason:</span> <span>{{ row.reason || '—' }}</span>
              </div>

              <div class="mt-3 flex items-center justify-between gap-2">
                <button type="button" class="ui-btn ui-btn-xs ui-btn-soft" @click="openAttachments(row)" :disabled="loading" title="View attachments">
                  <i class="fa-solid fa-paperclip text-[11px]" />
                </button>

                <!-- ✅ ICON ONLY actions on mobile too -->
                <div v-if="canDecide(row)" class="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    class="ui-btn ui-btn-xs ui-btn-emerald ui-icon-btn"
                    :disabled="loading || deciding"
                    @click="openApprove(row)"
                    title="Approve"
                    aria-label="Approve"
                  >
                    <i class="fa-solid fa-circle-check text-[12px]" />
                  </button>

                  <button
                    type="button"
                    class="ui-btn ui-btn-xs ui-btn-rose ui-icon-btn"
                    :disabled="loading || deciding"
                    @click="openReject(row)"
                    title="Reject"
                    aria-label="Reject"
                  >
                    <i class="fa-solid fa-circle-xmark text-[12px]" />
                  </button>
                </div>
              </div>
            </article>
          </div>

          <!-- Desktop table -->
          <div v-else class="ui-table-wrap">
            <!-- ✅ Use full-width responsive table (no overflow unless needed) -->
            <table class="ui-table text-left w-full min-w-[1100px]">
              <colgroup>
                <col class="w-[150px]" />
                <col class="w-[260px]" />
                <col class="w-[92px]" />
                <col class="w-[160px]" />
                <col class="w-[80px]" />
                <col />
                <col class="w-[170px]" />
                <col class="w-[96px]" />
                <col class="w-[92px]" />
              </colgroup>

              <thead>
                <tr>
                  <th class="ui-th text-left">Requested at</th>
                  <th class="ui-th text-left">Employee</th>
                  <th class="ui-th text-left">Type</th>
                  <th class="ui-th text-left">Leave Date</th>
                  <th class="ui-th text-right">Days</th>
                  <th class="ui-th text-left">Reason</th>
                  <th class="ui-th">Status</th>
                  <th class="ui-th text-center">Files</th>
                  <th class="ui-th text-center">Act</th>
                </tr>
              </thead>

              <tbody>
                <tr v-if="!loading && !filteredRows.length">
                  <td colspan="9" class="ui-td py-8 text-slate-500 dark:text-slate-400">
                    No leave requests in your manager queue.
                  </td>
                </tr>

                <tr v-for="row in pagedRows" :key="row._id" class="ui-tr-hover">
                  <td class="ui-td text-left whitespace-nowrap align-top">
                    {{ row.createdAt ? dayjs(row.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
                  </td>

                  <td class="ui-td text-left align-top">
                    <div class="text-xs font-mono text-slate-900 dark:text-slate-50">
                      {{ row.employeeId || '—' }}
                    </div>
                    <div class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                      {{ row.employeeName || '—' }}
                    </div>
                    <div v-if="row.department" class="text-[11px] text-slate-500 dark:text-slate-400">
                      {{ row.department }}
                    </div>
                  </td>

                  <td class="ui-td text-left align-top">
                    <span class="ui-badge ui-badge-info">{{ row.leaveTypeCode || '—' }}</span>
                  </td>

                  <td class="ui-td text-left whitespace-nowrap align-top">{{ formatRange(row) }}</td>

                  <td class="ui-td text-right align-top tabular-nums">{{ Number(row.totalDays || 0).toLocaleString() }}</td>

                  <td class="ui-td text-left align-top">
                    <p class="reason-cell">{{ row.reason || '—' }}</p>
                  </td>

                  <td class="ui-td align-top">
                    <span
                      class="inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-[11px] font-extrabold"
                      :class="statusChipClasses(row.status)"
                    >
                      {{ row.status }}
                    </span>
                  </td>

                  <!-- Files (icon only) -->
                  <td class="ui-td align-top text-center">
                    <button
                      type="button"
                      class="ui-btn ui-btn-xs ui-btn-soft ui-icon-btn"
                      @click="openAttachments(row)"
                      :disabled="loading"
                      title="View attachments"
                      aria-label="View attachments"
                    >
                      <i class="fa-solid fa-paperclip text-[12px]" />
                    </button>
                  </td>

                  <!-- ✅ Actions (ICON ONLY) -->
                  <td class="ui-td align-top text-center">
                    <div v-if="canDecide(row)" class="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        class="ui-btn ui-btn-xs ui-btn-emerald ui-icon-btn"
                        :disabled="loading || deciding"
                        @click="openApprove(row)"
                        title="Approve"
                        aria-label="Approve"
                      >
                        <i class="fa-solid fa-circle-check text-[12px]" />
                      </button>

                      <button
                        type="button"
                        class="ui-btn ui-btn-xs ui-btn-rose ui-icon-btn"
                        :disabled="loading || deciding"
                        @click="openReject(row)"
                        title="Reject"
                        aria-label="Reject"
                      >
                        <i class="fa-solid fa-circle-xmark text-[12px]" />
                      </button>
                    </div>
                    <span v-else class="text-[11px] text-slate-400">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Pagination -->
          <div class="mt-3 flex flex-col gap-2 ui-divider pt-3 text-[11px] text-slate-600 dark:text-slate-300 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex items-center gap-2">
              <select v-model="perPage" class="ui-select !w-auto !py-1.5 !text-[11px]">
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

    <!-- ✅ Confirm modal (Approve / Reject) -->
    <div v-if="!!decideAction" class="fixed inset-0 z-[60]">
      <div class="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" @click="closeDecisionModal" />
      <div class="absolute inset-0 flex items-center justify-center p-3">
        <div class="ui-card w-full max-w-lg p-4">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                {{ decideAction === 'APPROVE' ? 'Approve request' : 'Reject request' }}
              </p>
              <p class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                This will update the request status immediately.
              </p>
            </div>
            <button type="button" class="ui-btn ui-btn-xs ui-btn-ghost" @click="closeDecisionModal" :disabled="deciding" aria-label="Close">
              <i class="fa-solid fa-xmark" />
            </button>
          </div>

          <div class="mt-3 space-y-2">
            <div
              v-if="decideAction === 'REJECT'"
              class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
            >
              <label class="text-[11px] font-extrabold text-slate-700 dark:text-slate-200">Reject reason</label>
              <textarea
                v-model="rejectNote"
                rows="3"
                class="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-900 outline-none
                       placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
                placeholder="Example: Not enough coverage during that period..."
              />
              <p class="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                Required. This reason will be visible in request history.
              </p>
            </div>

            <div class="flex items-center justify-end gap-2 pt-1">
              <button type="button" class="ui-btn ui-btn-sm ui-btn-ghost" @click="closeDecisionModal" :disabled="deciding">
                Cancel
              </button>

              <button
                v-if="decideAction === 'APPROVE'"
                type="button"
                class="ui-btn ui-btn-sm ui-btn-emerald"
                @click="confirmDecision"
                :disabled="deciding"
              >
                <i class="fa-solid fa-circle-check text-[11px]" />
                {{ deciding ? 'Approving...' : 'Approve' }}
              </button>

              <button v-else type="button" class="ui-btn ui-btn-sm ui-btn-rose" @click="confirmDecision" :disabled="deciding">
                <i class="fa-solid fa-circle-xmark text-[11px]" />
                {{ deciding ? 'Rejecting...' : 'Reject' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ✅ Attachments modal (READ ONLY) -->
    <div v-if="attOpen" class="fixed inset-0 z-[70]">
      <div class="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" @click="closeAttachments" />
      <div class="absolute inset-0 flex items-center justify-center p-3">
        <div class="ui-card w-full max-w-3xl p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50 truncate">
                Attachments
                <span class="ml-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  {{ attReq?.employeeId }} · {{ attReq?.employeeName }}
                </span>
              </p>
              <p class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">Read only. You can preview or download.</p>
            </div>

            <button type="button" class="ui-btn ui-btn-xs ui-btn-ghost" @click="closeAttachments" :disabled="attLoading" aria-label="Close attachments">
              <i class="fa-solid fa-xmark" />
            </button>
          </div>

          <div class="mt-3">
            <div
              v-if="attLoading"
              class="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-700
                     dark:border-sky-700/70 dark:bg-sky-950/40 dark:text-sky-100"
            >
              Loading attachments...
            </div>

            <div
              v-else-if="attError"
              class="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700
                     dark:border-rose-700/70 dark:bg-rose-950/40 dark:text-rose-100"
            >
              {{ attError }}
            </div>

            <div v-else-if="!attItems.length" class="py-8 text-center text-[11px] text-slate-500 dark:text-slate-400">
              No attachments.
            </div>

            <div v-else class="ui-frame">
              <div class="divide-y divide-slate-200/70 dark:divide-slate-700/70">
                <div v-for="it in attItems" :key="it.attId" class="flex items-center justify-between gap-3 px-3 py-2">
                  <div class="flex items-center gap-3 min-w-0">
                    <div class="ui-ico !w-[36px] !h-[36px]">
                      <i class="fa-solid" :class="iconForMime(it.contentType)" />
                    </div>
                    <div class="min-w-0">
                      <p class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50 truncate">
                        {{ it.filename || 'Attachment' }}
                      </p>
                      <p class="text-[11px] text-slate-500 dark:text-slate-400">
                        {{ niceBytes(it.size) }}
                        <span v-if="it.uploadedAt"> · {{ dayjs(it.uploadedAt).format('YYYY-MM-DD HH:mm') }}</span>
                      </p>
                    </div>
                  </div>

                  <div class="flex items-center gap-2">
                    <button
                      v-if="canPreviewInline(it.contentType)"
                      type="button"
                      class="ui-btn ui-btn-xs ui-btn-soft"
                      @click="openPreview(it)"
                    >
                      <i class="fa-solid fa-eye text-[11px]" />
                      Preview
                    </button>

                    <button type="button" class="ui-btn ui-btn-xs ui-btn-indigo" @click="downloadAttachment(it)">
                      <i class="fa-solid fa-download text-[11px]" />
                      Download
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div class="mt-3 flex justify-end">
              <button type="button" class="ui-btn ui-btn-sm ui-btn-ghost" @click="closeAttachments" :disabled="attLoading">Close</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Inline preview (image/pdf) -->
      <div v-if="previewOpen" class="fixed inset-0 z-[80]">
        <div class="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" @click="closePreview" />
        <div class="absolute inset-0 flex items-center justify-center p-3">
          <div class="ui-card w-full max-w-5xl p-3">
            <div class="flex items-center justify-between gap-3 px-2 pb-2">
              <p class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50 truncate">Preview: {{ previewName }}</p>
              <button type="button" class="ui-btn ui-btn-xs ui-btn-ghost" @click="closePreview" aria-label="Close preview">
                <i class="fa-solid fa-xmark" />
              </button>
            </div>

            <div class="ui-frame bg-white dark:bg-slate-950">
              <div class="p-2">
                <iframe
                  v-if="String(previewType || '').toLowerCase().includes('pdf')"
                  :src="previewUrl"
                  class="h-[72vh] w-full rounded-xl border border-slate-200 dark:border-slate-700"
                />
                <img
                  v-else
                  :src="previewUrl"
                  class="max-h-[72vh] w-full object-contain rounded-xl border border-slate-200 dark:border-slate-700 bg-white"
                  alt="preview"
                />
              </div>
            </div>

            <div class="mt-2 flex justify-end gap-2">
              <a class="ui-btn ui-btn-sm ui-btn-indigo" :href="previewUrl" target="_blank" rel="noopener" :download="previewName || undefined">
                <i class="fa-solid fa-up-right-from-square text-[11px]" />
                Open
              </a>
              <button type="button" class="ui-btn ui-btn-sm ui-btn-ghost" @click="closePreview">Close</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ✅ icon-only buttons keep column narrow & consistent */
.ui-icon-btn {
  padding-left: 0.55rem !important;
  padding-right: 0.55rem !important;
}

/* Reason clamp */
.reason-cell {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.35;
}
</style>