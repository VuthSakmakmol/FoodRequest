<!-- src/views/expat/coo/CooSwapDayInbox.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/store/auth'
import socket, {
  subscribeRoleIfNeeded,
  subscribeEmployeeIfNeeded,
  subscribeUserIfNeeded,
} from '@/utils/socket'
import * as XLSX from 'xlsx'

defineOptions({ name: 'CooSwapDayInbox' })

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
const fromDate = ref('')
const toDate = ref('')

/* ✅ lazy scroll pagination */
const LOAD_STEP = 20
const visibleLimit = ref(LOAD_STEP)
const lazyAnchor = ref(null)
let lazyObserver = null

const viewOpen = ref(false)
const viewItem = ref(null)

/* reject modal */
const rejectOpen = ref(false)
const rejectBusy = ref(false)
const rejectTarget = ref(null)
const rejectNote = ref('')

/* bulk approve modal */
const bulkApproveOpen = ref(false)
const bulkApproveBusy = ref(false)
const bulkApproveNote = ref('')

const exporting = ref(false)
const selectedIds = ref([])

/* roles / permissions */
const roles = computed(() => {
  const raw = Array.isArray(auth.user?.roles) ? auth.user.roles : []
  const one = auth.user?.role ? [auth.user.role] : []
  return [...new Set([...raw, ...one].map((r) => String(r || '').trim().toUpperCase()).filter(Boolean))]
})

const isAdminViewer = computed(
  () =>
    roles.value.includes('LEAVE_ADMIN') ||
    roles.value.includes('ADMIN') ||
    roles.value.includes('ROOT_ADMIN')
)

const isRealCoo = computed(() => roles.value.includes('LEAVE_COO'))

/* ───────────────── COLUMN WIDTH CONFIG ───────────────── */
const COL_WIDTH = {
  select: '56px',
  created: '140px',
  employee: '240px',
  workDate: '190px',
  swapDate: '190px',
  mode: '140px',
  status: '140px',
  actions: '120px',
  reason: '220px',
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
  return dayjs(v).format('DD/MM/YYYY HH:mm')
}

function fmtYmd(v) {
  if (!v) return '—'
  return dayjs(v).format('DD/MM/YYYY')
}

function statusBadgeUiClass(x) {
  const st = up(x)
  if (st === 'APPROVED') return 'ui-badge ui-badge-success'
  if (st === 'REJECTED') return 'ui-badge ui-badge-danger'
  if (st === 'CANCELLED') return 'ui-badge'
  if (st.includes('PENDING')) return 'ui-badge ui-badge-warning'
  return 'ui-badge'
}

function modeChipClasses(mode) {
  const m = up(mode)
  if (m === 'GM_AND_COO') return 'ui-badge ui-badge-indigo'
  if (m === 'MANAGER_AND_COO') return 'ui-badge ui-badge-indigo'
  if (m === 'COO_ONLY') return 'ui-badge ui-badge-indigo'
  if (m === 'MANAGER_ONLY') return 'ui-badge ui-badge-success'
  if (m === 'GM_ONLY') return 'ui-badge ui-badge-success'
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

function canDecide(row) {
  if (isAdminViewer.value) return false
  if (!isRealCoo.value) return false
  return up(row?.status) === 'PENDING_COO'
}

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

function overlapsDateRange(row) {
  const from = s(fromDate.value)
  const to = s(toDate.value)

  if (!from && !to) return true

  const start = s(row?.requestStartDate)
  const end = s(row?.requestEndDate) || start

  if (!start) return false
  if (from && end < from) return false
  if (to && start > to) return false

  return true
}

/* ───────────────── FETCH ───────────────── */
async function fetchInbox() {
  try {
    loading.value = true

    const params = { scope: 'ALL' }

    if (fromDate.value) params.fromDate = fromDate.value
    if (toDate.value) params.toDate = toDate.value

    const res = await api.get('/leave/swap-working-day/coo/inbox', { params })
    rows.value = Array.isArray(res.data) ? res.data : []

    resetVisibleRows()
    pruneSelection()

    await nextTick()
    setupLazyObserver()
  } catch (e) {
    showToast({
      type: 'error',
      message: e?.response?.data?.message || 'Failed to load COO inbox',
    })
  } finally {
    loading.value = false
  }
}

/* ───────────────── FILTER ───────────────── */
const filteredRows = computed(() => {
  let list = [...rows.value]

  if (fromDate.value || toDate.value) {
    list = list.filter((r) => overlapsDateRange(r))
  }

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
        r.approvalMode,
        modeLabel(r.approvalMode),
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

const displayedRows = computed(() => filteredRows.value.slice(0, visibleLimit.value))

const totalCount = computed(() => rows.value.length)
const filteredCount = computed(() => filteredRows.value.length)
const displayedCount = computed(() => displayedRows.value.length)
const remainingCount = computed(() => Math.max(0, filteredRows.value.length - displayedRows.value.length))
const canLoadMore = computed(() => displayedRows.value.length < filteredRows.value.length)

function resetVisibleRows() {
  visibleLimit.value = LOAD_STEP
}

function loadMoreRows() {
  if (loading.value) return
  if (!canLoadMore.value) return

  visibleLimit.value = Math.min(visibleLimit.value + LOAD_STEP, filteredRows.value.length)

  nextTick(() => {
    setupLazyObserver()
  })
}

function disconnectLazyObserver() {
  if (lazyObserver) {
    lazyObserver.disconnect()
    lazyObserver = null
  }
}

function setupLazyObserver() {
  disconnectLazyObserver()

  if (typeof window === 'undefined') return
  if (!lazyAnchor.value) return
  if (!canLoadMore.value) return

  lazyObserver = new IntersectionObserver(
    (entries) => {
      const entry = entries?.[0]
      if (entry?.isIntersecting) {
        loadMoreRows()
      }
    },
    {
      root: null,
      rootMargin: '260px 0px',
      threshold: 0.01,
    }
  )

  lazyObserver.observe(lazyAnchor.value)
}

watch(
  () => [search.value, statusFilter.value],
  async () => {
    resetVisibleRows()
    clearSelection()
    await nextTick()
    setupLazyObserver()
  }
)

watch(
  () => [fromDate.value, toDate.value],
  async () => {
    resetVisibleRows()
    clearSelection()
    await fetchInbox()
  }
)

watch(isMobile, async () => {
  await nextTick()
  setupLazyObserver()
})

function clearFilters() {
  search.value = ''
  statusFilter.value = 'ALL'
  fromDate.value = ''
  toDate.value = ''
  resetVisibleRows()
  clearSelection()

  nextTick(() => {
    setupLazyObserver()
  })
}

/* ───────────────── SELECTION ───────────────── */
function rowKey(row) {
  return s(row?._id)
}

function isSelected(row) {
  const id = rowKey(row)
  if (!id) return false
  return selectedIds.value.includes(id)
}

function setSelectedIds(ids = []) {
  selectedIds.value = [...new Set((ids || []).map(s).filter(Boolean))]
}

function toggleRowSelection(row) {
  if (!canDecide(row)) return

  const id = rowKey(row)
  if (!id) return

  if (selectedIds.value.includes(id)) {
    setSelectedIds(selectedIds.value.filter((x) => x !== id))
  } else {
    setSelectedIds([...selectedIds.value, id])
  }
}

function clearSelection() {
  selectedIds.value = []
}

const selectableDisplayedRows = computed(() => displayedRows.value.filter((r) => canDecide(r)))

const selectedRows = computed(() => {
  const ids = new Set(selectedIds.value)
  return filteredRows.value.filter((r) => ids.has(rowKey(r)) && canDecide(r))
})

const selectedCount = computed(() => selectedRows.value.length)

const allDisplayedSelected = computed(() => {
  if (!selectableDisplayedRows.value.length) return false
  return selectableDisplayedRows.value.every((r) => isSelected(r))
})

const someDisplayedSelected = computed(() => {
  if (!selectableDisplayedRows.value.length) return false
  return selectableDisplayedRows.value.some((r) => isSelected(r))
})

function toggleSelectVisible() {
  const visibleIds = selectableDisplayedRows.value.map(rowKey).filter(Boolean)

  if (!visibleIds.length) return

  if (allDisplayedSelected.value) {
    const visibleIdSet = new Set(visibleIds)
    setSelectedIds(selectedIds.value.filter((id) => !visibleIdSet.has(id)))
    return
  }

  setSelectedIds([...selectedIds.value, ...visibleIds])
}

function pruneSelection() {
  const validIds = new Set(filteredRows.value.filter((r) => canDecide(r)).map(rowKey).filter(Boolean))
  setSelectedIds(selectedIds.value.filter((id) => validIds.has(id)))
}

watch(filteredRows, async () => {
  pruneSelection()
  await nextTick()
  setupLazyObserver()
})

/* ───────────────── DETAILS VIEW ───────────────── */
function openView(row) {
  viewItem.value = row
  viewOpen.value = true
}

function closeView() {
  viewOpen.value = false
  viewItem.value = null
}

watch(
  () => rows.value,
  (list) => {
    if (!viewOpen.value || !viewItem.value?._id) return

    const found = (list || []).find((x) => String(x._id) === String(viewItem.value._id))
    if (found) viewItem.value = found
  },
  { deep: true }
)

/* ───────────────── REJECT DECISION ───────────────── */
function openReject(row) {
  if (!canDecide(row)) return

  rejectTarget.value = row
  rejectNote.value = ''
  rejectOpen.value = true
}

function closeReject(force = false) {
  if (rejectBusy.value && !force) return

  rejectOpen.value = false
  rejectTarget.value = null
  rejectNote.value = ''
}

async function confirmReject() {
  const row = rejectTarget.value
  if (!row?._id) return

  const note = rejectNote.value?.trim?.() || ''

  if (!note) {
    showToast({ type: 'warning', message: 'Reject requires a reason.' })
    return
  }

  rejectBusy.value = true
  deciding.value = true

  try {
    await api.post(`/leave/swap-working-day/${row._id}/coo-decision`, {
      action: 'REJECT',
      note,
      comment: note,
      reason: note,
    })

    showToast({ type: 'success', message: 'Rejected.' })

    closeReject(true)
    closeView()

    await fetchInbox()
  } catch (e) {
    showToast({ type: 'error', message: e?.response?.data?.message || 'Decision failed' })
  } finally {
    rejectBusy.value = false
    deciding.value = false
  }
}

/* ───────────────── BULK APPROVE ───────────────── */
function openBulkApprove() {
  if (!selectedCount.value) {
    showToast({ type: 'info', message: 'Please select at least one pending COO request first.' })
    return
  }

  bulkApproveNote.value = ''
  bulkApproveOpen.value = true
}

function closeBulkApprove(force = false) {
  if (bulkApproveBusy.value && !force) return

  bulkApproveOpen.value = false
  bulkApproveNote.value = ''
}

async function confirmBulkApprove() {
  const ids = selectedRows.value.map((r) => rowKey(r)).filter(Boolean)

  if (!ids.length) {
    showToast({ type: 'warning', message: 'No selected request can be approved.' })
    closeBulkApprove(true)
    return
  }

  const note = bulkApproveNote.value?.trim?.() || ''

  bulkApproveBusy.value = true
  deciding.value = true

  try {
    await api.post('/leave/swap-working-day/coo/bulk-decision', {
      ids,
      action: 'APPROVE',
      note,
      comment: note,
      reason: note,
    })

    showToast({
      type: 'success',
      message: `Approved ${ids.length} request(s).`,
    })

    closeBulkApprove(true)
    clearSelection()

    await fetchInbox()
  } catch (e) {
    showToast({ type: 'error', message: e?.response?.data?.message || 'Bulk approve failed' })
  } finally {
    bulkApproveBusy.value = false
    deciding.value = false
  }
}

/* ───────────────── REALTIME ───────────────── */
function upsertRow(doc) {
  if (!doc?._id) return

  const id = String(doc._id)
  const idx = rows.value.findIndex((x) => String(x._id) === id)

  if (idx >= 0) {
    rows.value[idx] = { ...rows.value[idx], ...doc }
  } else {
    rows.value.unshift(doc)
  }

  if (viewItem.value?._id && String(viewItem.value._id) === id) {
    viewItem.value = { ...viewItem.value, ...doc }
  }

  if (up(doc?.status) !== 'PENDING_COO') {
    setSelectedIds(selectedIds.value.filter((x) => x !== id))
  }

  nextTick(() => {
    setupLazyObserver()
  })
}

function onSwapCreated(doc) {
  upsertRow(doc)
}

function onSwapUpdated(doc) {
  upsertRow(doc)
}

/* ───────────────── EXPORT ───────────────── */
function exportExcel() {
  try {
    exporting.value = true

    const list = filteredRows.value.map((r) => ({
      CreatedAt: r.createdAt ? dayjs(r.createdAt).format('DD/MM/YYYY HH:mm') : '',
      EmployeeID: r.employeeId || '',
      EmployeeName: r.employeeName || r.name || '',
      Department: r.department || '',
      ApprovalMode: modeLabel(r.approvalMode),
      WorkDateFrom: r.requestStartDate ? dayjs(r.requestStartDate).format('DD/MM/YYYY') : '',
      WorkDateTo: r.requestEndDate ? dayjs(r.requestEndDate).format('DD/MM/YYYY') : '',
      SwapDateFrom: r.offStartDate ? dayjs(r.offStartDate).format('DD/MM/YYYY') : '',
      SwapDateTo: r.offEndDate ? dayjs(r.offEndDate).format('DD/MM/YYYY') : '',
      RequestDays: r.requestTotalDays ?? '',
      OffDays: r.offTotalDays ?? '',
      Status: r.status || '',
      Reason: r.reason || '',
      RejectedReason: up(r.status) === 'REJECTED' ? getRejectedReason(r) : '',
    }))

    if (!list.length) {
      showToast({ type: 'warning', message: 'No data to export.' })
      return
    }

    const ws = XLSX.utils.json_to_sheet(list)
    const wb = XLSX.utils.book_new()

    ws['!cols'] = [
      { wch: 18 },
      { wch: 14 },
      { wch: 24 },
      { wch: 18 },
      { wch: 18 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 12 },
      { wch: 12 },
      { wch: 18 },
      { wch: 50 },
      { wch: 50 },
    ]

    XLSX.utils.book_append_sheet(wb, ws, 'COOInbox')

    const filename = `swap_coo_inbox_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`
    XLSX.writeFile(wb, filename)

    showToast({ type: 'success', message: 'Exported Excel.' })
  } catch (e) {
    showToast({ type: 'error', message: e?.message || 'Export failed' })
  } finally {
    exporting.value = false
  }
}

/* ───────────────── MODAL UX ───────────────── */
function lockBodyScroll(on) {
  if (typeof document === 'undefined') return
  document.body.classList.toggle('overflow-hidden', !!on)
}

watch([viewOpen, rejectOpen, bulkApproveOpen], ([v, r, b]) => {
  lockBodyScroll(!!(v || r || b))
})

function onKeydown(e) {
  if (e.key !== 'Escape') return
  if (bulkApproveOpen.value) return closeBulkApprove()
  if (rejectOpen.value) return closeReject()
  if (viewOpen.value) return closeView()
}

/* lifecycle */
onMounted(async () => {
  updateIsMobile()

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateIsMobile)
    window.addEventListener('keydown', onKeydown)
  }

  try {
    subscribeRoleIfNeeded({ role: 'LEAVE_COO' })

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
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateIsMobile)
    window.removeEventListener('keydown', onKeydown)
  }

  socket.off('swap:req:created', onSwapCreated)
  socket.off('swap:req:updated', onSwapUpdated)

  disconnectLazyObserver()
  lockBodyScroll(false)
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
            <div class="flex flex-col gap-1 min-w-[240px]">
              <div class="mt-1 flex flex-wrap items-center gap-1.5">
                <span class="ui-badge ui-badge-info">Total: {{ totalCount }}</span>
                <span class="ui-badge ui-badge-info">Showing: {{ displayedCount }} / {{ filteredCount }}</span>
                <span v-if="selectedCount" class="ui-badge ui-badge-success">Selected: {{ selectedCount }}</span>
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
                    <option v-for="(label, key) in STATUS_LABEL" :key="key" :value="key">
                      {{ label }}
                    </option>
                  </select>
                </div>
              </div>

              <div class="w-[190px]">
                <div class="ui-field">
                  <label class="text-[10px] font-extrabold text-white/90">Search</label>
                  <div class="flex h-[34px] items-center gap-1.5 rounded-xl border border-white/25 bg-white/10 px-2">
                    <i class="fa-solid fa-magnifying-glass text-[11px] text-white/80" />
                    <input
                      v-model="search"
                      type="text"
                      placeholder="Employee / reason / mode..."
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
                  v-if="selectedCount"
                  class="ui-btn ui-btn-sm ui-btn-emerald md:h-[34px] md:px-2 md:text-[11px]"
                  type="button"
                  :disabled="loading || deciding"
                  @click="openBulkApprove"
                >
                  <i class="fa-solid fa-circle-check text-[11px]" />
                  Approve Selected ({{ selectedCount }})
                </button>

                <button
                  v-if="selectedCount"
                  class="ui-btn ui-btn-sm ui-btn-ghost md:h-[34px] md:px-2 md:text-[11px]"
                  type="button"
                  :disabled="loading || deciding"
                  @click="clearSelection"
                >
                  Clear Selection
                </button>

                <button
                  type="button"
                  class="ui-btn ui-btn-sm ui-btn-indigo md:h-[34px] md:px-2 md:text-[11px]"
                  :disabled="loading"
                  @click="fetchInbox"
                >
                  <i class="fa-solid fa-rotate-right text-[11px]" />
                  Refresh
                </button>

                <button
                  type="button"
                  class="ui-btn ui-btn-sm ui-btn-indigo md:h-[34px] md:px-2 md:text-[11px]"
                  :disabled="loading || exporting"
                  @click="exportExcel"
                >
                  <i v-if="!exporting" class="fa-solid fa-file-excel text-[11px]" />
                  <i v-else class="fa-solid fa-spinner animate-spin text-[11px]" />
                  Export
                </button>

                <button
                  type="button"
                  class="ui-btn ui-btn-sm ui-btn-ghost md:h-[34px] md:px-2 md:text-[11px]"
                  :disabled="loading"
                  @click="clearFilters"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          <!-- Mobile header -->
          <div v-else class="space-y-3">
            <div>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <span class="ui-badge ui-badge-info">Total: {{ totalCount }}</span>
                <span class="ui-badge ui-badge-info">Showing: {{ displayedCount }} / {{ filteredCount }}</span>
                <span v-if="selectedCount" class="ui-badge ui-badge-success">Selected: {{ selectedCount }}</span>
              </div>
            </div>

            <div class="ui-field">
              <label class="text-[11px] font-extrabold text-white/90">Status</label>
              <select v-model="statusFilter" class="ui-select">
                <option v-for="(label, key) in STATUS_LABEL" :key="key" :value="key">
                  {{ label }}
                </option>
              </select>
            </div>

            <div class="space-y-2">
              <div class="ui-field">
                <label class="text-[11px] font-extrabold text-white/90">Search</label>
                <div class="flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-3 py-2">
                  <i class="fa-solid fa-magnifying-glass text-[12px] text-white/80" />
                  <input
                    v-model="search"
                    type="text"
                    placeholder="Employee / reason / mode..."
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

              <div class="flex flex-wrap items-center justify-between gap-2">
                <button
                  v-if="selectedCount"
                  class="ui-btn ui-btn-sm ui-btn-emerald"
                  type="button"
                  :disabled="loading || deciding"
                  @click="openBulkApprove"
                >
                  <i class="fa-solid fa-circle-check text-[11px]" />
                  Approve Selected ({{ selectedCount }})
                </button>

                <button
                  v-if="selectedCount"
                  class="ui-btn ui-btn-sm ui-btn-ghost"
                  type="button"
                  :disabled="loading || deciding"
                  @click="clearSelection"
                >
                  Clear Selection
                </button>

                <button
                  type="button"
                  class="ui-btn ui-btn-sm ui-btn-indigo"
                  :disabled="loading"
                  @click="fetchInbox"
                >
                  <i class="fa-solid fa-rotate-right text-[11px]" />
                  Refresh
                </button>

                <button
                  type="button"
                  class="ui-btn ui-btn-sm ui-btn-indigo"
                  :disabled="loading || exporting"
                  @click="exportExcel"
                >
                  <i v-if="!exporting" class="fa-solid fa-file-excel text-[11px]" />
                  <i v-else class="fa-solid fa-spinner animate-spin text-[11px]" />
                  Export
                </button>

                <button
                  type="button"
                  class="ui-btn ui-btn-sm ui-btn-ghost"
                  :disabled="loading"
                  @click="clearFilters"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- BODY -->
        <div class="px-2 pb-3 pt-3 sm:px-4 lg:px-6">
          <div v-if="loading && !displayedRows.length" class="ui-skeleton h-14 w-full mb-2" />

          <!-- MOBILE CARDS -->
          <div v-if="isMobile" class="space-y-2">
            <div v-if="!displayedRows.length && !loading" class="ui-frame p-4 text-center text-[12px] text-slate-500">
              No items found.
            </div>

            <article
              v-for="row in displayedRows"
              :key="row._id"
              class="ui-card p-3 cursor-pointer"
              @click="openView(row)"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 space-y-1">
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    Created:
                    <span class="font-extrabold text-slate-900 dark:text-slate-50">
                      {{ fmtDateTime(row.createdAt) }}
                    </span>
                  </div>

                  <div class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50 truncate">
                    {{ row.employeeName || row.name || row.employeeId || '—' }}
                  </div>

                  <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    ID: {{ row.employeeId || '—' }}
                  </div>
                </div>

                <div class="shrink-0 text-right space-y-2" @click.stop>
                  <div class="flex flex-col items-end gap-1">
                    <span :class="modeChipClasses(row.approvalMode)">
                      {{ modeLabel(row.approvalMode) }}
                    </span>
                    <span :class="statusBadgeUiClass(row.status)">
                      {{ STATUS_LABEL[row.status] || row.status }}
                    </span>
                  </div>

                  <label
                    v-if="canDecide(row)"
                    class="mt-2 flex items-center justify-end gap-2 text-[11px] font-extrabold text-slate-700 dark:text-slate-200"
                  >
                    <input
                      type="checkbox"
                      class="coo-check"
                      :checked="isSelected(row)"
                      :disabled="loading || deciding"
                      @change="toggleRowSelection(row)"
                    />
                    Select
                  </label>
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

              <div class="mt-3 flex items-center justify-end gap-2" @click.stop>
                <template v-if="canDecide(row)">
                  <span v-if="isSelected(row)" class="ui-badge ui-badge-success">Selected for approval</span>
                  <span v-else class="text-[11px] text-slate-400">Select to approve</span>

                  <button
                    type="button"
                    class="ui-btn ui-btn-xs ui-btn-rose ui-icon-btn"
                    :disabled="loading || deciding"
                    title="Reject"
                    @click="openReject(row)"
                  >
                    <i class="fa-solid fa-circle-xmark text-[12px]" />
                  </button>
                </template>

                <span v-else class="text-[11px] text-slate-400">—</span>
              </div>
            </article>

            <div ref="lazyAnchor" class="lazy-anchor">
              <div v-if="canLoadMore" class="lazy-loading">
                <i class="fa-solid fa-spinner animate-spin text-[11px]" />
                Loading more... {{ remainingCount }} remaining
              </div>

              <div v-else-if="displayedRows.length" class="lazy-complete">
                All matched records loaded.
              </div>
            </div>
          </div>

          <!-- DESKTOP TABLE -->
          <div v-else class="ui-table-wrap">
            <table class="ui-table table-fixed w-full min-w-[1180px]">
              <colgroup>
                <col :style="{ width: COL_WIDTH.select }" />
                <col :style="{ width: COL_WIDTH.created }" />
                <col :style="{ width: COL_WIDTH.employee }" />
                <col :style="{ width: COL_WIDTH.workDate }" />
                <col :style="{ width: COL_WIDTH.swapDate }" />
                <col :style="{ width: COL_WIDTH.mode }" />
                <col :style="{ width: COL_WIDTH.status }" />
                <col :style="{ width: COL_WIDTH.actions }" />
                <col :style="{ width: COL_WIDTH.reason }" />
              </colgroup>

              <thead>
                <tr>
                  <th class="ui-th text-center">
                    <input
                      v-if="isRealCoo && !isAdminViewer"
                      type="checkbox"
                      class="coo-check"
                      :checked="allDisplayedSelected"
                      :indeterminate.prop="someDisplayedSelected && !allDisplayedSelected"
                      :disabled="!selectableDisplayedRows.length || loading || deciding"
                      title="Select all approvable visible rows"
                      @click.stop
                      @change="toggleSelectVisible"
                    />
                  </th>
                  <th class="ui-th">Created</th>
                  <th class="ui-th">Employee</th>
                  <th class="ui-th">Work Date</th>
                  <th class="ui-th">Swap Date</th>
                  <th class="ui-th">Mode</th>
                  <th class="ui-th">Status</th>
                  <th class="ui-th text-center">Action</th>
                  <th class="ui-th">Reason</th>
                </tr>
              </thead>

              <tbody>
                <tr v-if="!loading && !displayedRows.length">
                  <td colspan="9" class="ui-td py-8 text-slate-500 dark:text-slate-400">
                    No items found.
                  </td>
                </tr>

                <tr
                  v-for="row in displayedRows"
                  :key="row._id"
                  class="ui-tr-hover cursor-pointer"
                  @click="openView(row)"
                >
                  <td class="ui-td text-center" @click.stop>
                    <input
                      v-if="canDecide(row)"
                      type="checkbox"
                      class="coo-check"
                      :checked="isSelected(row)"
                      :disabled="loading || deciding"
                      @change="toggleRowSelection(row)"
                    />
                    <span v-else class="text-[11px] text-slate-400">—</span>
                  </td>

                  <td class="ui-td">
                    <div class="truncate">{{ fmtDateTime(row.createdAt) }}</div>
                  </td>

                  <td class="ui-td">
                    <div class="font-extrabold text-slate-900 dark:text-slate-50 truncate">
                      {{ row.employeeName || row.name || row.employeeId || '—' }}
                    </div>
                    <div class="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                      ID: {{ row.employeeId || '—' }}
                    </div>
                  </td>

                  <td class="ui-td">
                    <div class="truncate">{{ fmtYmd(row.requestStartDate) }} → {{ fmtYmd(row.requestEndDate) }}</div>
                  </td>

                  <td class="ui-td">
                    <div class="truncate">{{ fmtYmd(row.offStartDate) }} → {{ fmtYmd(row.offEndDate) }}</div>
                  </td>

                  <td class="ui-td">
                    <span :class="modeChipClasses(row.approvalMode)">
                      {{ modeLabel(row.approvalMode) }}
                    </span>
                  </td>

                  <td class="ui-td">
                    <span :class="statusBadgeUiClass(row.status)">
                      {{ STATUS_LABEL[row.status] || row.status }}
                    </span>
                  </td>

                  <td class="ui-td text-center" @click.stop>
                    <div class="flex items-center justify-center gap-1">
                      <template v-if="canDecide(row)">
                        <span v-if="isSelected(row)" class="ui-badge ui-badge-success text-[10px]">Selected</span>
                        <span v-else class="text-[10px] text-slate-400">Select first</span>

                        <button
                          type="button"
                          class="ui-btn ui-btn-xs ui-btn-rose ui-icon-btn"
                          :disabled="loading || deciding"
                          title="Reject"
                          @click="openReject(row)"
                        >
                          <i class="fa-solid fa-circle-xmark text-[12px]" />
                        </button>
                      </template>

                      <span v-else class="text-[11px] text-slate-400">—</span>
                    </div>
                  </td>

                  <td class="ui-td">
                    <p class="reason-cell" :title="compactText(row.reason)">
                      {{ row.reason ? compactText(row.reason) : '—' }}
                    </p>
                  </td>
                </tr>

                <tr>
                  <td colspan="9" class="ui-td !p-0">
                    <div ref="lazyAnchor" class="lazy-anchor">
                      <div v-if="canLoadMore" class="lazy-loading">
                        <i class="fa-solid fa-spinner animate-spin text-[11px]" />
                        Loading more... {{ remainingCount }} remaining
                      </div>

                      <div v-else-if="displayedRows.length" class="lazy-complete">
                        All matched records loaded.
                      </div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Lazy footer -->
          <div
            class="mt-3 flex flex-col gap-2 ui-divider pt-3 text-[11px] text-slate-600 dark:text-slate-300 sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="flex flex-wrap items-center gap-2">
              <span class="ui-badge ui-badge-info">Loaded {{ displayedCount }} of {{ filteredCount }}</span>
              <span v-if="remainingCount" class="text-[11px] text-slate-500 dark:text-slate-400">
                Scroll down to load more.
              </span>
              <span v-if="selectedCount" class="ui-badge ui-badge-success">{{ selectedCount }} selected</span>
            </div>

            <div class="flex items-center justify-end gap-1">
              <button
                v-if="canLoadMore"
                type="button"
                class="ui-pagebtn"
                :disabled="loading"
                @click="loadMoreRows"
              >
                Load more
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- DETAILS MODAL -->
    <div v-if="viewOpen" class="ui-modal-backdrop" @click.self="closeView">
      <div class="ui-modal p-0 overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <div class="min-w-0">
            <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Swap Request Details</div>
            <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {{ viewItem?.employeeName || viewItem?.name || '—' }} · {{ fmtDateTime(viewItem?.createdAt) }}
            </div>
          </div>

          <button class="ui-btn ui-btn-ghost ui-btn-xs" type="button" @click="closeView">
            <i class="fa-solid fa-xmark text-[11px]" />
            Close
          </button>
        </div>

        <div class="p-4 space-y-3">
          <div class="ui-frame p-3">
            <div class="grid gap-3 md:grid-cols-2">
              <div>
                <div class="ui-label">Employee</div>
                <div class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                  {{ viewItem?.employeeName || viewItem?.name || '—' }}
                </div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400">
                  ID: {{ viewItem?.employeeId || '—' }}
                </div>
                <div v-if="viewItem?.department" class="text-[11px] text-slate-500 dark:text-slate-400">
                  Dept: {{ viewItem.department }}
                </div>
              </div>

              <div class="text-right md:text-left">
                <div class="ui-label">Status</div>
                <span :class="statusBadgeUiClass(viewItem?.status)">
                  {{ STATUS_LABEL[viewItem?.status] || viewItem?.status }}
                </span>

                <div class="ui-label mt-3">Approval Mode</div>
                <span :class="modeChipClasses(viewItem?.approvalMode)">
                  {{ modeLabel(viewItem?.approvalMode) }}
                </span>
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
            <div class="mt-1 text-[12px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
              {{ viewItem?.reason || '—' }}
            </div>
          </div>

          <div v-if="up(viewItem?.status) === 'REJECTED'" class="ui-card p-3">
            <div class="ui-section-title text-rose-600 dark:text-rose-400">Rejected Reason</div>
            <div class="mt-1 text-[12px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
              {{ getRejectedReason(viewItem) }}
            </div>
          </div>

          <div class="flex justify-end gap-2 pt-1">
            <button class="ui-btn ui-btn-ghost" type="button" @click="closeView">Close</button>

            <template v-if="canDecide(viewItem)">
              <button
                class="ui-btn ui-btn-soft"
                type="button"
                :disabled="loading || deciding"
                @click="toggleRowSelection(viewItem)"
              >
                <i class="fa-solid fa-check-square text-[11px]" />
                {{ isSelected(viewItem) ? 'Unselect from Approval' : 'Select for Approval' }}
              </button>

              <button
                class="ui-btn ui-btn-rose"
                type="button"
                :disabled="loading || deciding"
                @click="openReject(viewItem)"
              >
                Reject
              </button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- REJECT MODAL -->
    <div v-if="rejectOpen" class="ui-modal-backdrop">
      <div class="ui-modal p-4">
        <div class="flex items-start gap-3">
          <div
            class="grid h-10 w-10 place-items-center rounded-2xl border"
            style="border-color: rgb(var(--ui-danger) / 0.25); background: rgb(var(--ui-danger) / 0.10); color: rgb(var(--ui-danger));"
          >
            <i class="fa-solid fa-xmark" />
          </div>

          <div class="flex-1">
            <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">
              Reject this request?
            </div>

            <div class="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
              Employee:
              <span class="font-extrabold">{{ rejectTarget?.employeeName || rejectTarget?.name || '—' }}</span>
            </div>
          </div>
        </div>

        <div class="mt-3 ui-field">
          <textarea
            v-model="rejectNote"
            rows="3"
            class="ui-textarea"
            placeholder="Please type the reason for rejection..."
          />
        </div>

        <div class="mt-4 flex justify-end gap-2">
          <button type="button" class="ui-btn ui-btn-ghost" :disabled="rejectBusy" @click="closeReject()">
            Close
          </button>

          <button type="button" class="ui-btn ui-btn-rose" :disabled="rejectBusy" @click="confirmReject">
            <i v-if="rejectBusy" class="fa-solid fa-spinner animate-spin text-[11px]" />
            Reject
          </button>
        </div>
      </div>
    </div>

    <!-- BULK APPROVE MODAL -->
    <div v-if="bulkApproveOpen" class="ui-modal-backdrop">
      <div class="ui-modal p-4">
        <div class="flex items-start gap-3">
          <div
            class="grid h-10 w-10 place-items-center rounded-2xl border"
            style="border-color: rgb(var(--ui-success) / 0.25); background: rgb(var(--ui-success) / 0.10); color: rgb(var(--ui-success));"
          >
            <i class="fa-solid fa-check" />
          </div>

          <div class="flex-1">
            <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">
              Approve selected requests?
            </div>

            <div class="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
              You selected <span class="font-extrabold">{{ selectedCount }}</span> pending COO request(s).
            </div>
          </div>
        </div>

        <div class="mt-3 max-h-48 overflow-auto rounded-2xl border border-slate-200 dark:border-slate-800">
          <div
            v-for="row in selectedRows"
            :key="'bulk-' + row._id"
            class="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-[11px] last:border-b-0 dark:border-slate-800"
          >
            <div class="min-w-0">
              <div class="truncate font-extrabold text-slate-900 dark:text-slate-50">
                {{ row.employeeName || row.name || row.employeeId || '—' }}
              </div>
              <div class="truncate text-slate-500 dark:text-slate-400">
                {{ fmtYmd(row.requestStartDate) }} → {{ fmtYmd(row.requestEndDate) }}
              </div>
            </div>

            <span :class="statusBadgeUiClass(row.status)">
              {{ STATUS_LABEL[row.status] || row.status }}
            </span>
          </div>
        </div>

        <div class="mt-3 ui-field">
          <textarea
            v-model="bulkApproveNote"
            rows="3"
            class="ui-textarea"
            placeholder="Add a short note for employees (optional)..."
          />
        </div>

        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="ui-btn ui-btn-ghost"
            :disabled="bulkApproveBusy"
            @click="closeBulkApprove()"
          >
            Close
          </button>

          <button
            type="button"
            class="ui-btn ui-btn-emerald"
            :disabled="bulkApproveBusy || !selectedCount"
            @click="confirmBulkApprove"
          >
            <i v-if="bulkApproveBusy" class="fa-solid fa-spinner animate-spin text-[11px]" />
            Approve {{ selectedCount }} Selected
          </button>
        </div>
      </div>
    </div>
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

.coo-check {
  width: 15px;
  height: 15px;
  border-radius: 0.35rem;
  cursor: pointer;
  accent-color: rgb(var(--ui-success));
}

.coo-check:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.lazy-anchor {
  min-height: 34px;
}

.lazy-loading,
.lazy-complete {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.75rem 0.5rem;
  font-size: 11px;
  color: rgb(100 116 139);
}

:global(.dark) .lazy-loading,
:global(.dark) .lazy-complete {
  color: rgb(148 163 184);
}
</style>