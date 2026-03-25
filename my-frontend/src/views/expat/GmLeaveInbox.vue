<!-- src/views/expat/GmLeaveInbox.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/store/auth'
import { subscribeRoleIfNeeded, onSocket } from '@/utils/socket'
import * as XLSX from 'xlsx'

defineOptions({ name: 'GmLeaveInbox' })

const { showToast } = useToast()
const auth = useAuth()

const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

const loading = ref(false)
const loadingMore = ref(false)
const rows = ref([])
const hasMore = ref(true)

const page = ref(1)
const limit = ref(10)

const statusFilter = ref('PENDING_GM')

const search = ref('')
const fromDate = ref('')
const toDate = ref('')
const employeeFilter = ref('')

const totalLoaded = computed(() => rows.value.length)
const filteredCount = computed(() => filteredRows.value.length)

const bottomSentinel = ref(null)
let bottomObserver = null
let searchTimer = null
let refreshTimer = null
const offHandlers = []

function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}

function formatRange(row) {
  const a = row.startDate ? dayjs(row.startDate).format('DD-MM-YYYY') : ''
  const b = row.endDate ? dayjs(row.endDate).format('DD-MM-YYYY') : ''
  if (!a && !b) return '—'
  if (a === b) return a
  return `${a} → ${b}`
}

function statusChipClasses(status) {
  switch (up(status)) {
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
    default:
      return 'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800/60 dark:text-slate-200 dark:border-slate-700/80'
  }
}

function modeChipClasses(mode) {
  const m = up(mode)
  if (m === 'GM_AND_COO' || m === 'MANAGER_AND_COO' || m === 'COO_ONLY') return 'ui-badge ui-badge-indigo'
  if (m === 'MANAGER_ONLY' || m === 'GM_ONLY') return 'ui-badge ui-badge-success'
  return 'ui-badge ui-badge-info'
}

function modeLabel(mode) {
  const m = up(mode)
  if (m === 'GM_AND_COO') return 'GM + COO'
  if (m === 'MANAGER_AND_COO') return 'Manager + COO'
  if (m === 'COO_ONLY') return 'COO only'
  if (m === 'MANAGER_ONLY') return 'Manager only'
  if (m === 'GM_ONLY') return 'GM only'
  return 'Manager + GM'
}

function statusWeight(st) {
  switch (up(st)) {
    case 'PENDING_GM': return 0
    case 'APPROVED': return 1
    case 'REJECTED': return 2
    case 'CANCELLED': return 3
    case 'PENDING_MANAGER': return 4
    case 'PENDING_COO': return 5
    default: return 99
  }
}

function getRejectReason(row) {
  const gm = s(row?.gmComment)
  const mgr = s(row?.managerComment)
  return gm || mgr || ''
}
function rejectedByLabel(row) {
  const gm = s(row?.gmComment)
  const mgr = s(row?.managerComment)
  if (gm) return 'Rejected by GM'
  if (mgr) return 'Rejected by Manager'
  return 'Rejected'
}

function clearFilters() {
  search.value = ''
  employeeFilter.value = ''
  fromDate.value = ''
  toDate.value = ''
  statusFilter.value = 'PENDING_GM'
}

async function fetchInbox({ reset = false } = {}) {
  try {
    if (loading.value || loadingMore.value) return
    if (!reset && !hasMore.value) return

    if (reset) {
      loading.value = true
      rows.value = []
      page.value = 1
      hasMore.value = true
    } else {
      loadingMore.value = true
    }

    const params = {
      status: statusFilter.value,
      page: page.value,
      limit: limit.value,
      keyword: search.value || '',
      employeeId: employeeFilter.value || '',
      fromDate: fromDate.value || '',
      toDate: toDate.value || '',
    }

    const res = await api.get('/leave/requests/gm/inbox', { params })
    const payload = res?.data || {}
    const items = Array.isArray(payload.items) ? payload.items : []

    if (reset) rows.value = items
    else rows.value.push(...items)

    hasMore.value = !!payload.hasMore

    if (items.length > 0 && payload.hasMore) {
      page.value += 1
    }
  } catch (e) {
    console.error('fetchInbox error', e)
    showToast({
      type: 'error',
      title: 'Failed to load',
      message: e?.response?.data?.message || 'Unable to load GM inbox.',
    })
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function resetAndFetch() {
  await fetchInbox({ reset: true })
  await nextTick()
  setupInfiniteScroll()
}

const filteredRows = computed(() => {
  const q = search.value.trim().toLowerCase()
  let list = [...rows.value]

  if (q) {
    list = list.filter((r) => {
      const hay = [
        r.employeeId,
        r.employeeName,
        r.department,
        r.leaveTypeCode,
        r.reason,
        r.status,
        r.approvalMode,
        r.gmComment,
        r.managerComment,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return hay.includes(q)
    })
  }

  list.sort((a, b) => {
    const sw = statusWeight(a.status) - statusWeight(b.status)
    if (sw !== 0) return sw
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  })

  return list
})

function safeSheetName(name, fallback = 'Inbox') {
  let x = String(name || '').trim() || fallback
  x = x.replace(/[\\\/\?\*\[\]\:]/g, ' ')
  x = x.replace(/\s+/g, ' ').trim()
  if (!x) x = fallback
  if (x.length > 31) x = x.slice(0, 31).trim()
  return x || fallback
}

function buildExportRows(list) {
  return (list || []).map((r) => ({
    RequestedAt: r.createdAt ? dayjs(r.createdAt).format('YYYY-MM-DD HH:mm') : '',
    EmployeeId: r.employeeId || '',
    EmployeeName: r.employeeName || '',
    Department: r.department || '',
    LeaveType: r.leaveTypeCode || '',
    ApprovalMode: modeLabel(r.approvalMode),
    LeaveStart: r.startDate ? dayjs(r.startDate).format('YYYY-MM-DD') : '',
    LeaveEnd: r.endDate ? dayjs(r.endDate).format('YYYY-MM-DD') : '',
    TotalDays: Number(r.totalDays || 0),
    Status: r.status || '',
    RejectBy: up(r.status) === 'REJECTED' ? rejectedByLabel(r) : '',
    RejectReason: up(r.status) === 'REJECTED' ? getRejectReason(r) : '',
    Reason: String(r.reason || '').replace(/\s+/g, ' ').trim(),
  }))
}

function exportExcel() {
  try {
    const list = filteredRows.value
    if (!list.length) {
      showToast({ type: 'warning', title: 'Nothing to export', message: 'No rows available for export.' })
      return
    }

    const data = buildExportRows(list)
    const ws = XLSX.utils.json_to_sheet(data)

    ws['!cols'] = [
      { wch: 18 }, { wch: 12 }, { wch: 24 }, { wch: 18 }, { wch: 10 },
      { wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 16 },
      { wch: 18 }, { wch: 50 }, { wch: 60 },
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName('GM Inbox', 'Inbox'))

    const filename = `GmInbox_${statusFilter.value || 'ALL'}_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`
    XLSX.writeFile(wb, filename)

    showToast({ type: 'success', title: 'Exported', message: 'Downloaded Excel (.xlsx).' })
  } catch (e) {
    console.error('exportExcel error', e)
    showToast({ type: 'error', title: 'Export failed', message: 'Unable to export. Please try again.' })
  }
}

const deciding = ref(false)
const decideId = ref('')
const decideAction = ref('')
const rejectNote = ref('')

const canDecideRow = (row) => up(row?.status) === 'PENDING_GM'

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
    const currentId = decideId.value

    await api.post(`/leave/requests/${currentId}/gm-decision`, { action, comment })

    showToast({
      type: 'success',
      title: action === 'APPROVE' ? 'Approved' : 'Rejected',
      message: action === 'APPROVE' ? 'Approved successfully.' : 'Rejected successfully.',
    })

    closeDecisionModal(true)

    if (statusFilter.value === 'PENDING_GM') {
      rows.value = rows.value.filter((r) => r._id !== currentId)
    } else {
      await resetAndFetch()
    }
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
  const t = String(m || '').toLowerCase()
  if (t.includes('pdf')) return 'fa-file-pdf'
  if (t.includes('word')) return 'fa-file-word'
  if (t.includes('excel') || t.includes('spreadsheet')) return 'fa-file-excel'
  if (t.includes('image')) return 'fa-file-image'
  return 'fa-file'
}

function canPreviewInline(m) {
  const t = String(m || '').toLowerCase()
  return t.startsWith('image/') || t.includes('pdf')
}

function buildAttContentUrl(requestId, attId) {
  const rid = s(requestId)
  const aid = s(attId)
  if (!rid || !aid) return ''
  return `/leave/requests/${rid}/attachments/${aid}/content`
}

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
      url: item.url,
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
    const items = Array.isArray(res?.data?.items) ? res.data.items : Array.isArray(res?.data) ? res.data : []

    attItems.value = (items || [])
      .map((x) => {
        const attId = s(x?.attId)
        return {
          attId,
          filename: s(x?.filename || 'Attachment') || 'Attachment',
          contentType: s(x?.contentType || ''),
          size: Number(x?.size || 0),
          uploadedAt: x?.uploadedAt || null,
          uploadedBy: s(x?.uploadedBy || ''),
          note: s(x?.note || ''),
          url: buildAttContentUrl(row._id, attId),
        }
      })
      .filter((x) => !!x.attId)
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

function setupInfiniteScroll() {
  if (typeof window === 'undefined') return

  if (bottomObserver) {
    bottomObserver.disconnect()
    bottomObserver = null
  }

  bottomObserver = new IntersectionObserver(
    async (entries) => {
      const entry = entries[0]
      if (!entry?.isIntersecting) return
      if (loading.value || loadingMore.value || !hasMore.value) return
      await fetchInbox()
    },
    {
      root: null,
      rootMargin: '260px 0px',
      threshold: 0,
    }
  )

  if (bottomSentinel.value) {
    bottomObserver.observe(bottomSentinel.value)
  }
}

function triggerRealtimeRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    resetAndFetch()
  }, 150)
}

function setupRealtime() {
  subscribeRoleIfNeeded({
    role: auth.user?.role,
    employeeId: auth.user?.employeeId,
    loginId: auth.user?.loginId || auth.user?.employeeId || auth.user?.id,
    company: auth.user?.companyCode,
  })

  offHandlers.push(
    onSocket('leave:req:created', () => triggerRealtimeRefresh()),
    onSocket('leave:req:updated', () => triggerRealtimeRefresh()),
    onSocket('leave:req:manager-decision', () => triggerRealtimeRefresh()),
    onSocket('leave:req:gm-decision', () => triggerRealtimeRefresh())
  )
}

function lockBodyScroll(on) {
  if (typeof document === 'undefined') return
  document.body.classList.toggle('overflow-hidden', !!on)
}

const decisionOpen = computed(() => !!decideAction.value)

watch([attOpen, previewOpen, decisionOpen], ([a, p, d]) => {
  lockBodyScroll(!!(a || p || d))
})

function onKeydown(e) {
  if (e.key !== 'Escape') return
  if (previewOpen.value) return closePreview()
  if (attOpen.value) return closeAttachments()
  if (decisionOpen.value) return closeDecisionModal()
}

watch([statusFilter, employeeFilter, fromDate, toDate], () => {
  resetAndFetch()
})

watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    resetAndFetch()
  }, 300)
})

onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateIsMobile)
    window.addEventListener('keydown', onKeydown)
  }

  await resetAndFetch()
  setupRealtime()
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateIsMobile)
    window.removeEventListener('keydown', onKeydown)
  }
  if (refreshTimer) clearTimeout(refreshTimer)
  if (searchTimer) clearTimeout(searchTimer)
  if (bottomObserver) {
    bottomObserver.disconnect()
    bottomObserver = null
  }
  offHandlers.forEach((off) => {
    try {
      off && off()
    } catch {}
  })
  closePreview()
  closeAttachments()
  lockBodyScroll(false)
})
</script>

<template>
  <div class="ui-page min-h-screen w-full">
    <div class="w-full">
      <div class="ui-card rounded-none border-x-0 border-t-0">
        <div class="ui-hero-gradient">
          <div v-if="!isMobile" class="flex flex-wrap items-end justify-between gap-4">
            <div class="flex flex-col gap-1 min-w-[240px]">
              <p class="text-[15px] font-extrabold">GM Inbox</p>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <span class="ui-badge ui-badge-info">Loaded: {{ totalLoaded }}</span>
                <span class="ui-badge ui-badge-info">Showing: {{ filteredCount }}</span>
                <span class="ui-badge ui-badge-indigo">Default: PENDING_GM</span>
              </div>
            </div>

            <div class="flex flex-1 flex-wrap items-end justify-end gap-3">
              <div class="min-w-[170px] max-w-[210px]">
                <div class="ui-field">
                  <label class="text-[11px] font-extrabold text-white/90">Status</label>
                  <select v-model="statusFilter" class="ui-select">
                    <option value="PENDING_GM">PENDING_GM</option>
                    <option value="ALL">ALL</option>
                    <option value="APPROVED">APPROVED</option>
                    <option value="REJECTED">REJECTED</option>
                    <option value="CANCELLED">CANCELLED</option>
                    <option value="PENDING_MANAGER_VIEW">PENDING_MANAGER_VIEW</option>
                  </select>
                </div>
              </div>

              <div class="min-w-[240px] max-w-sm">
                <div class="ui-field">
                  <label class="text-[11px] font-extrabold text-white/90">Search</label>
                  <div class="flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-3 py-2">
                    <i class="fa-solid fa-magnifying-glass text-[12px] text-white/80" />
                    <input
                      v-model="search"
                      type="text"
                      placeholder="Employee / type / mode / reason / reject note..."
                      class="w-full bg-transparent text-[12px] text-white outline-none placeholder:text-white/70"
                    />
                  </div>
                </div>
              </div>

              <div class="min-w-[180px] max-w-[220px]">
                <div class="ui-field">
                  <label class="text-[11px] font-extrabold text-white/90">Employee ID</label>
                  <div class="flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-3 py-2">
                    <i class="fa-solid fa-id-badge text-[12px] text-white/80" />
                    <input
                      v-model="employeeFilter"
                      type="text"
                      placeholder="Ex: 51820386"
                      class="w-full bg-transparent text-[12px] text-white outline-none placeholder:text-white/70"
                    />
                  </div>
                </div>
              </div>

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

              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="ui-btn ui-btn-sm ui-btn-indigo"
                  @click="exportExcel()"
                  :disabled="loading || !filteredRows.length"
                >
                  <i class="fa-solid fa-file-excel text-[11px]" />
                  Export
                </button>

                <button type="button" class="ui-btn ui-btn-sm ui-btn-ghost" @click="clearFilters" :disabled="loading">
                  Clear
                </button>
              </div>
            </div>
          </div>

          <div v-else class="space-y-3">
            <div>
              <p class="text-[15px] font-extrabold">GM Inbox</p>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <span class="ui-badge ui-badge-info">Loaded: {{ totalLoaded }}</span>
                <span class="ui-badge ui-badge-info">Showing: {{ filteredCount }}</span>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-2">
              <div class="ui-field">
                <label class="text-[11px] font-extrabold text-white/90">Scope</label>
                <select v-model="scope" class="ui-select">
                  <option value="ACTIONABLE">Actionable</option>
                  <option value="ALL">All</option>
                </select>
              </div>

              <div class="ui-field">
                <label class="text-[11px] font-extrabold text-white/90">Status</label>
                <select v-model="statusFilter" class="ui-select">
                  <option value="PENDING_GM">Waiting for GM</option>
                  <option value="ALL">All</option>
                  <option value="APPROVED">Approved</option>
                  <option value="REJECTED">Rejected</option>
                  <option value="CANCELLED">Cancelled</option>
                  <option value="PENDING_MANAGER_VIEW">Manager Waiting</option>
                </select>
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
                    placeholder="Employee / type / mode / reason..."
                    class="w-full bg-transparent text-[12px] text-white outline-none placeholder:text-white/70"
                  />
                </div>
              </div>

              <div class="ui-field">
                <label class="text-[11px] font-extrabold text-white/90">Employee ID</label>
                <div class="flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-3 py-2">
                  <i class="fa-solid fa-id-badge text-[12px] text-white/80" />
                  <input
                    v-model="employeeFilter"
                    type="text"
                    placeholder="Ex: 51820386"
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

              <div class="flex items-center justify-between">
                <button type="button" class="ui-btn ui-btn-sm ui-btn-indigo" @click="exportExcel()" :disabled="loading || !filteredRows.length">
                  <i class="fa-solid fa-file-excel text-[11px]" />
                  Export
                </button>
                <button type="button" class="ui-btn ui-btn-sm ui-btn-ghost" @click="clearFilters" :disabled="loading">
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="px-2 pb-3 pt-3 sm:px-4 lg:px-6">
          <div
            v-if="loading && !filteredRows.length"
            class="mb-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-700
                   dark:border-sky-700/70 dark:bg-sky-950/40 dark:text-sky-100"
          >
            Loading GM inbox...
          </div>

          <div v-if="isMobile" class="space-y-2">
            <p v-if="!filteredRows.length && !loading" class="py-6 text-center text-[11px] text-slate-500 dark:text-slate-400">
              No leave requests in your GM queue.
            </p>

            <article v-for="row in filteredRows" :key="row._id" class="ui-card p-3">
              <div class="flex items-start justify-between gap-3">
                <div class="space-y-1">
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    Requested:
                    <span class="font-semibold text-slate-900 dark:text-slate-50">
                      {{ row.createdAt ? dayjs(row.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
                    </span>
                  </div>

                  <div class="text-xs font-mono text-slate-900 dark:text-slate-50">{{ row.employeeId || '—' }}</div>
                  <div class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50">{{ row.employeeName || '—' }}</div>
                  <div v-if="row.department" class="text-[11px] text-slate-500 dark:text-slate-400">{{ row.department }}</div>

                  <div class="text-[11px] text-slate-600 dark:text-slate-300">
                    Date: <span class="font-semibold">{{ formatRange(row) }}</span>
                    · Days: <span class="font-extrabold">{{ Number(row.totalDays || 0).toLocaleString() }}</span>
                  </div>
                </div>

                <div class="text-right space-y-1 text-[11px]">
                  <span class="ui-badge ui-badge-info">{{ row.leaveTypeCode || '—' }}</span>
                  <div>
                    <span :class="modeChipClasses(row.approvalMode)">
                      {{ modeLabel(row.approvalMode) }}
                    </span>
                  </div>
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

              <div
                v-if="up(row.status) === 'REJECTED'"
                class="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700
                       dark:border-rose-700/60 dark:bg-rose-950/40 dark:text-rose-200"
              >
                <span class="font-extrabold">{{ rejectedByLabel(row) }}:</span>
                <span class="ml-1">{{ getRejectReason(row) || '—' }}</span>
              </div>

              <div class="mt-3 flex items-center justify-between gap-2">
                <button
                  v-if="row.attachments?.length"
                  type="button"
                  class="ui-btn ui-btn-xs ui-btn-soft"
                  @click="openAttachments(row)"
                  :disabled="loading"
                >
                  <i class="fa-solid fa-paperclip text-[11px]" />
                  <span class="ml-1">{{ row.attachments.length }}</span>
                </button>
                <span v-else class="text-[11px] text-slate-400">—</span>

                <div v-if="canDecideRow(row)" class="flex items-center justify-end gap-2">
                  <button type="button" class="ui-btn ui-btn-xs ui-btn-emerald" :disabled="loading || deciding" @click="openApprove(row)">
                    <i class="fa-solid fa-circle-check text-[11px]" />
                  </button>
                  <button type="button" class="ui-btn ui-btn-xs ui-btn-rose" :disabled="loading || deciding" @click="openReject(row)">
                    <i class="fa-solid fa-circle-xmark text-[11px]" />
                  </button>
                </div>
              </div>
            </article>
          </div>

          <div v-else class="ui-table-wrap">
            <table class="ui-table text-left w-full min-w-[1440px]">
              <thead>
                <tr>
                  <th class="ui-th text-left">Requested at</th>
                  <th class="ui-th text-left">Employee</th>
                  <th class="ui-th text-left">Type</th>
                  <th class="ui-th text-left">Leave Date</th>
                  <th class="ui-th text-left">Mode</th>
                  <th class="ui-th text-right">Days</th>
                  <th class="ui-th">Status</th>
                  <th class="ui-th text-center">Actions</th>
                  <th class="ui-th text-center">Files</th>
                  <th class="ui-th text-left">Reason</th>
                </tr>
              </thead>

              <tbody>
                <tr v-if="!loading && !filteredRows.length">
                  <td colspan="10" class="ui-td py-8 text-slate-500 dark:text-slate-400">No leave requests in your GM queue.</td>
                </tr>

                <tr v-for="row in filteredRows" :key="row._id" class="ui-tr-hover">
                  <td class="ui-td text-left whitespace-nowrap align-top">
                    {{ row.createdAt ? dayjs(row.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
                  </td>

                  <td class="ui-td text-left align-top">
                    <div class="text-xs font-mono text-slate-900 dark:text-slate-50">{{ row.employeeId || '—' }}</div>
                    <div class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50">{{ row.employeeName || '—' }}</div>
                    <div v-if="row.department" class="text-[11px] text-slate-500 dark:text-slate-400">{{ row.department }}</div>
                  </td>

                  <td class="ui-td text-left align-top">
                    <span class="ui-badge ui-badge-info">{{ row.leaveTypeCode || '—' }}</span>
                  </td>

                  <td class="ui-td text-left whitespace-nowrap align-top">{{ formatRange(row) }}</td>

                  <td class="ui-td text-left align-top">
                    <span :class="modeChipClasses(row.approvalMode)">
                      {{ modeLabel(row.approvalMode) }}
                    </span>
                  </td>

                  <td class="ui-td text-right align-top tabular-nums">{{ Number(row.totalDays || 0).toLocaleString() }}</td>

                  <td class="ui-td align-top">
                    <span
                      class="inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-[11px] font-extrabold"
                      :class="statusChipClasses(row.status)"
                    >
                      {{ row.status }}
                    </span>
                  </td>

                  <td class="ui-td align-top text-center">
                    <div v-if="canDecideRow(row)" class="flex items-center justify-center gap-2">
                      <button type="button" class="ui-btn ui-btn-xs ui-btn-emerald" :disabled="loading || deciding" @click="openApprove(row)">
                        <i class="fa-solid fa-circle-check text-[11px]" />
                      </button>
                      <button type="button" class="ui-btn ui-btn-xs ui-btn-rose" :disabled="loading || deciding" @click="openReject(row)">
                        <i class="fa-solid fa-circle-xmark text-[11px]" />
                      </button>
                    </div>
                    <span v-else class="text-[11px] text-slate-400">—</span>
                  </td>

                  <td class="ui-td align-top text-center">
                    <button
                      v-if="row.attachments?.length"
                      type="button"
                      class="ui-btn ui-btn-soft ui-btn-xs"
                      @click="openAttachments(row)"
                      :disabled="loading"
                    >
                      <i class="fa-solid fa-paperclip text-[11px]" />
                      <span class="ml-1">{{ row.attachments.length }}</span>
                    </button>
                    <span v-else class="text-[11px] text-slate-400">—</span>
                  </td>

                  <td class="ui-td align-top">
                    <div class="reason-cell text-[12px] text-slate-700 dark:text-slate-200">
                      {{ row.reason || '—' }}
                    </div>

                    <div
                      v-if="up(row.status) === 'REJECTED' && getRejectReason(row)"
                      class="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700
                             dark:border-rose-700/60 dark:bg-rose-950/40 dark:text-rose-200"
                    >
                      <span class="font-extrabold">{{ rejectedByLabel(row) }}:</span>
                      <span class="ml-1">{{ getRejectReason(row) }}</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="mt-3 ui-divider pt-3">
            <div
              v-if="loadingMore"
              class="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-center text-[11px] text-sky-700
                     dark:border-sky-700/70 dark:bg-sky-950/40 dark:text-sky-100"
            >
              Loading more...
            </div>

            <p
              v-else-if="!hasMore && filteredRows.length"
              class="text-center text-[11px] text-slate-500 dark:text-slate-400"
            >
              End of list
            </p>

            <div ref="bottomSentinel" class="h-6 w-full"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- confirm modal -->
    <div v-if="decisionOpen" class="fixed inset-0 z-[60]">
      <div class="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" @click="closeDecisionModal()" />
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
            <button type="button" class="ui-btn ui-btn-xs ui-btn-ghost" @click="closeDecisionModal()" :disabled="deciding">
              <i class="fa-solid fa-xmark" />
            </button>
          </div>

          <div class="mt-3 space-y-2">
            <div v-if="decideAction === 'REJECT'" class="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
              <label class="text-[11px] font-extrabold text-slate-700 dark:text-slate-200">Reject reason</label>
              <textarea
                v-model="rejectNote"
                rows="3"
                class="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-900 outline-none
                       placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
                placeholder="Example: Not enough coverage during that period..."
              />
              <p class="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Required.</p>
            </div>

            <div class="flex items-center justify-end gap-2 pt-1">
              <button type="button" class="ui-btn ui-btn-sm ui-btn-ghost" @click="closeDecisionModal()" :disabled="deciding">
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

    <!-- attachments modal -->
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

            <button type="button" class="ui-btn ui-btn-xs ui-btn-ghost" @click="closeAttachments" :disabled="attLoading">
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

            <div v-else-if="!attItems.length" class="py-8 text-center text-[11px] text-slate-500 dark:text-slate-400">No attachments.</div>

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
                    <button v-if="canPreviewInline(it.contentType)" type="button" class="ui-btn ui-btn-xs ui-btn-soft" @click="openPreview(it)">
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

      <div v-if="previewOpen" class="fixed inset-0 z-[80]">
        <div class="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" @click="closePreview" />
        <div class="absolute inset-0 flex items-center justify-center p-3">
          <div class="ui-card w-full max-w-5xl p-3">
            <div class="flex items-center justify-between gap-3 px-2 pb-2">
              <p class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50 truncate">Preview: {{ previewName }}</p>
              <button type="button" class="ui-btn ui-btn-xs ui-btn-ghost" @click="closePreview">
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
.reason-cell {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.35;
}
</style>