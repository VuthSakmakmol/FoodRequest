<!-- src/views/expat/admin/swap-day/SwapDayReport.vue -->
<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import * as XLSX from 'xlsx'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/store/auth'
import socket, { subscribeRoleIfNeeded, subscribeEmployeeIfNeeded, subscribeUserIfNeeded } from '@/utils/socket'

defineOptions({ name: 'SwapDayReport' })

const { showToast } = useToast()
const auth = useAuth()

const loading = ref(false)
const exporting = ref(false)
const rows = ref([])

const search = ref('')
const statusFilter = ref('ALL')
const approvalMode = ref('ALL')
const employeeIdFilter = ref('')
const dateFrom = ref('')
const dateTo = ref('')
const page = ref(1)
const perPage = ref(20)
const perPageOptions = [20, 50, 100, 'All']

const viewOpen = ref(false)
const viewItem = ref(null)

const deleteOpen = ref(false)
const deleteItem = ref(null)
const deleting = ref(false)

const STATUS_LABEL = {
  ALL: 'All',
  PENDING_MANAGER: 'Pending (Mgr)',
  PENDING_GM: 'Pending (GM)',
  PENDING_COO: 'Pending (COO)',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
}

const APPROVAL_MODE_LABEL = {
  ALL: 'All',
  MANAGER_AND_GM: 'Manager + GM',
  MANAGER_AND_COO: 'Manager + COO',
  GM_AND_COO: 'GM + COO',
  MANAGER_ONLY: 'Manager only',
  GM_ONLY: 'GM only',
  COO_ONLY: 'COO only',
}

function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}
function fmtDateTime(v) {
  if (!v) return '—'
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : '—'
}
function fmtYmd(v) {
  if (!v) return '—'
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD') : '—'
}
function compactText(v) {
  return String(v || '').replace(/\s+/g, ' ').trim()
}
function briefText(v, max = 90) {
  const t = compactText(v)
  if (!t) return '—'
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t
}
function statusBadgeUiClass(x) {
  const st = up(x)
  if (st === 'APPROVED') return 'ui-badge ui-badge-success'
  if (st === 'REJECTED') return 'ui-badge ui-badge-danger'
  if (st === 'CANCELLED') return 'ui-badge'
  if (st.includes('PENDING')) return 'ui-badge ui-badge-warning'
  return 'ui-badge'
}
function modeLabel(v) {
  const m = up(v)
  return APPROVAL_MODE_LABEL[m] || m || '—'
}
function reasonText(row) {
  const r = row || {}
  const candidates = [r.reason, r.requestReason, r.note, r.remark, r.comments, r.description]
  return candidates.map(compactText).find(Boolean) || '—'
}

const pendingCount = computed(() => rows.value.filter((r) => up(r.status).includes('PENDING')).length)
const approvedCount = computed(() => rows.value.filter((r) => up(r.status) === 'APPROVED').length)
const rejectedCount = computed(() => rows.value.filter((r) => up(r.status) === 'REJECTED').length)
const totalCount = computed(() => rows.value.length)

function buildQuery() {
  const q = { scope: 'ALL' }
  if (s(search.value)) q.q = s(search.value)
  if (statusFilter.value !== 'ALL') q.status = up(statusFilter.value)
  if (approvalMode.value !== 'ALL') q.approvalMode = up(approvalMode.value)
  if (s(employeeIdFilter.value)) q.employeeId = s(employeeIdFilter.value)
  if (s(dateFrom.value)) q.from = s(dateFrom.value)
  if (s(dateTo.value)) q.to = s(dateTo.value)
  q.limit = 1000
  return q
}

async function fetchRows() {
  try {
    loading.value = true
    const res = await api.get('/leave/swap-working-day/admin', { params: buildQuery() })
    rows.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    showToast({ type: 'error', message: e?.response?.data?.message || 'Failed to load swap working day report.' })
  } finally {
    loading.value = false
  }
}

const filteredRows = computed(() => {
  let list = [...rows.value]

  if (statusFilter.value !== 'ALL') list = list.filter((r) => up(r.status) === up(statusFilter.value))
  if (approvalMode.value !== 'ALL') list = list.filter((r) => up(r.approvalMode) === up(approvalMode.value))
  if (s(employeeIdFilter.value)) list = list.filter((r) => String(r.employeeId || '').includes(s(employeeIdFilter.value)))

  const q = s(search.value).toLowerCase()
  if (q) {
    list = list.filter((r) => [
      r.employeeId,
      r.employeeName,
      r.name,
      r.department,
      reasonText(r),
      r.status,
      r.approvalMode,
      r.requestStartDate,
      r.requestEndDate,
      r.offStartDate,
      r.offEndDate,
      r.managerLoginId,
      r.gmLoginId,
      r.cooLoginId,
    ].map((x) => String(x || '').toLowerCase()).join(' ').includes(q))
  }

  const df = s(dateFrom.value)
  const dt = s(dateTo.value)
  if (df || dt) {
    const from = df || dt
    const to = dt || df
    list = list.filter((r) => {
      const a = s(r.requestStartDate)
      const b = s(r.requestEndDate) || a
      return a && b >= from && a <= to
    })
  }

  list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
  return list
})

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

watch([search, statusFilter, approvalMode, employeeIdFilter, dateFrom, dateTo, perPage], () => {
  page.value = 1
})
watch(pageCount, (n) => {
  if (page.value > n) page.value = n
  if (page.value < 1) page.value = 1
})

function clearFilters() {
  search.value = ''
  statusFilter.value = 'ALL'
  approvalMode.value = 'ALL'
  employeeIdFilter.value = ''
  dateFrom.value = ''
  dateTo.value = ''
  page.value = 1
}

function openView(row) {
  viewItem.value = row
  viewOpen.value = true
}
function closeView() {
  viewOpen.value = false
  viewItem.value = null
}

function openDelete(row) {
  deleteItem.value = row
  deleteOpen.value = true
}
function closeDelete() {
  if (deleting.value) return
  resetDeleteDialog()
}
function resetDeleteDialog() {
  deleteOpen.value = false
  deleteItem.value = null
}
function removeRowById(id) {
  const sid = String(id || '')
  rows.value = rows.value.filter((r) => String(r._id) !== sid)
  if (viewItem.value?._id && String(viewItem.value._id) === sid) closeView()
}

function isDeleteRouteProblem(e) {
  const status = Number(e?.response?.status || 0)
  const message = String(e?.response?.data?.message || '').toLowerCase()
  return status === 404 || status === 405 || message === 'not found'
}

async function adminDeleteWithFallback(baseUrl, id) {
  const encodedId = encodeURIComponent(String(id || ''))
  const postUrl = `${baseUrl}/${encodedId}/delete`
  const deleteUrl = `${baseUrl}/${encodedId}`

  try {
    return await api.post(postUrl)
  } catch (postError) {
    if (!isDeleteRouteProblem(postError)) throw postError
    return api.delete(deleteUrl)
  }
}

async function confirmDelete() {
  const id = deleteItem.value?._id
  if (!id) return
  try {
    deleting.value = true
    await adminDeleteWithFallback('/leave/swap-working-day/admin', id)
    removeRowById(id)
    resetDeleteDialog()
    showToast({ type: 'success', title: 'Deleted', message: 'Swap Working Day request deleted.' })
  } catch (e) {
    showToast({ type: 'error', title: 'Delete failed', message: e?.response?.data?.message || 'Failed to delete swap request.' })
  } finally {
    deleting.value = false
  }
}

function excelRows(list) {
  return (list || []).map((r, idx) => ({
    No: idx + 1,
    CreatedAt: fmtDateTime(r.createdAt),
    EmployeeID: s(r.employeeId),
    EmployeeName: s(r.employeeName || r.name),
    Department: s(r.department),
    ApprovalMode: modeLabel(r.approvalMode),
    Status: up(r.status),
    RequestFrom: fmtYmd(r.requestStartDate),
    RequestTo: fmtYmd(r.requestEndDate),
    OffFrom: fmtYmd(r.offStartDate),
    OffTo: fmtYmd(r.offEndDate),
    Reason: reasonText(r),
  }))
}
async function exportExcel() {
  try {
    exporting.value = true
    const ws = XLSX.utils.json_to_sheet(excelRows(filteredRows.value))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'SwapDayReport')
    XLSX.writeFile(wb, `SwapDayReport_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`)
    showToast({ type: 'success', message: 'Excel exported.' })
  } catch (e) {
    showToast({ type: 'error', message: e?.message || 'Export failed.' })
  } finally {
    exporting.value = false
  }
}

function upsertRow(doc) {
  if (!doc?._id) return
  if (doc.deleted) return removeRowById(doc._id)
  const id = String(doc._id)
  const idx = rows.value.findIndex((x) => String(x._id) === id)
  if (idx >= 0) rows.value[idx] = { ...rows.value[idx], ...doc }
  else rows.value.unshift(doc)
  if (viewItem.value?._id && String(viewItem.value._id) === id) viewItem.value = { ...viewItem.value, ...doc }
}
function onDeleted(doc) {
  removeRowById(doc?._id)
}

onMounted(async () => {
  try {
    subscribeRoleIfNeeded({ role: 'LEAVE_ADMIN' })
    const empId = s(auth.user?.employeeId || auth.user?.empId)
    const loginId = s(auth.user?.loginId || auth.user?.id || auth.user?.sub)
    if (empId) await subscribeEmployeeIfNeeded(empId)
    if (loginId) await subscribeUserIfNeeded(loginId)
  } catch {}
  await fetchRows()
  socket.on('swap:req:created', upsertRow)
  socket.on('swap:req:updated', upsertRow)
  socket.on('swap:req:deleted', onDeleted)
})

onBeforeUnmount(() => {
  socket.off('swap:req:created', upsertRow)
  socket.off('swap:req:updated', upsertRow)
  socket.off('swap:req:deleted', onDeleted)
})
</script>

<template>
  <div class="ui-page min-h-screen w-full">
    <div class="ui-card rounded-none border-x-0 border-t-0 overflow-hidden">
      <div class="ui-hero-gradient">
        <div class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <div class="text-[16px] font-extrabold text-white">Swap Working Day Report</div>
              <span class="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-extrabold text-white ring-1 ring-inset ring-white/20">Admin</span>
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-2">
              <span class="ui-badge ui-badge-info">Total: {{ totalCount }}</span>
              <span class="ui-badge ui-badge-info">Showing: {{ filteredCount }}</span>
              <span class="ui-badge ui-badge-warning">Pending: {{ pendingCount }}</span>
              <span class="ui-badge ui-badge-success">Approved: {{ approvedCount }}</span>
              <span class="ui-badge ui-badge-danger">Rejected: {{ rejectedCount }}</span>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button class="ui-btn ui-btn-sm ui-btn-soft" type="button" :disabled="loading" @click="fetchRows">
              <i class="fa-solid fa-rotate-right text-[11px]" :class="loading ? 'fa-spin' : ''" /> Refresh
            </button>
            <button class="ui-btn ui-btn-sm ui-btn-soft" type="button" :disabled="loading || exporting" @click="exportExcel">
              <i v-if="!exporting" class="fa-solid fa-file-excel text-[11px]" />
              <i v-else class="fa-solid fa-spinner animate-spin text-[11px]" /> Export
            </button>
            <button class="ui-btn ui-btn-sm ui-btn-ghost" type="button" :disabled="loading" @click="clearFilters">
              <i class="fa-solid fa-broom text-[11px]" /> Clear
            </button>
          </div>
        </div>

        <div class="mt-4 rounded-2xl border border-white/15 bg-white/10 p-3 backdrop-blur-sm">
          <div class="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-12">
            <div class="xl:col-span-3">
              <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">Search</label>
              <input v-model="search" type="text" placeholder="Employee / ID / reason" class="filter-input" />
            </div>
            <div class="xl:col-span-2">
              <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">Status</label>
              <select v-model="statusFilter" class="filter-select">
                <option v-for="(label, key) in STATUS_LABEL" :key="key" :value="key">{{ label }}</option>
              </select>
            </div>
            <div class="xl:col-span-2">
              <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">Approval mode</label>
              <select v-model="approvalMode" class="filter-select">
                <option v-for="(label, key) in APPROVAL_MODE_LABEL" :key="key" :value="key">{{ label }}</option>
              </select>
            </div>
            <div class="xl:col-span-2">
              <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">Employee ID</label>
              <input v-model="employeeIdFilter" type="text" placeholder="Employee ID" class="filter-input" />
            </div>
            <div class="xl:col-span-1">
              <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">From</label>
              <input v-model="dateFrom" type="date" class="filter-input" />
            </div>
            <div class="xl:col-span-1">
              <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">To</label>
              <input v-model="dateTo" type="date" class="filter-input" />
            </div>
            <div class="xl:col-span-1">
              <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">Rows</label>
              <select v-model="perPage" class="filter-select">
                <option v-for="opt in perPageOptions" :key="opt" :value="opt">{{ opt }}</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div class="px-2 pb-3 pt-3 sm:px-4 lg:px-6">
        <div v-if="loading && !filteredRows.length" class="ui-skeleton mb-2 h-14 w-full" />
        <div class="ui-table-wrap">
          <table class="ui-table table-fixed w-full min-w-[1280px]">
            <colgroup>
              <col style="width:150px" />
              <col style="width:250px" />
              <col style="width:165px" />
              <col style="width:190px" />
              <col style="width:190px" />
              <col style="width:140px" />
              <col style="width:auto" />
              <col style="width:140px" />
            </colgroup>
            <thead>
              <tr>
                <th class="ui-th">Created</th>
                <th class="ui-th">Employee</th>
                <th class="ui-th">Mode</th>
                <th class="ui-th">Work (Request)</th>
                <th class="ui-th">Swap (Off)</th>
                <th class="ui-th">Status</th>
                <th class="ui-th">Reason</th>
                <th class="ui-th text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!loading && !pagedRows.length">
                <td colspan="8" class="ui-td py-8 text-slate-500 dark:text-slate-400">No items found.</td>
              </tr>
              <tr v-for="row in pagedRows" :key="row._id" class="ui-tr-hover cursor-pointer" @click="openView(row)">
                <td class="ui-td whitespace-nowrap">{{ fmtDateTime(row.createdAt) }}</td>
                <td class="ui-td">
                  <div class="truncate font-extrabold text-slate-900 dark:text-slate-50">{{ row.employeeName || row.name || row.employeeId || '—' }}</div>
                  <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">ID: {{ row.employeeId || '—' }} <span v-if="row.department">· {{ row.department }}</span></div>
                </td>
                <td class="ui-td"><div class="truncate">{{ modeLabel(row.approvalMode) }}</div></td>
                <td class="ui-td whitespace-nowrap">{{ fmtYmd(row.requestStartDate) }} → {{ fmtYmd(row.requestEndDate) }}</td>
                <td class="ui-td whitespace-nowrap">{{ fmtYmd(row.offStartDate) }} → {{ fmtYmd(row.offEndDate) }}</td>
                <td class="ui-td"><span :class="statusBadgeUiClass(row.status)">{{ STATUS_LABEL[row.status] || row.status }}</span></td>
                <td class="ui-td"><p class="reason-cell" :title="reasonText(row)">{{ briefText(reasonText(row), 120) }}</p></td>
                <td class="ui-td text-center">
                  <button class="ui-btn ui-btn-rose ui-btn-xs" type="button" @click.stop="openDelete(row)">
                    <i class="fa-solid fa-trash text-[11px]" /> Delete
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="ui-divider mt-3 flex flex-col gap-2 pt-3 text-[11px] text-slate-600 dark:text-slate-300 sm:flex-row sm:items-center sm:justify-between">
          <div>Page {{ page }} / {{ pageCount }} · Showing {{ pagedRows.length }} of {{ filteredCount }}</div>
          <div class="flex items-center justify-end gap-1">
            <button type="button" class="ui-pagebtn" :disabled="page <= 1" @click="page = 1">«</button>
            <button type="button" class="ui-pagebtn" :disabled="page <= 1" @click="page = Math.max(1, page - 1)">Prev</button>
            <button type="button" class="ui-pagebtn" :disabled="page >= pageCount" @click="page = Math.min(pageCount, page + 1)">Next</button>
            <button type="button" class="ui-pagebtn" :disabled="page >= pageCount" @click="page = pageCount">»</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="viewOpen" class="ui-modal-backdrop">
      <div class="ui-modal overflow-hidden p-0">
        <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div class="min-w-0">
            <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Swap Request Details</div>
            <div class="truncate text-[11px] text-slate-500 dark:text-slate-400">{{ viewItem?.employeeName || viewItem?.name || '—' }} · {{ fmtDateTime(viewItem?.createdAt) }}</div>
          </div>
          <button class="ui-btn ui-btn-ghost ui-btn-xs" type="button" @click="closeView"><i class="fa-solid fa-xmark text-[11px]" /> Close</button>
        </div>
        <div class="space-y-3 p-4">
          <div class="grid gap-3 md:grid-cols-2">
            <div class="ui-card p-3"><div class="ui-section-title">Work on</div><div class="mt-1 text-[12px]">{{ fmtYmd(viewItem?.requestStartDate) }} → {{ fmtYmd(viewItem?.requestEndDate) }}</div></div>
            <div class="ui-card p-3"><div class="ui-section-title">Take off on</div><div class="mt-1 text-[12px]">{{ fmtYmd(viewItem?.offStartDate) }} → {{ fmtYmd(viewItem?.offEndDate) }}</div></div>
          </div>
          <div class="ui-card p-3"><div class="ui-section-title">Reason</div><div class="mt-1 whitespace-pre-wrap text-[12px]">{{ reasonText(viewItem) }}</div></div>
          <div class="flex justify-end gap-2 pt-1">
            <button class="ui-btn ui-btn-ghost" type="button" @click="closeView">Close</button>
            <button class="ui-btn ui-btn-rose" type="button" @click="openDelete(viewItem)">Delete</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="deleteOpen" class="ui-modal-backdrop">
      <div class="ui-modal p-4">
        <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Delete this swap working day request?</div>
        <div class="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
          This permanently removes the record for <span class="font-extrabold">{{ deleteItem?.employeeName || deleteItem?.employeeId || '—' }}</span>.
        </div>
        <div class="mt-4 flex justify-end gap-2">
          <button class="ui-btn ui-btn-ghost" type="button" :disabled="deleting" @click="closeDelete">Close</button>
          <button class="ui-btn ui-btn-rose" type="button" :disabled="deleting" @click="confirmDelete">
            <i v-if="deleting" class="fa-solid fa-spinner animate-spin text-[11px]" /> Delete
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.filter-input,
.filter-select {
  width: 100%;
  border-radius: 0.85rem;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.1);
  padding: 0.55rem 0.8rem;
  font-size: 11px;
  color: white;
  outline: none;
}
.filter-input::placeholder { color: rgba(255, 255, 255, 0.65); }
.filter-input:focus,
.filter-select:focus { border-color: rgba(255, 255, 255, 0.35); background: rgba(255, 255, 255, 0.14); }
.filter-select option { color: #0f172a; }
.reason-cell {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.35;
}
</style>
