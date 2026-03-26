<!-- src/views/expat/CooLeaveInbox.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/store/auth'
import { subscribeRoleIfNeeded, onSocket } from '@/utils/socket'
import * as XLSX from 'xlsx'

defineOptions({ name: 'CooLeaveInbox' })

const { showToast } = useToast()
const auth = useAuth()

/* ✅ roles helper */
const roles = computed(() => {
  const raw = Array.isArray(auth.user?.roles) ? auth.user.roles : []
  const base = auth.user?.role ? [auth.user.role] : []
  return [...new Set([...raw, ...base].map((r) => String(r || '').toUpperCase().trim()))].filter(Boolean)
})

/* ✅ only actual COO can decide */
const canCooDecide = computed(() => {
  return roles.value.includes('LEAVE_COO') || roles.value.includes('COO') || roles.value.includes('LEAVE_COO_APPROVER')
})

/* ───────── responsive flag ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────── state ───────── */
const loading = ref(false)
const loadingMore = ref(false)
const rows = ref([])
const hasMore = ref(true)

const page = ref(1)
const limit = ref(10)

const statusFilter = ref('PENDING_COO')
const search = ref('')
const fromDate = ref('')
const toDate = ref('')
const employeeFilter = ref('')

const bottomSentinel = ref(null)
let bottomObserver = null
let refreshTimer = null
let searchTimer = null
const offHandlers = []

/* ───────── helpers ───────── */
function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}

function formatRange(row) {
  const a = row?.startDate ? dayjs(row.startDate).format('DD-MM-YYYY') : ''
  const b = row?.endDate ? dayjs(row.endDate).format('DD-MM-YYYY') : ''
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
      return 'bg-orange-100 text-orange-700 border border-orange-200 dark:bg-orange-900/40 dark:text-orange-200 dark:border-orange-700/80'
    case 'APPROVED':
      return 'bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700/80'
    case 'REJECTED':
      return 'bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-900/40 dark:text-rose-200 dark:border-rose-700/80'
    case 'CANCELLED':
    default:
      return 'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800/60 dark:text-slate-200 dark:border-slate-700/80'
  }
}

function modeChipClasses(mode) {
  const m = up(mode)
  if (m === 'GM_AND_COO' || m === 'MANAGER_AND_COO' || m === 'COO_ONLY') {
    return 'ui-badge ui-badge-indigo'
  }
  if (m === 'MANAGER_ONLY' || m === 'GM_ONLY') {
    return 'ui-badge ui-badge-success'
  }
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
    case 'PENDING_COO':
      return 0
    case 'APPROVED':
      return 1
    case 'REJECTED':
      return 2
    case 'CANCELLED':
      return 3
    case 'PENDING_GM':
      return 4
    case 'PENDING_MANAGER':
      return 5
    default:
      return 99
  }
}

function getRejectReason(row) {
  const coo = s(row?.cooComment)
  const gm = s(row?.gmComment)
  const mgr = s(row?.managerComment)
  return coo || gm || mgr || ''
}

function rejectedByLabel(row) {
  const coo = s(row?.cooComment)
  const gm = s(row?.gmComment)
  const mgr = s(row?.managerComment)
  if (coo) return 'Rejected by COO'
  if (gm) return 'Rejected by GM'
  if (mgr) return 'Rejected by Manager'
  return 'Rejected'
}

function clearFilters() {
  search.value = ''
  employeeFilter.value = ''
  fromDate.value = ''
  toDate.value = ''
  statusFilter.value = 'PENDING_COO'
}

function dedupeById(list) {
  const map = new Map()
  for (const item of list || []) {
    const id = s(item?._id)
    if (!id) continue
    map.set(id, item)
  }
  return Array.from(map.values())
}

/* ───────── backend pagination fetch ───────── */
async function fetchInbox({ reset = false, silent = false } = {}) {
  try {
    if (loading.value || loadingMore.value) return
    if (!reset && !hasMore.value) return

    if (reset) {
      if (!silent) loading.value = true
      rows.value = []
      page.value = 1
      hasMore.value = true
    } else {
      loadingMore.value = true
    }

    const params = {
      status: statusFilter.value || 'PENDING_COO',
      page: page.value,
      limit: limit.value,
      keyword: search.value || '',
      employeeId: employeeFilter.value || '',
      fromDate: fromDate.value || '',
      toDate: toDate.value || '',
    }

    const res = await api.get('/leave/requests/coo/inbox', { params })
    const payload = res?.data || {}
    const items = Array.isArray(payload.items) ? payload.items : []

    const normalized = items.map((r) => ({
      ...r,
      attachments: Array.isArray(r.attachments) ? r.attachments : [],
    }))

    if (reset) {
      rows.value = normalized
    } else {
      rows.value = dedupeById([...rows.value, ...normalized])
    }

    hasMore.value = !!payload.hasMore

    if (normalized.length > 0 && payload.hasMore) {
      page.value += 1
    } else if (normalized.length > 0 && !payload.hasMore) {
      page.value += 1
    }
  } catch (e) {
    console.error('fetchInbox COO error', e)
    if (!silent) {
      showToast({
        type: 'error',
        title: 'Failed to load',
        message: e?.response?.data?.message || 'Unable to load COO inbox.',
      })
    }
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function resetAndFetch({ silent = false } = {}) {
  await fetchInbox({ reset: true, silent })
  await nextTick()
  setupInfiniteScroll()
}

const totalCount = computed(() => rows.value.length)

const filteredRows = computed(() => {
  const list = [...rows.value]

  list.sort((a, b) => {
    const sw = statusWeight(a.status) - statusWeight(b.status)
    if (sw !== 0) return sw
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  })

  return list
})

const filteredCount = computed(() => filteredRows.value.length)

/* ───────── export all from backend ───────── */
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
    RequestReason: String(r.reason || '').replace(/\s+/g, ' ').trim(),
  }))
}

async function exportExcel() {
  try {
    const params = {
      status: statusFilter.value || 'PENDING_COO',
      exportAll: 1,
      keyword: search.value || '',
      employeeId: employeeFilter.value || '',
      fromDate: fromDate.value || '',
      toDate: toDate.value || '',
    }

    const res = await api.get('/leave/requests/coo/inbox', { params })
    const list = Array.isArray(res?.data?.items) ? res.data.items : []

    if (!list.length) {
      showToast({ type: 'warning', title: 'Nothing to export', message: 'No rows available for export.' })
      return
    }

    const data = buildExportRows(list)
    const ws = XLSX.utils.json_to_sheet(data, { skipHeader: false })

    ws['!cols'] = [
      { wch: 18 },
      { wch: 12 },
      { wch: 24 },
      { wch: 18 },
      { wch: 10 },
      { wch: 16 },
      { wch: 12 },
      { wch: 12 },
      { wch: 10 },
      { wch: 16 },
      { wch: 18 },
      { wch: 50 },
      { wch: 60 },
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName('COO Inbox', 'Inbox'))

    const filename = `CooInbox_ALL_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`
    XLSX.writeFile(wb, filename)

    showToast({ type: 'success', title: 'Exported', message: 'Downloaded Excel (.xlsx).' })
  } catch (e) {
    console.error('exportExcel error', e)
    showToast({ type: 'error', title: 'Export failed', message: 'Unable to export. Please try again.' })
  }
}

/* ───────── approve / reject ───────── */
const deciding = ref(false)
const decideRow = ref(null)
const decideAction = ref('')
const rejectNote = ref('')

const decisionOpen = computed(() => !!decideAction.value)

const canDecideRow = (row) => canCooDecide.value && up(row?.status) === 'PENDING_COO'

function openApprove(row) {
  if (!row?._id) return
  decideRow.value = row
  decideAction.value = 'APPROVE'
  rejectNote.value = ''
}

function openReject(row) {
  if (!row?._id) return
  decideRow.value = row
  decideAction.value = 'REJECT'
  rejectNote.value = ''
}

function closeDecisionModal(force = false) {
  if (!force && deciding.value) return
  decideRow.value = null
  decideAction.value = ''
  rejectNote.value = ''
}

async function confirmDecision() {
  if (!decideRow.value?._id || !decideAction.value) return

  const action = decideAction.value === 'APPROVE' ? 'APPROVE' : 'REJECT'
  const comment = action === 'REJECT' ? rejectNote.value.trim() : ''

  if (action === 'REJECT' && !comment) {
    showToast({
      type: 'warning',
      title: 'Reject reason required',
      message: 'Please enter a short reason to reject.',
    })
    return
  }

  try {
    deciding.value = true
    await api.post(`/leave/requests/${decideRow.value._id}/coo-decision`, {
      action,
      ...(action === 'REJECT' ? { comment } : {}),
    })

    showToast({
      type: 'success',
      title: action === 'APPROVE' ? 'Approved' : 'Rejected',
      message: 'COO decision saved.',
    })

    closeDecisionModal(true)
    await resetAndFetch({ silent: true })
  } catch (e) {
    console.error('confirmDecision COO error', e)
    showToast({
      type: 'error',
      title: 'Action failed',
      message: e?.response?.data?.message || 'Unable to update request. Please try again.',
    })
  } finally {
    deciding.value = false
  }
}

/* ───────── attachments ───────── */
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
          url: x?.url ? s(x.url) : buildAttContentUrl(row._id, attId),
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

/* ───────── realtime ───────── */
function triggerRealtimeRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    resetAndFetch({ silent: true })
  }, 180)
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
    onSocket('leave:req:updated', () => triggerRealtimeRefresh())
  )
}

/* ───────── infinite scroll ───────── */
function destroyInfiniteScroll() {
  try {
    if (bottomObserver) {
      bottomObserver.disconnect()
      bottomObserver = null
    }
  } catch {}
}

function setupInfiniteScroll() {
  destroyInfiniteScroll()

  if (typeof window === 'undefined') return
  if (!bottomSentinel.value) return

  bottomObserver = new IntersectionObserver(
    async (entries) => {
      const first = entries?.[0]
      if (!first?.isIntersecting) return
      if (loading.value || loadingMore.value || !hasMore.value) return
      await fetchInbox()
    },
    {
      root: null,
      rootMargin: '220px 0px 220px 0px',
      threshold: 0.01,
    }
  )

  bottomObserver.observe(bottomSentinel.value)
}

/* ───────── modal UX ───────── */
function lockBodyScroll(on) {
  if (typeof document === 'undefined') return
  document.body.classList.toggle('overflow-hidden', !!on)
}

watch([attOpen, previewOpen, decisionOpen], ([a, p, d]) => {
  lockBodyScroll(!!(a || p || d))
})

function onKeydown(e) {
  if (e.key !== 'Escape') return
  if (previewOpen.value) return closePreview()
  if (attOpen.value) return closeAttachments()
  if (decisionOpen.value) return closeDecisionModal()
}

/* ───────── filters reset/fetch ───────── */
watch(
  () => [statusFilter.value, employeeFilter.value, fromDate.value, toDate.value],
  async () => {
    await resetAndFetch()
  }
)

watch(
  () => search.value,
  () => {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      resetAndFetch()
    }, 300)
  }
)

/* ───────── lifecycle ───────── */
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
  destroyInfiniteScroll()
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
    <div class="ui-container-edge">
      <div class="ui-card rounded-none border-x-0 border-t-0">
        <div class="ui-hero-gradient">
          <!-- Desktop -->
          <div v-if="!isMobile" class="flex flex-wrap items-end justify-between gap-4">
            <div class="flex min-w-[240px] flex-col gap-1">
              <p class="text-[15px] font-extrabold">COO Inbox</p>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <span class="ui-badge ui-badge-info">Showing: {{ filteredCount }}</span>
              </div>
            </div>

            <div class="flex flex-1 flex-wrap items-end justify-end gap-1.5 xl:gap-2">
              <div class="w-[150px]">
                <div class="ui-field">
                  <label class="text-[10px] font-extrabold text-white/90">Status</label>
                  <select
                    v-model="statusFilter"
                    class="w-full rounded-xl border border-white/25 bg-white/10 px-2 h-[34px] text-[12px] text-white outline-none"
                  >
                    <option value="PENDING_COO">PENDING_COO</option>
                    <option value="ALL">ALL</option>
                    <option value="APPROVED">APPROVED</option>
                    <option value="REJECTED">REJECTED</option>
                    <option value="PENDING_GM_VIEW">PENDING_GM_VIEW</option>
                  </select>
                </div>
              </div>

              <div class="w-[170px]">
                <div class="ui-field">
                  <label class="text-[10px] font-extrabold text-white/90">Search</label>
                  <div class="flex h-[34px] items-center gap-1.5 rounded-xl border border-white/25 bg-white/10 px-2">
                    <i class="fa-solid fa-magnifying-glass text-[11px] text-white/80" />
                    <input
                      v-model="search"
                      type="text"
                      placeholder="Employee / type / reason..."
                      class="w-full bg-transparent text-[12px] text-white outline-none placeholder:text-white/65"
                    />
                  </div>
                </div>
              </div>

              <div class="w-[145px]">
                <div class="ui-field">
                  <label class="text-[10px] font-extrabold text-white/90">Employee ID</label>
                  <div class="flex h-[34px] items-center gap-1.5 rounded-xl border border-white/25 bg-white/10 px-2">
                    <i class="fa-solid fa-id-badge text-[11px] text-white/80" />
                    <input
                      v-model="employeeFilter"
                      type="text"
                      placeholder="Employee ID"
                      class="w-full bg-transparent text-[12px] text-white outline-none placeholder:text-white/65"
                    />
                  </div>
                </div>
              </div>

              <div class="flex items-end gap-1.5">
                <div class="ui-field w-[126px]">
                  <label class="text-[10px] font-extrabold text-white/90">Requested from</label>
                  <input v-model="fromDate" type="date" class="ui-date h-[34px] min-h-0 text-[12px]" />
                </div>
                <div class="ui-field w-[126px]">
                  <label class="text-[10px] font-extrabold text-white/90">Requested to</label>
                  <input v-model="toDate" type="date" class="ui-date h-[34px] min-h-0 text-[12px]" />
                </div>
              </div>

              <div class="flex items-center gap-1.5">
                <button
                  type="button"
                  class="ui-btn ui-btn-sm ui-btn-indigo md:h-[34px] md:px-2 md:text-[11px]"
                  @click="exportExcel"
                  :disabled="loading || (!rows.length && !loadingMore)"
                  title="Export all rows from backend"
                >
                  <i class="fa-solid fa-file-excel text-[11px]" />
                  Export
                </button>

                <button
                  type="button"
                  class="ui-btn ui-btn-sm ui-btn-ghost md:h-[34px] md:px-2 md:text-[11px]"
                  @click="clearFilters"
                  :disabled="loading"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          <!-- Mobile -->
          <div v-else class="space-y-3">
            <div>
              <p class="text-[15px] font-extrabold">COO Inbox</p>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <span class="ui-badge ui-badge-info">Loaded: {{ totalCount }}</span>
                <span class="ui-badge ui-badge-info">Visible: {{ filteredCount }}</span>
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
                    placeholder="Employee / type / mode / reason / status..."
                    class="w-full bg-transparent text-[12px] text-white outline-none placeholder:text-white/70"
                  />
                </div>
              </div>

              <div class="ui-field">
                <label class="text-[11px] font-extrabold text-white/90">Status</label>
                <select v-model="statusFilter" class="ui-date">
                  <option value="PENDING_COO">PENDING_COO</option>
                  <option value="ALL">ALL</option>
                  <option value="APPROVED">APPROVED</option>
                  <option value="REJECTED">REJECTED</option>
                  <option value="PENDING_GM_VIEW">PENDING_GM_VIEW</option>
                </select>
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
                <button
                  type="button"
                  class="ui-btn ui-btn-sm ui-btn-indigo"
                  @click="exportExcel"
                  :disabled="loading || (!rows.length && !loadingMore)"
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
        </div>

        <div class="px-2 pb-3 pt-3 sm:px-4 lg:px-6">
          <div
            v-if="loading && !filteredRows.length"
            class="mb-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-[11px] text-orange-700 dark:border-orange-700/70 dark:bg-orange-950/40 dark:text-orange-100"
          >
            Loading COO inbox...
          </div>

          <!-- Mobile cards -->
          <div v-if="isMobile" class="space-y-2">
            <p v-if="!filteredRows.length && !loading" class="py-6 text-center text-[11px] text-slate-500 dark:text-slate-400">
              No leave requests in your COO queue.
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

                <div class="space-y-1 text-right text-[11px]">
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
                class="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700 dark:border-rose-700/60 dark:bg-rose-950/40 dark:text-rose-200"
              >
                <span class="font-extrabold">{{ rejectedByLabel(row) }}:</span>
                <span class="ml-1">{{ getRejectReason(row) || '—' }}</span>
              </div>

              <div class="mt-3 flex items-center justify-between gap-2">
                <button
                  v-if="row.attachments?.length"
                  type="button"
                  class="ui-btn ui-btn-xs ui-btn-soft ui-icon-btn"
                  @click="openAttachments(row)"
                  :disabled="loading"
                  title="Attachments"
                  aria-label="Attachments"
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

            <div
              v-if="loadingMore"
              class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-center text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            >
              Loading more...
            </div>

            <div ref="bottomSentinel" class="h-2 w-full" />
          </div>

          <!-- Desktop table -->
          <div v-else class="ui-table-wrap">
            <table class="ui-table w-full min-w-[1340px] text-left">
              <colgroup>
                <col class="w-[150px]" />
                <col class="w-[260px]" />
                <col class="w-[92px]" />
                <col class="w-[160px]" />
                <col class="w-[130px]" />
                <col class="w-[80px]" />
                <col class="w-[170px]" />
                <col class="w-[110px]" />
                <col class="w-[96px]" />
                <col />
              </colgroup>

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
                  <td colspan="10" class="ui-td py-8 text-slate-500 dark:text-slate-400">
                    No leave requests in your COO queue.
                  </td>
                </tr>

                <tr v-for="row in filteredRows" :key="row._id" class="ui-tr-hover">
                  <td class="ui-td whitespace-nowrap align-top text-left">
                    {{ row.createdAt ? dayjs(row.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
                  </td>

                  <td class="ui-td align-top text-left">
                    <div class="text-xs font-mono text-slate-900 dark:text-slate-50">{{ row.employeeId || '—' }}</div>
                    <div class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50">{{ row.employeeName || '—' }}</div>
                    <div v-if="row.department" class="text-[11px] text-slate-500 dark:text-slate-400">{{ row.department }}</div>
                  </td>

                  <td class="ui-td align-top text-left">
                    <span class="ui-badge ui-badge-info">{{ row.leaveTypeCode || '—' }}</span>
                  </td>

                  <td class="ui-td whitespace-nowrap align-top text-left">{{ formatRange(row) }}</td>

                  <td class="ui-td align-top text-left">
                    <span :class="modeChipClasses(row.approvalMode)">
                      {{ modeLabel(row.approvalMode) }}
                    </span>
                  </td>

                  <td class="ui-td align-top text-right tabular-nums">{{ Number(row.totalDays || 0).toLocaleString() }}</td>

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
                      title="Preview attachments"
                    >
                      <i class="fa-solid fa-paperclip text-[11px]" />
                      <span class="ml-1">{{ row.attachments.length }}</span>
                    </button>
                    <span v-else class="text-[11px] text-slate-400">—</span>
                  </td>

                  <td class="ui-td align-top text-left">
                    <p class="reason-cell">{{ row.reason || '—' }}</p>

                    <div
                      v-if="up(row.status) === 'REJECTED' && getRejectReason(row)"
                      class="mt-2 inline-flex max-w-[680px] items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700 dark:border-rose-700/60 dark:bg-rose-950/40 dark:text-rose-200"
                    >
                      <span class="whitespace-nowrap font-extrabold">{{ rejectedByLabel(row) }}:</span>
                      <span class="min-w-0 break-words">{{ getRejectReason(row) }}</span>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>

            <div
              v-if="loadingMore"
              class="border-t border-slate-200 px-3 py-2 text-center text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-300"
            >
              Loading more...
            </div>

            <div ref="bottomSentinel" class="h-2 w-full" />
          </div>
        </div>
      </div>
    </div>

    <!-- Decision modal -->
    <div v-if="decisionOpen" class="fixed inset-0 z-[60]">
      <div class="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" @click="closeDecisionModal()" />
      <div class="absolute inset-0 flex items-center justify-center p-3">
        <div class="ui-card w-full max-w-lg p-4">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                {{ decideAction === 'APPROVE' ? 'Approve request' : 'Reject request' }}
              </p>
              <p class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">This will update the request status immediately.</p>
              <p v-if="decideRow" class="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                <span class="font-mono">{{ decideRow.employeeId }}</span>
                <span class="mx-1 opacity-60">•</span>
                <span class="font-semibold">{{ decideRow.employeeName }}</span>
                <span class="mx-1 opacity-60">•</span>
                <span class="ui-badge ui-badge-info">{{ decideRow.leaveTypeCode }}</span>
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
                class="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[12px] text-slate-900 outline-none placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
                placeholder="Example: Not enough coverage during that period..."
              />
              <p class="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Required. This reason will be visible in request history.</p>
            </div>

            <div class="flex items-center justify-end gap-2 pt-1">
              <button type="button" class="ui-btn ui-btn-sm ui-btn-ghost" @click="closeDecisionModal()" :disabled="deciding">Cancel</button>

              <button v-if="decideAction === 'APPROVE'" type="button" class="ui-btn ui-btn-sm ui-btn-emerald" @click="confirmDecision" :disabled="deciding">
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

    <!-- Attachments modal -->
    <div v-if="attOpen" class="fixed inset-0 z-[70]">
      <div class="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" @click="closeAttachments" />
      <div class="absolute inset-0 flex items-center justify-center p-3">
        <div class="ui-card w-full max-w-3xl p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
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
              class="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-[11px] text-orange-700 dark:border-orange-700/70 dark:bg-orange-950/40 dark:text-orange-100"
            >
              Loading attachments...
            </div>

            <div
              v-else-if="attError"
              class="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700 dark:border-rose-700/70 dark:bg-rose-950/40 dark:text-rose-100"
            >
              {{ attError }}
            </div>

            <div v-else-if="!attItems.length" class="py-8 text-center text-[11px] text-slate-500 dark:text-slate-400">No attachments.</div>

            <div v-else class="ui-frame">
              <div class="divide-y divide-slate-200/70 dark:divide-slate-700/70">
                <div v-for="it in attItems" :key="it.attId" class="flex min-w-0 items-center justify-between gap-3 px-3 py-2">
                  <div class="flex min-w-0 items-center gap-3">
                    <div class="ui-ico !h-[36px] !w-[36px]">
                      <i class="fa-solid" :class="iconForMime(it.contentType)" />
                    </div>
                    <div class="min-w-0">
                      <p class="truncate text-[12px] font-extrabold text-slate-900 dark:text-slate-50">{{ it.filename || 'Attachment' }}</p>
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
              <p class="truncate text-[12px] font-extrabold text-slate-900 dark:text-slate-50">Preview: {{ previewName }}</p>
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
                  class="max-h-[72vh] w-full rounded-xl border border-slate-200 bg-white object-contain dark:border-slate-700"
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
.ui-icon-btn {
  padding-left: 0.55rem !important;
  padding-right: 0.55rem !important;
}
</style>