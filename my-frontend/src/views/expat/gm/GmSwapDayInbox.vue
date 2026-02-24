<!-- src/views/coo/GmSwapDayInbox.vue
  ✅ GM bulk approve/reject (multi-select)
  ✅ Admin viewers can VIEW but CANNOT decide
  ✅ Realtime swap:req:created / swap:req:updated
  ✅ Attachments preview (read-only)
  ✅ Excel export
-->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/store/auth'

// ✅ realtime (same as User/Manager)
import socket, { subscribeRoleIfNeeded, subscribeEmployeeIfNeeded, subscribeUserIfNeeded } from '@/utils/socket'

// ✅ Excel export
import * as XLSX from 'xlsx'

import AttachmentPreviewModal from '@/views/expat/user/swap-day/AttachmentPreviewModal.vue'

defineOptions({ name: 'GmSwapDayInbox' })

const { showToast } = useToast()
const auth = useAuth()

/* ───────── responsive flag ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────────────── STATE ───────────────── */
const loading = ref(false)
const deciding = ref(false)
const rows = ref([])

const search = ref('')
const statusFilter = ref('ALL')

/* pagination */
const page = ref(1)
const perPage = ref(20)
const perPageOptions = [20, 50, 100, 'All']

/* view modal */
const viewOpen = ref(false)
const viewItem = ref(null)

/* attachments modal */
const filesOpen = ref(false)
const filesRequest = ref(null)
const filesItems = ref([])

/* single decision confirm modal */
const confirmOpen = ref(false)
const confirmBusy = ref(false)
const confirmType = ref('') // 'APPROVE' | 'REJECT'
const confirmTarget = ref(null)
const decisionNote = ref('')

/* bulk decision modal */
const bulkConfirmOpen = ref(false)
const bulkConfirmBusy = ref(false)
const bulkConfirmType = ref('') // 'APPROVE' | 'REJECT'
const bulkDecisionNote = ref('')

/* export */
const exporting = ref(false)

/* Helper */
const roles = computed(() => {
  const raw = Array.isArray(auth.user?.roles) ? auth.user.roles : []
  const one = auth.user?.role ? [auth.user.role] : []
  return [...new Set([...raw, ...one].map((r) => String(r || '').trim().toUpperCase()))]
})

const isAdminViewer = computed(() =>
  roles.value.includes('LEAVE_ADMIN') || roles.value.includes('ADMIN') || roles.value.includes('ROOT_ADMIN')
)

const isRealGm = computed(() => roles.value.includes('LEAVE_GM'))

/* ───────────────── COLUMN WIDTH CONFIG (DESKTOP TABLE) ───────────────── */
const COL_WIDTH = {
  select: '56px',
  created: '140px',
  employee: '240px',
  workDate: '200px',
  swapDate: '200px',
  file: '110px',
  status: '140px',
  actions: '92px',
  reason: '200px',
}

/* ───────────────── CONSTANTS ───────────────── */
const STATUS_LABEL = {
  ALL: 'All',
  PENDING_MANAGER: 'Pending (Mgr)',
  PENDING_GM: 'Pending (GM)',
  PENDING_COO: 'Pending (COO)',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
}

function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}

function fmtDateTime(v) {
  if (!v) return '—'
  return dayjs(v).format('YYYY-MM-DD HH:mm')
}

function fmtYmd(v) {
  if (!v) return '—'
  return dayjs(v).format('YYYY-MM-DD')
}

function statusBadgeUiClass(x) {
  const st = up(x)
  if (st === 'APPROVED') return 'ui-badge ui-badge-success'
  if (st === 'REJECTED') return 'ui-badge ui-badge-danger'
  if (st === 'CANCELLED') return 'ui-badge'
  if (st.includes('PENDING')) return 'ui-badge ui-badge-warning'
  return 'ui-badge'
}

/**
 * ✅ GM can decide ONLY when the request is pending for GM.
 */
function canDecide(row) {
  if (isAdminViewer.value) return false
  if (!isRealGm.value) return false
  return up(row?.status) === 'PENDING_GM'
}

/* brief reason helpers */
function compactText(v) {
  return String(v || '').replace(/\s+/g, ' ').trim()
}
function briefReason(v, max = 70) {
  const t = compactText(v)
  if (!t) return '—'
  if (t.length <= max) return t
  return t.slice(0, max).trimEnd() + '…'
}

function getRejectedReason(row) {
  const r = row || {}

  const a = compactText(r.rejectedReason)
  if (a) return a

  const m = compactText(r.managerComment)
  if (m) return m

  const g = compactText(r.gmComment)
  if (g) return g

  const c = compactText(r.cooComment)
  if (c) return c

  const steps = Array.isArray(r.approvals) ? r.approvals : []
  const rejectedStep = steps.find((x) => up(x?.status) === 'REJECTED')
  const note = compactText(rejectedStep?.note)
  if (note) return note

  return '—'
}

/* ───────────────── FETCH ───────────────── */
async function fetchInbox() {
  try {
    loading.value = true
    const res = await api.get('/leave/swap-working-day/gm/inbox?scope=ALL')
    rows.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    showToast({ type: 'error', message: e?.response?.data?.message || 'Failed to load GM inbox' })
  } finally {
    loading.value = false
  }
}

/* ───────────────── FILTER ───────────────── */
const filteredRows = computed(() => {
  let list = [...rows.value]

  if (statusFilter.value !== 'ALL') {
    list = list.filter((r) => up(r.status) === up(statusFilter.value))
  }

  const q = search.value.trim().toLowerCase()
  if (q) {
    list = list.filter((r) => {
      const hay = [
        r.employeeId,
        r.employeeName,
        r.name,
        r.department,
        r.reason,
        r.status,
        r.requestStartDate,
        r.requestEndDate,
        r.offStartDate,
        r.offEndDate,
      ]
        .map((x) => String(x || '').toLowerCase())
        .join(' ')
      return hay.includes(q)
    })
  }

  list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
  return list
})

const totalCount = computed(() => rows.value.length)
const filteredCount = computed(() => filteredRows.value.length)

const pageCount = computed(() => {
  if (perPage.value === 'All') return 1
  const per = Number(perPage.value || 20)
  return Math.ceil(filteredRows.value.length / per) || 1
})

const pagedRows = computed(() => {
  if (perPage.value === 'All') return filteredRows.value
  const per = Number(perPage.value || 20)
  const start = (page.value - 1) * per
  return filteredRows.value.slice(start, start + per)
})

watch(
  () => pageCount.value,
  (n) => {
    if (page.value > n) page.value = n
    if (page.value < 1) page.value = 1
  }
)

/* ───────────────── DETAILS VIEW ───────────────── */
function openView(row) {
  viewItem.value = row
  viewOpen.value = true
}
function closeView() {
  viewOpen.value = false
  viewItem.value = null
}

/* ───────────────── ATTACHMENTS ───────────────── */
function normalizeEvidenceList(list) {
  const arr = Array.isArray(list) ? list : []
  return arr
    .map((x) => ({ ...x, attId: x?.attId || x?.fileId || '' }))
    .filter((x) => x.attId)
}

async function openFiles(row) {
  filesRequest.value = row
  filesItems.value = []
  try {
    const res = await api.get(`/leave/swap-working-day/${row._id}/evidence`)
    filesItems.value = normalizeEvidenceList(res.data)
  } catch (e) {
    filesItems.value = normalizeEvidenceList(row.attachments || [])
    showToast({ type: 'error', message: e?.response?.data?.message || 'Failed to load attachments list' })
  } finally {
    filesOpen.value = true
  }
}

async function refreshFilesAgain() {
  const req = filesRequest.value
  if (!req?._id) return
  try {
    const res = await api.get(`/leave/swap-working-day/${req._id}/evidence`)
    filesItems.value = normalizeEvidenceList(res.data)

    const idx = rows.value.findIndex((r) => String(r._id) === String(req._id))
    if (idx >= 0) rows.value[idx].attachments = filesItems.value
  } catch (e) {
    showToast({ type: 'error', message: e?.response?.data?.message || 'Refresh attachments failed' })
  }
}

/* ───────────────── SINGLE DECISION ───────────────── */
function openApprove(row) {
  if (!canDecide(row)) return
  confirmType.value = 'APPROVE'
  confirmTarget.value = row
  decisionNote.value = ''
  confirmOpen.value = true
}

function openReject(row) {
  if (!canDecide(row)) return
  confirmType.value = 'REJECT'
  confirmTarget.value = row
  decisionNote.value = ''
  confirmOpen.value = true
}

function closeConfirm(force = false) {
  if (confirmBusy.value && !force) return
  confirmOpen.value = false
  confirmType.value = ''
  confirmTarget.value = null
  decisionNote.value = ''
}

async function confirmDecision() {
  const row = confirmTarget.value
  if (!row?._id) return

  const action = confirmType.value === 'APPROVE' ? 'APPROVE' : 'REJECT'
  const note = decisionNote.value?.trim?.() || ''

  if (action === 'REJECT' && !note) {
    showToast({ type: 'warning', message: 'Reject requires a reason.' })
    return
  }

  confirmBusy.value = true
  deciding.value = true

  try {
    await api.post(`/leave/swap-working-day/${row._id}/gm-decision`, {
      action,
      note,
      comment: note,
      reason: note,
    })

    showToast({
      type: 'success',
      message: action === 'APPROVE' ? 'Approved and sent to next step.' : 'Rejected.',
    })

    closeConfirm(true)
    closeView()
    await fetchInbox()
  } catch (e) {
    showToast({ type: 'error', message: e?.response?.data?.message || 'Decision failed' })
  } finally {
    confirmBusy.value = false
    deciding.value = false
  }
}

/* keep viewItem synced */
watch(
  () => rows.value,
  (list) => {
    if (!viewOpen.value || !viewItem.value?._id) return
    const found = (list || []).find((x) => String(x._id) === String(viewItem.value._id))
    if (found) viewItem.value = found
  },
  { deep: true }
)

/* ───────────────── BULK SELECT ───────────────── */
const selectedIds = ref(new Set())
const selectedCount = computed(() => selectedIds.value.size)

function isSelected(row) {
  return selectedIds.value.has(String(row?._id))
}
function toggleSelectRow(row) {
  const id = String(row?._id || '')
  if (!id) return
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}
function clearSelection() {
  selectedIds.value = new Set()
}

const selectableRows = computed(() => filteredRows.value.filter((r) => canDecide(r)))

const isAllSelected = computed(() => {
  const list = selectableRows.value
  if (!list.length) return false
  return list.every((r) => selectedIds.value.has(String(r._id)))
})
const isIndeterminate = computed(() => {
  const list = selectableRows.value
  if (!list.length) return false
  const picked = list.filter((r) => selectedIds.value.has(String(r._id))).length
  return picked > 0 && picked < list.length
})

function toggleSelectAll() {
  const list = selectableRows.value
  const next = new Set(selectedIds.value)

  if (isAllSelected.value) list.forEach((r) => next.delete(String(r._id)))
  else list.forEach((r) => next.add(String(r._id)))

  selectedIds.value = next
}

/* clear selection when filters/pagination inputs change */
watch(
  () => [search.value, statusFilter.value, perPage.value],
  () => {
    page.value = 1
    clearSelection()
  }
)

/* ───────────────── BULK DECISION ───────────────── */
function openBulkApprove() {
  if (!selectedCount.value) return
  bulkConfirmType.value = 'APPROVE'
  bulkDecisionNote.value = ''
  bulkConfirmOpen.value = true
}
function openBulkReject() {
  if (!selectedCount.value) return
  bulkConfirmType.value = 'REJECT'
  bulkDecisionNote.value = ''
  bulkConfirmOpen.value = true
}
function closeBulkConfirm(force = false) {
  if (bulkConfirmBusy.value && !force) return
  bulkConfirmOpen.value = false
  bulkConfirmType.value = ''
  bulkDecisionNote.value = ''
}

async function confirmBulkDecision() {
  if (!selectedCount.value) return

  const action = bulkConfirmType.value === 'APPROVE' ? 'APPROVE' : 'REJECT'
  const note = bulkDecisionNote.value?.trim?.() || ''

  if (action === 'REJECT' && !note) {
    showToast({ type: 'warning', message: 'Reject requires a reason.' })
    return
  }

  bulkConfirmBusy.value = true
  deciding.value = true

  const ids = Array.from(selectedIds.value)

  try {
    await api.post('/leave/swap-working-day/gm/bulk-decision', {
      ids,
      action,
      note,
      comment: note,
      reason: note,
    })

    showToast({
      type: 'success',
      message: action === 'APPROVE' ? `Approved ${ids.length} request(s).` : `Rejected ${ids.length} request(s).`,
    })

    closeBulkConfirm(true)
    clearSelection()
    await fetchInbox()
  } catch (e) {
    showToast({ type: 'error', message: e?.response?.data?.message || 'Bulk decision failed' })
  } finally {
    bulkConfirmBusy.value = false
    deciding.value = false
  }
}

/* ───────────────── REALTIME ───────────────── */
function upsertRow(doc) {
  if (!doc?._id) return
  const id = String(doc._id)
  const idx = rows.value.findIndex((x) => String(x._id) === id)

  if (idx >= 0) rows.value[idx] = { ...rows.value[idx], ...doc }
  else rows.value.unshift(doc)

  // keep modals synced
  if (viewItem.value?._id && String(viewItem.value._id) === id) viewItem.value = { ...viewItem.value, ...doc }
  if (filesRequest.value?._id && String(filesRequest.value._id) === id) filesRequest.value = { ...filesRequest.value, ...doc }

  // if moved out of pending_gm, auto-unselect
  if (up(doc?.status) !== 'PENDING_GM') {
    const next = new Set(selectedIds.value)
    next.delete(id)
    selectedIds.value = next
  }
}

function onSwapCreated(doc) {
  upsertRow(doc)
}
function onSwapUpdated(doc) {
  upsertRow(doc)
}

/* ───────────────── EXPORT / CLEAR FILTERS ───────────────── */
function clearFilters() {
  search.value = ''
  statusFilter.value = 'ALL'
  perPage.value = 20
  page.value = 1
  clearSelection()
}

function exportExcel() {
  try {
    exporting.value = true

    const list = filteredRows.value.map((r) => ({
      CreatedAt: r.createdAt ? dayjs(r.createdAt).format('YYYY-MM-DD HH:mm') : '',
      EmployeeID: r.employeeId || '',
      EmployeeName: r.employeeName || r.name || '',
      Department: r.department || '',
      WorkDateFrom: r.requestStartDate || '',
      WorkDateTo: r.requestEndDate || '',
      SwapDateFrom: r.offStartDate || '',
      SwapDateTo: r.offEndDate || '',
      RequestDays: r.requestTotalDays ?? '',
      OffDays: r.offTotalDays ?? '',
      Status: r.status || '',
      Reason: r.reason || '',
      Attachments: Array.isArray(r.attachments) ? r.attachments.length : 0,
    }))

    if (!list.length) {
      showToast({ type: 'warning', message: 'No data to export.' })
      return
    }

    const ws = XLSX.utils.json_to_sheet(list)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'GMInbox')

    const filename = `swap_gm_inbox_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`
    XLSX.writeFile(wb, filename)

    showToast({ type: 'success', message: 'Exported Excel.' })
  } catch (e) {
    showToast({ type: 'error', message: e?.message || 'Export failed' })
  } finally {
    exporting.value = false
  }
}

/* lifecycle */
onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)

  // ✅ join GM rooms (critical)
  try {
    subscribeRoleIfNeeded({ role: 'LEAVE_GM' })

    const empId = String(auth.user?.employeeId || auth.user?.empId || '').trim()
    const loginId = String(auth.user?.loginId || auth.user?.id || auth.user?.sub || '').trim()

    if (empId) await subscribeEmployeeIfNeeded(empId)
    if (loginId) await subscribeUserIfNeeded(loginId)
  } catch {}

  await fetchInbox()

  socket.on('swap:req:created', onSwapCreated)
  socket.on('swap:req:updated', onSwapUpdated)
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)

  socket.off('swap:req:created', onSwapCreated)
  socket.off('swap:req:updated', onSwapUpdated)
})
</script>

<template>
  <div class="ui-page min-h-screen w-full">
    <div class="w-full">
      <div class="ui-card rounded-none border-x-0 border-t-0 overflow-hidden">
        <!-- HERO -->
        <div class="ui-hero-gradient">
          <!-- Desktop header -->
          <div v-if="!isMobile" class="flex flex-wrap items-end justify-between gap-4">
            <div class="min-w-[240px]">
              <div class="text-[15px] font-extrabold">GM Inbox · Swap Working Day</div>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <span class="ui-badge ui-badge-info">Total: {{ totalCount }}</span>
                <span class="ui-badge ui-badge-info">Showing: {{ filteredCount }}</span>
                <span v-if="selectedCount" class="ui-badge ui-badge-warning">Selected: {{ selectedCount }}</span>
              </div>
            </div>

            <div class="flex flex-1 flex-wrap items-end justify-end gap-3">
              <div class="min-w-[260px] max-w-xs">
                <label class="mb-1 block text-[11px] font-extrabold text-white/90">Search</label>
                <div class="flex items-center rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-[11px]">
                  <i class="fa-solid fa-magnifying-glass mr-2 text-white/80" />
                  <input
                    v-model="search"
                    type="text"
                    placeholder="Employee, reason, status..."
                    class="w-full bg-transparent text-white outline-none placeholder:text-white/70"
                  />
                </div>
              </div>

              <div class="min-w-[180px]">
                <label class="mb-1 block text-[11px] font-extrabold text-white/90">Status</label>
                <select
                  v-model="statusFilter"
                  class="w-full rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-[11px] text-white outline-none"
                >
                  <option v-for="(label, key) in STATUS_LABEL" :key="key" :value="key">
                    {{ label }}
                  </option>
                </select>
              </div>

              <div class="flex items-center gap-2">
                <!-- Bulk controls -->
                <template v-if="isRealGm && !isAdminViewer">
                  <button
                    class="ui-btn ui-btn-sm ui-btn-soft"
                    type="button"
                    :disabled="loading || deciding || !selectableRows.length"
                    @click="toggleSelectAll"
                    :title="isAllSelected ? 'Unselect all pending' : 'Select all pending'"
                  >
                    <i class="fa-solid fa-check-double text-[11px]" />
                    <span class="ml-1">{{ selectedCount }}</span>
                  </button>

                  <button class="ui-btn ui-btn-sm ui-btn-emerald" type="button" :disabled="loading || deciding || !selectedCount" @click="openBulkApprove">
                    <i class="fa-solid fa-circle-check text-[11px]" />
                    Approve ({{ selectedCount }})
                  </button>

                  <button class="ui-btn ui-btn-sm ui-btn-rose" type="button" :disabled="loading || deciding || !selectedCount" @click="openBulkReject">
                    <i class="fa-solid fa-circle-xmark text-[11px]" />
                    Reject ({{ selectedCount }})
                  </button>

                  <button v-if="selectedCount" class="ui-btn ui-btn-sm ui-btn-ghost" type="button" :disabled="loading || deciding" @click="clearSelection" title="Clear selection">
                    <i class="fa-solid fa-xmark text-[11px]" />
                  </button>
                </template>

                <button class="ui-btn ui-btn-sm ui-btn-soft" type="button" :disabled="loading" @click="fetchInbox" title="Refresh">
                  <i class="fa-solid fa-rotate-right text-[11px]" />
                </button>

                <button class="ui-btn ui-btn-sm ui-btn-soft" type="button" :disabled="loading || exporting" @click="exportExcel" title="Export to Excel">
                  <i v-if="!exporting" class="fa-solid fa-file-excel text-[11px]" />
                  <i v-else class="fa-solid fa-spinner animate-spin text-[11px]" />
                </button>

                <button class="ui-btn ui-btn-sm ui-btn-ghost" type="button" :disabled="loading" @click="clearFilters" title="Clear filters">
                  <i class="fa-solid fa-broom text-[11px]" />
                </button>
              </div>
            </div>
          </div>

          <!-- Mobile header -->
          <div v-else class="space-y-3">
            <div>
              <div class="text-[15px] font-extrabold">GM Inbox · Swap Working Day</div>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <span class="ui-badge ui-badge-info">Total: {{ totalCount }}</span>
                <span class="ui-badge ui-badge-info">Showing: {{ filteredCount }}</span>
                <span v-if="selectedCount" class="ui-badge ui-badge-warning">Selected: {{ selectedCount }}</span>
              </div>
            </div>

            <div class="space-y-2">
              <div>
                <label class="mb-1 block text-[11px] font-extrabold text-white/90">Search</label>
                <div class="flex items-center rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-[11px]">
                  <i class="fa-solid fa-magnifying-glass mr-2 text-white/80" />
                  <input
                    v-model="search"
                    type="text"
                    placeholder="Employee, reason, status..."
                    class="w-full bg-transparent text-white outline-none placeholder:text-white/70"
                  />
                </div>
              </div>

              <div>
                <label class="mb-1 block text-[11px] font-extrabold text-white/90">Status</label>
                <select
                  v-model="statusFilter"
                  class="w-full rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-[11px] text-white outline-none"
                >
                  <option v-for="(label, key) in STATUS_LABEL" :key="key" :value="key">
                    {{ label }}
                  </option>
                </select>
              </div>

              <div class="flex flex-wrap items-center justify-end gap-2">
                <template v-if="isRealGm && !isAdminViewer">
                  <button class="ui-btn ui-btn-sm ui-btn-soft" type="button" :disabled="loading || deciding || !selectableRows.length" @click="toggleSelectAll">
                    <i class="fa-solid fa-check-double text-[11px]" />
                    Select ({{ selectedCount }})
                  </button>

                  <button class="ui-btn ui-btn-sm ui-btn-emerald" type="button" :disabled="loading || deciding || !selectedCount" @click="openBulkApprove">
                    Approve ({{ selectedCount }})
                  </button>

                  <button class="ui-btn ui-btn-sm ui-btn-rose" type="button" :disabled="loading || deciding || !selectedCount" @click="openBulkReject">
                    Reject ({{ selectedCount }})
                  </button>
                </template>

                <button class="ui-btn ui-btn-sm ui-btn-soft" type="button" :disabled="loading" @click="fetchInbox">
                  <i class="fa-solid fa-rotate-right text-[11px]" />
                  Refresh
                </button>

                <button class="ui-btn ui-btn-sm ui-btn-soft" type="button" :disabled="loading || exporting" @click="exportExcel">
                  <i v-if="!exporting" class="fa-solid fa-file-excel text-[11px]" />
                  <i v-else class="fa-solid fa-spinner animate-spin text-[11px]" />
                  Excel
                </button>

                <button class="ui-btn ui-btn-sm ui-btn-ghost" type="button" :disabled="loading" @click="clearFilters">
                  <i class="fa-solid fa-broom text-[11px]" />
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- BODY -->
        <div class="px-2 pb-3 pt-3 sm:px-4 lg:px-6">
          <div v-if="loading && !filteredRows.length" class="ui-skeleton h-14 w-full mb-2" />

          <!-- ✅ MOBILE CARDS -->
          <div v-if="isMobile" class="space-y-2">
            <div v-if="!pagedRows.length && !loading" class="ui-frame p-4 text-center text-[12px] text-slate-500">No items found.</div>

            <article v-for="row in pagedRows" :key="row._id" class="ui-card p-3 cursor-pointer" @click="openView(row)">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 space-y-1">
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    Created:
                    <span class="font-extrabold text-slate-900 dark:text-slate-50">{{ fmtDateTime(row.createdAt) }}</span>
                  </div>

                  <div class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50 truncate">
                    {{ row.employeeName || row.name || row.employeeId || '—' }}
                  </div>

                  <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate">ID: {{ row.employeeId || '—' }}</div>
                </div>

                <div class="shrink-0 text-right space-y-1 flex items-start gap-2">
                  <span :class="statusBadgeUiClass(row.status)">{{ STATUS_LABEL[row.status] || row.status }}</span>

                  <input
                    v-if="canDecide(row)"
                    type="checkbox"
                    class="mt-1"
                    :checked="isSelected(row)"
                    @click.stop
                    @change="toggleSelectRow(row)"
                    aria-label="Select row"
                  />
                </div>
              </div>

              <div class="mt-2 grid gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                <div class="ui-frame p-2">
                  <div class="font-extrabold text-slate-700 dark:text-slate-200">Work Date</div>
                  <div class="mt-0.5">{{ fmtYmd(row.requestStartDate) }} → {{ fmtYmd(row.requestEndDate) }}</div>
                </div>

                <div class="ui-frame p-2">
                  <div class="font-extrabold text-slate-700 dark:text-slate-200">Swap Date</div>
                  <div class="mt-0.5">{{ fmtYmd(row.offStartDate) }} → {{ fmtYmd(row.offEndDate) }}</div>
                </div>

                <div class="ui-frame p-2">
                  <div class="font-extrabold text-slate-700 dark:text-slate-200">Reason</div>
                  <div class="mt-0.5">{{ briefReason(row.reason, 140) }}</div>
                </div>
              </div>

              <div class="mt-3 flex items-center justify-between gap-2" @click.stop>
                <button
                  v-if="row.attachments?.length"
                  type="button"
                  class="ui-btn ui-btn-xs ui-btn-soft ui-icon-btn"
                  :disabled="loading"
                  @click="openFiles(row)"
                  title="Attachments"
                  aria-label="Attachments"
                >
                  <i class="fa-solid fa-paperclip text-[12px]" />
                  <span class="ml-1">{{ row.attachments.length }}</span>
                </button>
                <span v-else class="text-[11px] text-slate-400">No files</span>

                <div class="flex items-center gap-2">
                  <template v-if="canDecide(row)">
                    <button type="button" class="ui-btn ui-btn-xs ui-btn-emerald ui-icon-btn" :disabled="loading || deciding" @click="openApprove(row)" title="Approve">
                      <i class="fa-solid fa-circle-check text-[12px]" />
                    </button>

                    <button type="button" class="ui-btn ui-btn-xs ui-btn-rose ui-icon-btn" :disabled="loading || deciding" @click="openReject(row)" title="Reject">
                      <i class="fa-solid fa-circle-xmark text-[12px]" />
                    </button>
                  </template>

                  <span v-else class="text-[11px] text-slate-400">—</span>
                </div>
              </div>
            </article>
          </div>

          <!-- ✅ DESKTOP TABLE -->
          <div v-else class="ui-table-wrap">
            <table class="ui-table table-fixed w-full min-w-[1150px]">
              <colgroup>
                <col :style="{ width: COL_WIDTH.select }" />
                <col :style="{ width: COL_WIDTH.created }" />
                <col :style="{ width: COL_WIDTH.employee }" />
                <col :style="{ width: COL_WIDTH.workDate }" />
                <col :style="{ width: COL_WIDTH.swapDate }" />
                <col :style="{ width: COL_WIDTH.file }" />
                <col :style="{ width: COL_WIDTH.status }" />
                <col :style="{ width: COL_WIDTH.actions }" />
                <col :style="{ width: COL_WIDTH.reason }" />
              </colgroup>

              <thead>
                <tr>
                  <th class="ui-th text-center">
                    <input
                      v-if="isRealGm && !isAdminViewer"
                      type="checkbox"
                      :checked="isAllSelected"
                      :indeterminate.prop="isIndeterminate"
                      @change="toggleSelectAll"
                      aria-label="Select all pending"
                    />
                  </th>
                  <th class="ui-th">Created</th>
                  <th class="ui-th">Employee</th>
                  <th class="ui-th">Work Date</th>
                  <th class="ui-th">Swap Date</th>
                  <th class="ui-th text-center">File</th>
                  <th class="ui-th">Status</th>
                  <th class="ui-th text-center">Action</th>
                  <th class="ui-th">Reason</th>
                </tr>
              </thead>

              <tbody>
                <tr v-if="!loading && !pagedRows.length">
                  <td colspan="9" class="ui-td py-8 text-slate-500 dark:text-slate-400">No items found.</td>
                </tr>

                <tr v-for="row in pagedRows" :key="row._id" class="ui-tr-hover cursor-pointer" @click="openView(row)">
                  <td class="ui-td text-center" @click.stop>
                    <input v-if="canDecide(row)" type="checkbox" :checked="isSelected(row)" @change="toggleSelectRow(row)" aria-label="Select row" />
                    <span v-else class="text-[11px] text-slate-400">—</span>
                  </td>

                  <td class="ui-td"><div class="truncate">{{ fmtDateTime(row.createdAt) }}</div></td>

                  <td class="ui-td">
                    <div class="font-extrabold text-slate-900 dark:text-slate-50 truncate">{{ row.employeeName || row.name || row.employeeId || '—' }}</div>
                    <div class="text-[10px] text-slate-500 dark:text-slate-400 truncate">ID: {{ row.employeeId || '—' }}</div>
                  </td>

                  <td class="ui-td"><div class="truncate">{{ fmtYmd(row.requestStartDate) }} → {{ fmtYmd(row.requestEndDate) }}</div></td>
                  <td class="ui-td"><div class="truncate">{{ fmtYmd(row.offStartDate) }} → {{ fmtYmd(row.offEndDate) }}</div></td>

                  <td class="ui-td text-center" @click.stop>
                    <button
                      v-if="row.attachments?.length"
                      type="button"
                      class="ui-btn ui-btn-xs ui-btn-soft ui-icon-btn"
                      :disabled="loading"
                      @click="openFiles(row)"
                      title="Attachments"
                      aria-label="Attachments"
                    >
                      <i class="fa-solid fa-paperclip text-[12px]" />
                      <span class="ml-1">{{ row.attachments.length }}</span>
                    </button>
                    <span v-else class="text-[11px] text-slate-400">—</span>
                  </td>

                  <td class="ui-td">
                    <span :class="statusBadgeUiClass(row.status)">{{ STATUS_LABEL[row.status] || row.status }}</span>
                  </td>

                  <td class="ui-td text-center" @click.stop>
                    <div class="flex items-center justify-center gap-1">
                      <template v-if="canDecide(row)">
                        <button type="button" class="ui-btn ui-btn-xs ui-btn-emerald ui-icon-btn" :disabled="loading || deciding" @click="openApprove(row)" title="Approve">
                          <i class="fa-solid fa-circle-check text-[12px]" />
                        </button>

                        <button type="button" class="ui-btn ui-btn-xs ui-btn-rose ui-icon-btn" :disabled="loading || deciding" @click="openReject(row)" title="Reject">
                          <i class="fa-solid fa-circle-xmark text-[12px]" />
                        </button>
                      </template>

                      <span v-else class="text-[11px] text-slate-400">—</span>
                    </div>
                  </td>

                  <td class="ui-td">
                    <p class="reason-cell" :title="compactText(row.reason)">{{ row.reason ? compactText(row.reason) : '—' }}</p>
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
              <span class="text-[11px] text-slate-500 dark:text-slate-400">Page {{ page }} / {{ pageCount }}</span>
            </div>

            <div class="flex items-center justify-end gap-1">
              <button type="button" class="ui-pagebtn" :disabled="page <= 1" @click="page = 1">«</button>
              <button type="button" class="ui-pagebtn" :disabled="page <= 1" @click="page = Math.max(1, page - 1)">Prev</button>
              <button type="button" class="ui-pagebtn" :disabled="page >= pageCount" @click="page = Math.min(pageCount, page + 1)">Next</button>
              <button type="button" class="ui-pagebtn" :disabled="page >= pageCount" @click="page = pageCount">»</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- DETAILS MODAL -->
    <div v-if="viewOpen" class="ui-modal-backdrop">
      <div class="ui-modal p-0 overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <div class="min-w-0">
            <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Swap Request Details</div>
            <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {{ viewItem?.employeeName || viewItem?.name || '—' }} · {{ fmtDateTime(viewItem?.createdAt) }}
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button v-if="viewItem?.attachments?.length" class="ui-btn ui-btn-soft ui-btn-xs" type="button" @click="openFiles(viewItem)">
              <i class="fa-solid fa-paperclip text-[11px]" />
              Attachments
            </button>

            <button class="ui-btn ui-btn-ghost ui-btn-xs" type="button" @click="closeView">
              <i class="fa-solid fa-xmark text-[11px]" />
              Close
            </button>
          </div>
        </div>

        <div class="p-4 space-y-3">
          <div class="ui-frame p-3">
            <div class="grid gap-3 md:grid-cols-2">
              <div>
                <div class="ui-label">Employee</div>
                <div class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                  {{ viewItem?.employeeName || viewItem?.name || '—' }}
                </div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400">ID: {{ viewItem?.employeeId || '—' }}</div>
              </div>

              <div class="text-right md:text-left">
                <div class="ui-label">Status</div>
                <span :class="statusBadgeUiClass(viewItem?.status)">{{ STATUS_LABEL[viewItem?.status] || viewItem?.status }}</span>
              </div>
            </div>
          </div>

          <div class="grid gap-3 md:grid-cols-2">
            <div class="ui-card p-3">
              <div class="ui-section-title">Request Non-working Date(s)</div>
              <div class="mt-1 text-[12px] text-slate-700 dark:text-slate-200">
                {{ fmtYmd(viewItem?.requestStartDate) }} → {{ fmtYmd(viewItem?.requestEndDate) }}
              </div>
            </div>

            <div class="ui-card p-3">
              <div class="ui-section-title">Compensatory Working Day(s)</div>
              <div class="mt-1 text-[12px] text-slate-700 dark:text-slate-200">
                {{ fmtYmd(viewItem?.offStartDate) }} → {{ fmtYmd(viewItem?.offEndDate) }}
              </div>
            </div>
          </div>

          <div class="ui-card p-3">
            <div class="ui-section-title">Reason</div>
            <div class="mt-1 text-[12px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{{ viewItem?.reason || '—' }}</div>
          </div>

          <div v-if="up(viewItem?.status) === 'REJECTED'" class="ui-card p-3">
            <div class="ui-section-title text-rose-600 dark:text-rose-400">Rejected Reason</div>
            <div class="mt-1 text-[12px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{{ getRejectedReason(viewItem) }}</div>
          </div>

          <div class="flex justify-end gap-2 pt-1">
            <button class="ui-btn ui-btn-ghost" type="button" @click="closeView">Close</button>

            <template v-if="canDecide(viewItem)">
              <button class="ui-btn ui-btn-rose" type="button" @click="openReject(viewItem)">Reject</button>
              <button class="ui-btn ui-btn-emerald" type="button" @click="openApprove(viewItem)">Approve</button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- SINGLE CONFIRM MODAL -->
    <div v-if="confirmOpen" class="ui-modal-backdrop">
      <div class="ui-modal p-4">
        <div class="flex items-start gap-3">
          <div
            class="grid h-10 w-10 place-items-center rounded-2xl border"
            :style="
              confirmType === 'APPROVE'
                ? 'border-color: rgb(var(--ui-success) / 0.25); background: rgb(var(--ui-success) / 0.10); color: rgb(var(--ui-success));'
                : 'border-color: rgb(var(--ui-danger) / 0.25); background: rgb(var(--ui-danger) / 0.10); color: rgb(var(--ui-danger));'
            "
          >
            <i :class="confirmType === 'APPROVE' ? 'fa-solid fa-check' : 'fa-solid fa-xmark'" />
          </div>

          <div class="flex-1">
            <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">
              {{ confirmType === 'APPROVE' ? 'Approve this request?' : 'Reject this request?' }}
            </div>
            <div class="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
              Employee: <span class="font-extrabold">{{ confirmTarget?.employeeName || confirmTarget?.name || '—' }}</span>
            </div>
          </div>
        </div>

        <div class="mt-3 ui-field">
          <textarea
            v-model="decisionNote"
            rows="3"
            class="ui-textarea"
            :placeholder="confirmType === 'REJECT' ? 'Please type the reason for rejection...' : 'Add a short note for the employee (optional)...'"
          />
        </div>

        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="ui-btn ui-btn-ghost" :disabled="confirmBusy" @click="closeConfirm()">Close</button>

          <button
            type="button"
            class="ui-btn"
            :class="confirmType === 'APPROVE' ? 'ui-btn-emerald' : 'ui-btn-rose'"
            :disabled="confirmBusy"
            @click="confirmDecision"
          >
            <i v-if="confirmBusy" class="fa-solid fa-spinner animate-spin text-[11px]" />
            {{ confirmType === 'APPROVE' ? 'Approve' : 'Reject' }}
          </button>
        </div>
      </div>
    </div>

    <!-- BULK CONFIRM MODAL -->
    <div v-if="bulkConfirmOpen" class="ui-modal-backdrop">
      <div class="ui-modal p-4">
        <div class="flex items-start gap-3">
          <div
            class="grid h-10 w-10 place-items-center rounded-2xl border"
            :style="
              bulkConfirmType === 'APPROVE'
                ? 'border-color: rgb(var(--ui-success) / 0.25); background: rgb(var(--ui-success) / 0.10); color: rgb(var(--ui-success));'
                : 'border-color: rgb(var(--ui-danger) / 0.25); background: rgb(var(--ui-danger) / 0.10); color: rgb(var(--ui-danger));'
            "
          >
            <i :class="bulkConfirmType === 'APPROVE' ? 'fa-solid fa-check' : 'fa-solid fa-xmark'" />
          </div>

          <div class="flex-1">
            <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">
              {{ bulkConfirmType === 'APPROVE' ? 'Approve selected requests?' : 'Reject selected requests?' }}
            </div>
            <div class="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
              Selected: <span class="font-extrabold">{{ selectedCount }}</span>
            </div>
          </div>
        </div>

        <div class="mt-3 ui-field">
          <textarea
            v-model="bulkDecisionNote"
            rows="3"
            class="ui-textarea"
            :placeholder="bulkConfirmType === 'REJECT' ? 'Please type the reason for rejection...' : 'Add a short note (optional)...'"
          />
        </div>

        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="ui-btn ui-btn-ghost" :disabled="bulkConfirmBusy" @click="closeBulkConfirm()">Close</button>

          <button
            type="button"
            class="ui-btn"
            :class="bulkConfirmType === 'APPROVE' ? 'ui-btn-emerald' : 'ui-btn-rose'"
            :disabled="bulkConfirmBusy"
            @click="confirmBulkDecision"
          >
            <i v-if="bulkConfirmBusy" class="fa-solid fa-spinner animate-spin text-[11px]" />
            {{ bulkConfirmType === 'APPROVE' ? `Approve (${selectedCount})` : `Reject (${selectedCount})` }}
          </button>
        </div>
      </div>
    </div>

    <!-- ATTACHMENT PREVIEW MODAL -->
    <AttachmentPreviewModal
      v-model="filesOpen"
      :request-id="filesRequest?._id"
      title="Attachments"
      :subtitle="filesRequest ? `${fmtYmd(filesRequest.requestStartDate)} → ${fmtYmd(filesRequest.requestEndDate)}` : ''"
      :items="filesItems"
      :fetch-content-path="(requestId, attId) => `/leave/swap-working-day/${requestId}/evidence/${attId}/content`"
      :delete-path="null"
      :can-delete="false"
      @refresh="refreshFilesAgain()"
    />
  </div>
</template>

<style scoped>
.ui-icon-btn {
  padding-left: 0.55rem !important;
  padding-right: 0.55rem !important;
}
.reason-cell {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.35;
}
</style>