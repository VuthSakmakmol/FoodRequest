<!-- src/views/expat/coo/forgetScan/CooForgetScanInbox.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/store/auth'
import socket, { subscribeRoleIfNeeded, subscribeEmployeeIfNeeded, subscribeUserIfNeeded } from '@/utils/socket'
import * as XLSX from 'xlsx'

defineOptions({ name: 'CooForgetScanInbox' })

const { showToast } = useToast()
const auth = useAuth()

const roles = computed(() => {
  const raw = Array.isArray(auth.user?.roles) ? auth.user.roles : []
  const base = auth.user?.role ? [auth.user.role] : []
  return [...new Set([...raw, ...base].map((r) => String(r || '').toUpperCase().trim()))].filter(Boolean)
})

const canCooDecide = computed(() =>
  roles.value.includes('LEAVE_COO') || roles.value.includes('COO') || roles.value.includes('LEAVE_COO_APPROVER')
)

function myActorIds() {
  const loginId = String(auth.user?.loginId || auth.user?.id || auth.user?.sub || '').trim()
  const employeeId = String(auth.user?.employeeId || auth.user?.empId || '').trim()
  return [...new Set([loginId, employeeId].filter(Boolean))]
}

/* ───────────────── responsive ───────────────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────────────── state ───────────────── */
const loading = ref(false)
const loadingMore = ref(false)
const rows = ref([])
const hasMore = ref(true)
const page = ref(1)
const limit = ref(20)

const search = ref('')
const statusFilter = ref('ALL')
const fromDate = ref('')
const toDate = ref('')

const bottomSentinel = ref(null)
let bottomObserver = null
let refreshTimer = null
let searchTimer = null

const viewOpen = ref(false)
const viewItem = ref(null)

const rejectOpen = ref(false)
const rejectBusy = ref(false)
const rejectTarget = ref(null)
const rejectNote = ref('')

const bulkApproveOpen = ref(false)
const bulkApproveBusy = ref(false)
const bulkApproveNote = ref('')

const exporting = ref(false)
const selectedIds = ref([])

/* ───────────────── constants ───────────────── */
const STATUS_LABEL = {
  ALL: 'All',
  PENDING_MANAGER: 'Pending (Mgr)',
  PENDING_GM: 'Pending (GM)',
  PENDING_COO: 'Pending (COO)',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
}

const TYPE_LABEL = {
  FORGET_IN: 'Forget IN',
  FORGET_OUT: 'Forget OUT',
  FORGET_IN_OUT: 'Forget IN & OUT',
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

function typeBadgeUiClass(x) {
  const t = up(x)
  if (t === 'FORGET_OUT') return 'ui-badge ui-badge-indigo'
  return 'ui-badge ui-badge-info'
}

function modeBadgeUiClass(mode) {
  const m = up(mode)
  if (m === 'MANAGER_AND_COO' || m === 'GM_AND_COO' || m === 'COO_ONLY') return 'ui-badge ui-badge-indigo'
  if (m === 'MANAGER_ONLY' || m === 'GM_ONLY') return 'ui-badge ui-badge-success'
  return 'ui-badge ui-badge-info'
}

function modeLabel(mode) {
  const m = up(mode)
  if (m === 'MANAGER_AND_COO') return 'Manager + COO'
  if (m === 'GM_AND_COO') return 'GM + COO'
  if (m === 'COO_ONLY') return 'COO only'
  if (m === 'MANAGER_ONLY') return 'Manager only'
  if (m === 'GM_ONLY') return 'GM only'
  if (m === 'MANAGER_AND_GM') return 'Manager + GM'
  return m || '—'
}

/* ───────────────── type helpers ───────────────── */
function getTypesArray(row) {
  const arr = Array.isArray(row?.forgotTypes) ? row.forgotTypes : []
  if (arr.length) return arr.map((x) => up(x)).filter(Boolean)

  const legacy = up(row?.forgotType)
  return legacy ? [legacy] : []
}

function getTypeKey(row) {
  const key = up(row?.forgotKey)
  if (key) return key

  const arr = getTypesArray(row)
  const hasIn = arr.includes('FORGET_IN')
  const hasOut = arr.includes('FORGET_OUT')

  if (hasIn && hasOut) return 'FORGET_IN_OUT'
  if (hasIn) return 'FORGET_IN'
  if (hasOut) return 'FORGET_OUT'
  return ''
}

function getTypeBadges(row) {
  const key = getTypeKey(row)
  const types = getTypesArray(row)

  if (key === 'FORGET_IN_OUT') {
    return [{ key: 'FORGET_IN_OUT', label: TYPE_LABEL.FORGET_IN_OUT, cls: 'ui-badge ui-badge-info' }]
  }

  const t = types[0] || key
  if (!t) return []

  return [{ key: t, label: TYPE_LABEL[t] || t, cls: typeBadgeUiClass(t) }]
}

/* ───────────────── permission ───────────────── */
function canDecide(row) {
  if (!canCooDecide.value) return false
  if (up(row?.status) !== 'PENDING_COO') return false

  const assigned = s(row?.cooLoginId)
  if (!assigned) return false

  return myActorIds().includes(assigned)
}

/* ───────────────── text helpers ───────────────── */
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

function isWithinDateRange(forgotDate) {
  const d = s(forgotDate)
  if (!d) return !fromDate.value && !toDate.value
  if (fromDate.value && d < fromDate.value) return false
  if (toDate.value && d > toDate.value) return false
  return true
}

function dedupeById(list = []) {
  const map = new Map()
  for (const item of list) {
    const id = s(item?._id)
    if (!id) continue
    map.set(id, item)
  }
  return Array.from(map.values())
}

/* ───────────────── fetch lazy ───────────────── */
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
      scope: 'ALL',
      page: page.value,
      limit: limit.value,
      keyword: search.value || '',
      search: search.value || '',
      status: statusFilter.value || 'ALL',
      fromDate: fromDate.value || '',
      toDate: toDate.value || '',
    }

    const res = await api.get('/leave/forget-scan/coo/inbox', { params })
    const payload = res?.data

    const items = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.items)
        ? payload.items
        : []

    const normalized = items.map((r) => ({
      ...r,
      approvals: Array.isArray(r.approvals) ? r.approvals : [],
    }))

    if (reset) {
      rows.value = normalized
    } else {
      rows.value = dedupeById([...rows.value, ...normalized])
    }

    if (Array.isArray(payload)) {
      hasMore.value = false
    } else {
      hasMore.value = !!payload?.hasMore
    }

    if (normalized.length > 0) page.value += 1

    pruneSelection()
  } catch (e) {
    console.error('fetchInbox error', e)
    if (!silent) {
      showToast({
        type: 'error',
        message: e?.response?.data?.message || 'Failed to load COO forget scan inbox',
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

/* ───────────────── filter ───────────────── */
const filteredRows = computed(() => {
  let list = [...rows.value]

  if (fromDate.value || toDate.value) {
    list = list.filter((r) => isWithinDateRange(r?.forgotDate))
  }

  if (statusFilter.value !== 'ALL') {
    list = list.filter((r) => up(r.status) === up(statusFilter.value))
  }

  const q = search.value.trim().toLowerCase()
  if (q) {
    list = list.filter((r) => {
      const types = getTypesArray(r).join(' ')
      const hay = [
        r.employeeId,
        r.employeeName,
        r.name,
        r.department,
        r.reason,
        r.status,
        r.forgotDate,
        r.forgotKey,
        types,
        r.approvalMode,
        modeLabel(r.approvalMode),
        r.managerLoginId,
        r.gmLoginId,
        r.cooLoginId,
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

/* ───────────────── selection ───────────────── */
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

const selectableRows = computed(() => filteredRows.value.filter((r) => canDecide(r)))

const selectedRows = computed(() => {
  const ids = new Set(selectedIds.value)
  return filteredRows.value.filter((r) => ids.has(rowKey(r)) && canDecide(r))
})

const selectedCount = computed(() => selectedRows.value.length)

const allVisibleSelected = computed(() => {
  if (!selectableRows.value.length) return false
  return selectableRows.value.every((r) => isSelected(r))
})

const someVisibleSelected = computed(() => {
  if (!selectableRows.value.length) return false
  return selectableRows.value.some((r) => isSelected(r))
})

function toggleSelectVisible() {
  const ids = selectableRows.value.map(rowKey).filter(Boolean)

  if (!ids.length) return

  if (allVisibleSelected.value) {
    const visibleSet = new Set(ids)
    setSelectedIds(selectedIds.value.filter((id) => !visibleSet.has(id)))
    return
  }

  setSelectedIds([...selectedIds.value, ...ids])
}

function pruneSelection() {
  const validIds = new Set(filteredRows.value.filter((r) => canDecide(r)).map(rowKey).filter(Boolean))
  setSelectedIds(selectedIds.value.filter((id) => validIds.has(id)))
}

watch(filteredRows, () => {
  pruneSelection()
})

/* ───────────────── details ───────────────── */
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
    pruneSelection()

    if (!viewOpen.value || !viewItem.value?._id) return

    const found = (list || []).find((x) => String(x._id) === String(viewItem.value._id))
    if (found) viewItem.value = found
  }
)

/* ───────────────── reject ───────────────── */
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

  try {
    await api.post(`/leave/forget-scan/${row._id}/coo-decision`, {
      action: 'REJECT',
      note,
      comment: note,
      reason: note,
    })

    showToast({ type: 'success', message: 'Rejected.' })

    closeReject(true)
    closeView()

    await resetAndFetch({ silent: true })
  } catch (e) {
    console.error('confirmReject error', e)
    showToast({ type: 'error', message: e?.response?.data?.message || 'Decision failed' })
  } finally {
    rejectBusy.value = false
  }
}

/* ───────────────── bulk approve ───────────────── */
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
  const targets = [...selectedRows.value]

  if (!targets.length) {
    showToast({ type: 'warning', message: 'No selected request can be approved.' })
    closeBulkApprove(true)
    return
  }

  bulkApproveBusy.value = true

  let successCount = 0
  let failCount = 0
  const note = s(bulkApproveNote.value)

  try {
    for (const row of targets) {
      try {
        if (!canDecide(row)) {
          failCount += 1
          continue
        }

        await api.post(`/leave/forget-scan/${row._id}/coo-decision`, {
          action: 'APPROVE',
          note,
          comment: note,
          reason: note,
        })

        successCount += 1
      } catch (e) {
        failCount += 1
        console.error('bulk approve item failed', row?._id, e)
      }
    }

    if (successCount && !failCount) {
      showToast({ type: 'success', message: `Approved ${successCount} request(s).` })
    } else if (successCount && failCount) {
      showToast({
        type: 'warning',
        message: `Approved ${successCount}, failed ${failCount}. Please refresh and check remaining items.`,
      })
    } else {
      showToast({ type: 'error', message: 'No request was approved.' })
    }

    closeBulkApprove(true)
    clearSelection()
    closeView()

    await resetAndFetch({ silent: true })
  } finally {
    bulkApproveBusy.value = false
  }
}

/* ───────────────── export ───────────────── */
function buildExcelRows(list) {
  return (list || []).map((r, idx) => {
    const key = getTypeKey(r)
    const types = getTypesArray(r)

    return {
      No: idx + 1,
      CreatedAt: r.createdAt ? dayjs(r.createdAt).format('DD/MM/YYYY HH:mm') : '',
      EmployeeID: r.employeeId || '',
      EmployeeName: r.employeeName || r.name || '',
      Department: r.department || '',
      ForgotDate: r.forgotDate ? dayjs(r.forgotDate).format('DD/MM/YYYY') : '',
      ForgotKey: key || r.forgotKey || '',
      ForgotTypes: types.map((t) => TYPE_LABEL[t] || t).join(', '),
      ApprovalMode: modeLabel(r.approvalMode),
      Status: r.status || '',
      Reason: compactText(r.reason),
      Manager: r.managerLoginId || '',
      GM: r.gmLoginId || '',
      COO: r.cooLoginId || '',
      RejectedReason: up(r.status) === 'REJECTED' ? getRejectedReason(r) : '',
    }
  })
}

async function exportExcel() {
  try {
    exporting.value = true

    const params = {
      scope: 'ALL',
      exportAll: 1,
      page: 1,
      limit: 100000,
      keyword: search.value || '',
      search: search.value || '',
      status: statusFilter.value || 'ALL',
      fromDate: fromDate.value || '',
      toDate: toDate.value || '',
    }

    const res = await api.get('/leave/forget-scan/coo/inbox', { params })
    const payload = res?.data

    const list = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.items)
        ? payload.items
        : filteredRows.value

    const data = buildExcelRows(list)

    if (!data.length) {
      showToast({ type: 'warning', message: 'No data to export.' })
      return
    }

    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()

    XLSX.utils.book_append_sheet(wb, ws, 'CooInbox')

    const filename = `ForgetScan_COO_Inbox_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`
    XLSX.writeFile(wb, filename)

    showToast({ type: 'success', message: 'Excel exported.' })
  } catch (e) {
    console.error('exportExcel error', e)
    showToast({ type: 'error', message: e?.message || 'Export failed.' })
  } finally {
    exporting.value = false
  }
}

/* ───────────────── realtime ───────────────── */
function triggerRealtimeRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => resetAndFetch({ silent: true }), 180)
}

function onReqCreated() {
  triggerRealtimeRefresh()
}

function onReqUpdated() {
  triggerRealtimeRefresh()
}

/* ───────────────── lazy scroll ───────────────── */
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

/* ───────────────── filters ───────────────── */
function clearFilters() {
  search.value = ''
  statusFilter.value = 'ALL'
  fromDate.value = ''
  toDate.value = ''
  clearSelection()
  resetAndFetch()
}

watch(
  () => [statusFilter.value, fromDate.value, toDate.value],
  () => {
    clearSelection()
    resetAndFetch()
  }
)

watch(
  () => search.value,
  () => {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      clearSelection()
      resetAndFetch()
    }, 300)
  }
)

/* ───────────────── modal UX ───────────────── */
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

/* ───────────────── lifecycle ───────────────── */
onMounted(async () => {
  updateIsMobile()

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateIsMobile)
    window.addEventListener('keydown', onKeydown)
  }

  try {
    subscribeRoleIfNeeded({ role: 'LEAVE_COO' })
    subscribeRoleIfNeeded({ role: 'LEAVE_COO_APPROVER' })

    const empId = String(auth.user?.employeeId || auth.user?.empId || '').trim()
    const loginId = String(auth.user?.loginId || auth.user?.id || auth.user?.sub || '').trim()

    if (empId) await subscribeEmployeeIfNeeded(empId)
    if (loginId) await subscribeUserIfNeeded(loginId)
  } catch {}

  await resetAndFetch({ silent: true })

  socket.on('forgetscan:req:created', onReqCreated)
  socket.on('forgetscan:req:updated', onReqUpdated)
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateIsMobile)
    window.removeEventListener('keydown', onKeydown)
  }

  if (refreshTimer) clearTimeout(refreshTimer)
  if (searchTimer) clearTimeout(searchTimer)

  destroyInfiniteScroll()

  socket.off('forgetscan:req:created', onReqCreated)
  socket.off('forgetscan:req:updated', onReqUpdated)

  lockBodyScroll(false)
})
</script>

<template>
  <div class="ui-page min-h-screen w-full">
    <div class="w-full">
      <div class="ui-card rounded-none border-x-0 border-t-0">
        <div class="ui-hero-gradient">
          <!-- Desktop header -->
          <div v-if="!isMobile" class="flex flex-wrap items-end justify-between gap-4">
            <div class="flex flex-col gap-1 min-w-[240px]">
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <span class="ui-badge ui-badge-info">Loaded: {{ totalCount }}</span>
                <span class="ui-badge ui-badge-info">Showing: {{ filteredCount }}</span>
                <span v-if="selectedCount" class="ui-badge ui-badge-success">
                  Selected:
                  <span class="text-[14px] font-black">{{ selectedCount }}</span>
                </span>
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
                    <option v-for="(label, k) in STATUS_LABEL" :key="k" :value="k">
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
                      placeholder="Employee / type / reason..."
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
                  class="ui-btn ui-btn-sm coo-approve-btn md:h-[34px] md:px-2 md:text-[11px]"
                  type="button"
                  :disabled="loading || loadingMore || bulkApproveBusy"
                  @click="openBulkApprove"
                >
                  <i class="fa-solid fa-circle-check text-[11px]" />
                  Approve Selected
                  <span class="ml-1 text-[14px] font-black">({{ selectedCount }})</span>
                </button>

                <button
                  v-if="selectedCount"
                  class="ui-btn ui-btn-sm ui-btn-ghost md:h-[34px] md:px-2 md:text-[11px]"
                  type="button"
                  :disabled="loading || loadingMore || bulkApproveBusy"
                  @click="clearSelection"
                >
                  Clear Selection
                </button>

                <button
                  class="ui-btn ui-btn-sm ui-btn-indigo md:h-[34px] md:px-2 md:text-[11px]"
                  type="button"
                  :disabled="loading"
                  @click="resetAndFetch()"
                >
                  <i class="fa-solid fa-rotate-right text-[11px]" />
                  Refresh
                </button>

                <button
                  class="ui-btn ui-btn-sm ui-btn-indigo md:h-[34px] md:px-2 md:text-[11px]"
                  type="button"
                  :disabled="loading || exporting"
                  @click="exportExcel"
                >
                  <i v-if="!exporting" class="fa-solid fa-file-excel text-[11px]" />
                  <i v-else class="fa-solid fa-spinner animate-spin text-[11px]" />
                  Export
                </button>

                <button
                  class="ui-btn ui-btn-sm ui-btn-ghost md:h-[34px] md:px-2 md:text-[11px]"
                  type="button"
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
                <span class="ui-badge ui-badge-info">Loaded: {{ totalCount }}</span>
                <span class="ui-badge ui-badge-info">Showing: {{ filteredCount }}</span>
                <span v-if="selectedCount" class="ui-badge ui-badge-success">
                  Selected:
                  <span class="text-[14px] font-black">{{ selectedCount }}</span>
                </span>
              </div>
            </div>

            <div class="ui-field">
              <label class="text-[11px] font-extrabold text-white/90">Status</label>
              <select v-model="statusFilter" class="ui-select">
                <option v-for="(label, k) in STATUS_LABEL" :key="k" :value="k">
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

              <div class="flex flex-wrap items-center justify-between gap-2">
                <button
                  v-if="selectedCount"
                  class="ui-btn ui-btn-sm coo-approve-btn"
                  type="button"
                  :disabled="loading || loadingMore || bulkApproveBusy"
                  @click="openBulkApprove"
                >
                  <i class="fa-solid fa-circle-check text-[11px]" />
                  Approve Selected
                  <span class="ml-1 text-[14px] font-black">({{ selectedCount }})</span>
                </button>

                <button
                  v-if="selectedCount"
                  class="ui-btn ui-btn-sm ui-btn-ghost"
                  type="button"
                  :disabled="loading || loadingMore || bulkApproveBusy"
                  @click="clearSelection"
                >
                  Clear Selection
                </button>

                <button class="ui-btn ui-btn-sm ui-btn-indigo" type="button" :disabled="loading || exporting" @click="exportExcel">
                  <i v-if="!exporting" class="fa-solid fa-file-excel text-[11px]" />
                  <i v-else class="fa-solid fa-spinner animate-spin text-[11px]" />
                  Export
                </button>

                <button class="ui-btn ui-btn-sm ui-btn-ghost" type="button" :disabled="loading" @click="clearFilters">
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="px-2 pb-3 pt-3 sm:px-4 lg:px-6">
          <div v-if="isMobile && selectedCount" class="mobile-approval-sticky">
            <div class="mobile-approval-sticky__inner">
              <div class="min-w-0">
                <p class="text-[11px] font-extrabold text-emerald-900 dark:text-emerald-50">
                  <span class="text-[18px] font-black">{{ selectedCount }}</span>
                  selected
                </p>
              </div>

              <div class="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  class="ui-btn ui-btn-sm coo-approve-btn mobile-approval-sticky__button"
                  :disabled="loading || loadingMore || bulkApproveBusy"
                  @click="openBulkApprove"
                >
                  <i class="fa-solid fa-circle-check text-[11px]" />
                  Approve
                </button>

                <button
                  type="button"
                  class="ui-btn ui-btn-sm ui-btn-ghost mobile-approval-sticky__clear"
                  :disabled="loading || loadingMore || bulkApproveBusy"
                  @click="clearSelection"
                  aria-label="Clear selection"
                  title="Clear selection"
                >
                  <i class="fa-solid fa-xmark text-[11px]" />
                </button>
              </div>
            </div>
          </div>

          <div v-if="loading && !filteredRows.length" class="ui-skeleton h-14 w-full mb-2" />

          <!-- Mobile cards -->
          <div v-if="isMobile" class="space-y-2">
            <div v-if="!filteredRows.length && !loading" class="ui-frame p-4 text-center text-[12px] text-slate-500 dark:text-slate-400">
              No items found.
            </div>

            <article v-for="row in filteredRows" :key="row._id" class="ui-card p-3 cursor-pointer" @click="openView(row)">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 space-y-1">
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    Created:
                    <span class="font-extrabold text-slate-900 dark:text-slate-50">{{ fmtDateTime(row.createdAt) }}</span>
                  </div>

                  <div class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50 truncate">
                    {{ row.employeeName || row.name || row.employeeId || '—' }}
                  </div>

                  <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    ID: {{ row.employeeId || '—' }}
                  </div>

                  <div class="mt-1">
                    <span :class="modeBadgeUiClass(row.approvalMode)">{{ modeLabel(row.approvalMode) }}</span>
                  </div>

                  <div class="text-[11px] text-slate-600 dark:text-slate-300">
                    Forgot:
                    <span class="font-extrabold">{{ fmtYmd(row.forgotDate) }}</span>
                    •
                    <span v-for="b in getTypeBadges(row)" :key="row._id + '-mb-' + b.key" :class="b.cls">
                      {{ b.label }}
                    </span>
                  </div>
                </div>

                <div class="shrink-0 text-right space-y-2" @click.stop>
                  <span :class="statusBadgeUiClass(row.status)">
                    {{ STATUS_LABEL[row.status] || row.status }}
                  </span>

                  <label
                    v-if="canDecide(row)"
                    class="mt-2 flex items-center justify-end gap-2 text-[11px] font-extrabold text-slate-700 dark:text-slate-200"
                  >
                    <input
                      type="checkbox"
                      class="coo-check"
                      :checked="isSelected(row)"
                      :disabled="loading || loadingMore || bulkApproveBusy"
                      @change="toggleRowSelection(row)"
                    />
                    Select
                  </label>
                </div>
              </div>

              <div class="mt-2 ui-frame p-2 text-[11px] text-slate-600 dark:text-slate-300">
                <div class="font-extrabold text-slate-700 dark:text-slate-200">Reason</div>
                <div class="mt-0.5">{{ briefReason(row.reason, 140) }}</div>
              </div>

              <div class="mt-3 flex items-center justify-end gap-2" @click.stop>
                <template v-if="canDecide(row)">
                  <span v-if="isSelected(row)" class="ui-badge ui-badge-success">Selected for approval</span>
                  <span v-else class="text-[11px] text-slate-400">Select to approve</span>

                  <button
                    type="button"
                    class="ui-btn ui-btn-xs ui-btn-rose ui-icon-btn"
                    :disabled="loading || rejectBusy"
                    @click="openReject(row)"
                    title="Reject"
                    aria-label="Reject"
                  >
                    <i class="fa-solid fa-circle-xmark text-[12px]" />
                  </button>
                </template>

                <span v-else class="text-[11px] text-slate-400">—</span>
              </div>
            </article>

            <div
              v-if="loadingMore"
              class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-center text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            >
              Loading more...
            </div>

            <div v-if="!hasMore && rows.length" class="py-2 text-center text-[11px] text-slate-400">
              End of list
            </div>

            <div ref="bottomSentinel" class="h-2 w-full" />
          </div>

          <!-- Desktop table -->
          <div v-else class="ui-table-wrap">
            <table class="ui-table table-fixed w-full min-w-[1290px]">
              <colgroup>
                <col style="width: 54px" />
                <col style="width: 140px" />
                <col style="width: 250px" />
                <col style="width: 140px" />
                <col style="width: 200px" />
                <col style="width: 150px" />
                <col style="width: 150px" />
                <col style="width: 130px" />
                <col />
              </colgroup>

              <thead>
                <tr>
                  <th class="ui-th text-center">
                    <input
                      type="checkbox"
                      class="coo-check"
                      :checked="allVisibleSelected"
                      :indeterminate.prop="someVisibleSelected && !allVisibleSelected"
                      :disabled="!selectableRows.length || loading || loadingMore || bulkApproveBusy"
                      title="Select all approvable loaded rows"
                      @click.stop
                      @change="toggleSelectVisible"
                    />
                  </th>
                  <th class="ui-th">Created</th>
                  <th class="ui-th">Employee</th>
                  <th class="ui-th">Forgot Date</th>
                  <th class="ui-th text-center">Type</th>
                  <th class="ui-th">Mode</th>
                  <th class="ui-th">Status</th>
                  <th class="ui-th text-center">Action</th>
                  <th class="ui-th">Reason</th>
                </tr>
              </thead>

              <tbody>
                <tr v-if="!loading && !filteredRows.length">
                  <td colspan="9" class="ui-td py-8 text-slate-500 dark:text-slate-400">
                    No items found.
                  </td>
                </tr>

                <tr v-for="row in filteredRows" :key="row._id" class="ui-tr-hover cursor-pointer" @click="openView(row)">
                  <td class="ui-td text-center" @click.stop>
                    <input
                      v-if="canDecide(row)"
                      type="checkbox"
                      class="coo-check"
                      :checked="isSelected(row)"
                      :disabled="loading || loadingMore || bulkApproveBusy"
                      title="Select for bulk approval"
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
                    <div class="truncate">{{ fmtYmd(row.forgotDate) }}</div>
                  </td>

                  <td class="ui-td text-center">
                    <div class="flex flex-wrap items-center justify-center gap-1">
                      <span v-for="b in getTypeBadges(row)" :key="row._id + '-tb-' + b.key" :class="b.cls">
                        {{ b.label }}
                      </span>
                      <span v-if="!getTypeBadges(row).length" class="text-[11px] text-slate-400">—</span>
                    </div>
                  </td>

                  <td class="ui-td">
                    <span :class="modeBadgeUiClass(row.approvalMode)">
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
                          :disabled="loading || rejectBusy"
                          @click="openReject(row)"
                          title="Reject"
                          aria-label="Reject"
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
              </tbody>
            </table>

            <div
              v-if="loadingMore"
              class="border-t border-slate-200 px-3 py-2 text-center text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-300"
            >
              Loading more...
            </div>

            <div v-if="!hasMore && rows.length" class="border-t border-slate-200 px-3 py-2 text-center text-[11px] text-slate-400 dark:border-slate-700">
              End of list
            </div>

            <div ref="bottomSentinel" class="h-2 w-full" />
          </div>
        </div>
      </div>
    </div>

    <!-- DETAILS MODAL -->
    <div v-if="viewOpen" class="ui-modal-backdrop" @click.self="closeView">
      <div class="ui-modal p-0 overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <div class="min-w-0">
            <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Forget Scan Details</div>
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
                <div class="text-[11px] text-slate-500 dark:text-slate-400">ID: {{ viewItem?.employeeId || '—' }}</div>
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
                <span :class="modeBadgeUiClass(viewItem?.approvalMode)">
                  {{ modeLabel(viewItem?.approvalMode) }}
                </span>
              </div>
            </div>
          </div>

          <div class="grid gap-3 md:grid-cols-2">
            <div class="ui-card p-3">
              <div class="ui-section-title">Forgot Date</div>
              <div class="mt-1 text-[12px] text-slate-700 dark:text-slate-200">
                {{ fmtYmd(viewItem?.forgotDate) }}
              </div>
            </div>

            <div class="ui-card p-3">
              <div class="ui-section-title">Type</div>
              <div class="mt-2 flex flex-wrap items-center gap-1">
                <span v-for="b in getTypeBadges(viewItem)" :key="String(viewItem?._id || 'x') + '-db-' + b.key" :class="b.cls">
                  {{ b.label }}
                </span>
                <span v-if="!getTypeBadges(viewItem).length" class="text-[11px] text-slate-400">—</span>
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

          <div class="flex flex-wrap justify-end gap-2 pt-1">
            <button class="ui-btn ui-btn-ghost" type="button" @click="closeView">Close</button>

            <template v-if="canDecide(viewItem)">
              <button
                class="ui-btn ui-btn-soft"
                type="button"
                :disabled="loading || loadingMore || bulkApproveBusy"
                @click="toggleRowSelection(viewItem)"
              >
                <i class="fa-solid fa-check-square text-[11px]" />
                {{ isSelected(viewItem) ? 'Unselect from Approval' : 'Select for Approval' }}
              </button>

              <button class="ui-btn ui-btn-rose" type="button" :disabled="loading || rejectBusy" @click="openReject(viewItem)">
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
              <span class="ml-1 text-slate-500">({{ rejectTarget?.employeeId || '—' }})</span>
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
          <button type="button" class="ui-btn ui-btn-ghost" :disabled="rejectBusy" @click="closeReject()">Close</button>

          <button
            type="button"
            class="ui-btn ui-btn-rose"
            :disabled="rejectBusy"
            @click="confirmReject"
          >
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
              You selected <span class="text-[18px] font-black">{{ selectedCount }}</span> pending COO request(s).
            </div>
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
          <button type="button" class="ui-btn ui-btn-ghost" :disabled="bulkApproveBusy" @click="closeBulkApprove()">Close</button>

          <button
            type="button"
            class="ui-btn coo-approve-btn"
            :disabled="bulkApproveBusy || !selectedCount"
            @click="confirmBulkApprove"
          >
            <i v-if="bulkApproveBusy" class="fa-solid fa-spinner animate-spin text-[11px]" />
            Approve
            <span class="mx-1 text-[14px] font-black">{{ selectedCount }}</span>
            Selected
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

.coo-approve-btn {
  border-color: rgb(16 185 129) !important;
  background: linear-gradient(135deg, rgb(16 185 129), rgb(5 150 105)) !important;
  color: #ffffff !important;
  box-shadow: 0 10px 22px rgba(16, 185, 129, 0.28) !important;
}

.coo-approve-btn:hover:not(:disabled) {
  border-color: rgb(5 150 105) !important;
  background: linear-gradient(135deg, rgb(5 150 105), rgb(4 120 87)) !important;
  transform: translateY(-1px);
}

.coo-approve-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
  transform: none !important;
  box-shadow: none !important;
}

.mobile-approval-sticky {
  position: sticky;
  top: 0;
  z-index: 55;
  margin: -0.75rem -0.5rem 0.75rem;
  padding: 0.5rem;
  background: linear-gradient(180deg, rgba(248, 250, 252, 0.98), rgba(248, 250, 252, 0.84));
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

:global(.dark) .mobile-approval-sticky {
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.84));
}

.mobile-approval-sticky__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border: 1px solid rgba(16, 185, 129, 0.28);
  border-radius: 1rem;
  background: rgba(236, 253, 245, 0.96);
  padding: 0.65rem 0.7rem;
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.12);
}

:global(.dark) .mobile-approval-sticky__inner {
  border-color: rgba(52, 211, 153, 0.28);
  background: rgba(6, 78, 59, 0.82);
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.28);
}

.mobile-approval-sticky__button {
  min-height: 36px;
  padding-left: 0.85rem !important;
  padding-right: 0.85rem !important;
  white-space: nowrap;
}

.mobile-approval-sticky__clear {
  min-height: 36px;
  min-width: 36px;
  padding-left: 0.65rem !important;
  padding-right: 0.65rem !important;
}

</style>