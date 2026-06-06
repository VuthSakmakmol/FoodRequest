<!-- src/views/expat/admin/components/AdminLeaveRequestsReport.vue -->
<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/store/auth'
import socket, { subscribeRoleIfNeeded, subscribeEmployeeIfNeeded, subscribeUserIfNeeded } from '@/utils/socket'

defineOptions({ name: 'AdminLeaveRequestsReport' })

const { showToast } = useToast()
const auth = useAuth()

const loading = ref(false)
const rows = ref([])
const total = ref(0)
const search = ref('')
const statusFilter = ref('ALL')
const leaveTypeFilter = ref('ALL')
const employeeIdFilter = ref('')
const dateFrom = ref('')
const dateTo = ref('')
const page = ref(1)
const perPage = ref(50)
const perPageOptions = [20, 50, 100, 200]

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
function briefText(v, max = 100) {
  const t = compactText(v)
  if (!t) return '—'
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t
}
function statusLabel(v) {
  return STATUS_LABEL[up(v)] || up(v) || '—'
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
  if (m === 'MANAGER_AND_GM') return 'Manager + GM'
  if (m === 'MANAGER_AND_COO') return 'Manager + COO'
  if (m === 'GM_AND_COO') return 'GM + COO'
  if (m === 'MANAGER_ONLY') return 'Manager only'
  if (m === 'GM_ONLY') return 'GM only'
  if (m === 'COO_ONLY') return 'COO only'
  return m || '—'
}

const pendingCount = computed(() => rows.value.filter((r) => up(r.status).includes('PENDING')).length)
const approvedCount = computed(() => rows.value.filter((r) => up(r.status) === 'APPROVED').length)
const rejectedCount = computed(() => rows.value.filter((r) => up(r.status) === 'REJECTED').length)
const cancelledCount = computed(() => rows.value.filter((r) => up(r.status) === 'CANCELLED').length)

const leaveTypeOptions = computed(() => {
  const set = new Set(rows.value.map((r) => up(r.leaveTypeCode)).filter(Boolean))
  return ['ALL', ...Array.from(set).sort()]
})

function buildQuery() {
  const limit = Math.min(Math.max(Number(perPage.value || 50), 1), 200)
  return {
    q: s(search.value) || undefined,
    employeeId: s(employeeIdFilter.value) || undefined,
    status: statusFilter.value !== 'ALL' ? up(statusFilter.value) : undefined,
    leaveTypeCode: leaveTypeFilter.value !== 'ALL' ? up(leaveTypeFilter.value) : undefined,
    from: s(dateFrom.value) || undefined,
    to: s(dateTo.value) || undefined,
    limit,
    skip: Math.max((Number(page.value) - 1) * limit, 0),
  }
}

async function fetchRows() {
  try {
    loading.value = true
    const res = await api.get('/leave/requests/admin', { params: buildQuery() })
    const data = res?.data || {}
    rows.value = Array.isArray(data.items) ? data.items : Array.isArray(data) ? data : []
    total.value = Number(data.total ?? rows.value.length) || rows.value.length
  } catch (e) {
    showToast({ type: 'error', message: e?.response?.data?.message || 'Failed to load leave requests.' })
  } finally {
    loading.value = false
  }
}

const canPrev = computed(() => page.value > 1)
const canNext = computed(() => page.value * Number(perPage.value || 50) < total.value)

watch([search, statusFilter, leaveTypeFilter, employeeIdFilter, dateFrom, dateTo, perPage], () => {
  page.value = 1
  fetchRows()
})
watch(page, () => fetchRows())

function clearFilters() {
  search.value = ''
  statusFilter.value = 'ALL'
  leaveTypeFilter.value = 'ALL'
  employeeIdFilter.value = ''
  dateFrom.value = ''
  dateTo.value = ''
  page.value = 1
  fetchRows()
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
  if (total.value > 0) total.value -= 1
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
    await adminDeleteWithFallback('/leave/requests/admin', id)
    removeRowById(id)
    resetDeleteDialog()
    showToast({
      type: 'success',
      title: 'Deleted',
      message: 'Leave request deleted. Employee leave balance was recalculated.',
    })
    await fetchRows()
  } catch (e) {
    showToast({ type: 'error', title: 'Delete failed', message: e?.response?.data?.message || 'Failed to delete leave request.' })
  } finally {
    deleting.value = false
  }
}

function upsertRow(doc) {
  if (!doc?._id) return
  if (doc.deleted) return removeRowById(doc._id)
  const id = String(doc._id)
  const idx = rows.value.findIndex((r) => String(r._id) === id)
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
  socket.on('leave:req:created', upsertRow)
  socket.on('leave:req:updated', upsertRow)
  socket.on('leave:req:deleted', onDeleted)
})

onBeforeUnmount(() => {
  socket.off('leave:req:created', upsertRow)
  socket.off('leave:req:updated', upsertRow)
  socket.off('leave:req:deleted', onDeleted)
})
</script>

<template>
  <div class="ui-page min-h-screen w-full">
    <div class="ui-card rounded-none border-x-0 border-t-0 overflow-hidden">
      <div class="ui-hero-gradient">
        <div class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <div class="text-[16px] font-extrabold text-white">Leave Requests</div>
              <span class="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-extrabold text-white ring-1 ring-inset ring-white/20">Admin</span>
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-2">
              <span class="ui-badge ui-badge-info">Total: {{ total }}</span>
              <span class="ui-badge ui-badge-warning">Pending: {{ pendingCount }}</span>
              <span class="ui-badge ui-badge-success">Approved: {{ approvedCount }}</span>
              <span class="ui-badge ui-badge-danger">Rejected: {{ rejectedCount }}</span>
              <span class="ui-badge">Cancelled: {{ cancelledCount }}</span>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <button class="ui-btn ui-btn-sm ui-btn-soft" type="button" :disabled="loading" @click="fetchRows">
              <i class="fa-solid fa-rotate-right text-[11px]" :class="loading ? 'fa-spin' : ''" />
              Refresh
            </button>
            <button class="ui-btn ui-btn-sm ui-btn-ghost" type="button" :disabled="loading" @click="clearFilters">
              <i class="fa-solid fa-broom text-[11px]" />
              Clear
            </button>
          </div>
        </div>

        <div class="mt-4 rounded-2xl border border-white/15 bg-white/10 p-3 backdrop-blur-sm">
          <div class="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-12">
            <div class="xl:col-span-3">
              <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">Search</label>
              <input v-model="search" class="filter-input" type="text" placeholder="Name / ID / reason / approver" />
            </div>
            <div class="xl:col-span-2">
              <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">Status</label>
              <select v-model="statusFilter" class="filter-select">
                <option v-for="(label, key) in STATUS_LABEL" :key="key" :value="key">{{ label }}</option>
              </select>
            </div>
            <div class="xl:col-span-2">
              <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">Type</label>
              <select v-model="leaveTypeFilter" class="filter-select">
                <option v-for="opt in leaveTypeOptions" :key="opt" :value="opt">{{ opt === 'ALL' ? 'All' : opt }}</option>
              </select>
            </div>
            <div class="xl:col-span-2">
              <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">Employee ID</label>
              <input v-model="employeeIdFilter" class="filter-input" type="text" placeholder="Employee ID" />
            </div>
            <div class="xl:col-span-1">
              <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">From</label>
              <input v-model="dateFrom" class="filter-input" type="date" />
            </div>
            <div class="xl:col-span-1">
              <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">To</label>
              <input v-model="dateTo" class="filter-input" type="date" />
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
        <div v-if="loading && !rows.length" class="ui-skeleton mb-2 h-14 w-full" />

        <div class="ui-table-wrap">
          <table class="ui-table table-fixed w-full min-w-[1280px]">
            <colgroup>
              <col style="width:150px" />
              <col style="width:250px" />
              <col style="width:105px" />
              <col style="width:190px" />
              <col style="width:85px" />
              <col style="width:150px" />
              <col style="width:150px" />
              <col style="width:auto" />
              <col style="width:150px" />
            </colgroup>
            <thead>
              <tr>
                <th class="ui-th">Created</th>
                <th class="ui-th">Employee</th>
                <th class="ui-th">Type</th>
                <th class="ui-th">Leave Date</th>
                <th class="ui-th">Days</th>
                <th class="ui-th">Mode</th>
                <th class="ui-th">Status</th>
                <th class="ui-th">Reason</th>
                <th class="ui-th text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!loading && !rows.length">
                <td colspan="9" class="ui-td py-8 text-slate-500 dark:text-slate-400">No leave requests found.</td>
              </tr>
              <tr v-for="row in rows" :key="row._id" class="ui-tr-hover cursor-pointer" @click="openView(row)">
                <td class="ui-td whitespace-nowrap">{{ fmtDateTime(row.createdAt) }}</td>
                <td class="ui-td">
                  <div class="truncate font-extrabold text-slate-900 dark:text-slate-50">{{ row.employeeName || row.name || row.employeeId || '—' }}</div>
                  <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">ID: {{ row.employeeId || '—' }} <span v-if="row.department">· {{ row.department }}</span></div>
                </td>
                <td class="ui-td"><span class="ui-badge ui-badge-info">{{ row.leaveTypeCode || '—' }}</span></td>
                <td class="ui-td whitespace-nowrap">{{ fmtYmd(row.startDate) }} → {{ fmtYmd(row.endDate) }}</td>
                <td class="ui-td font-extrabold tabular-nums">{{ Number(row.totalDays || 0).toLocaleString() }}</td>
                <td class="ui-td"><div class="truncate">{{ modeLabel(row.approvalMode) }}</div></td>
                <td class="ui-td"><span :class="statusBadgeUiClass(row.status)">{{ statusLabel(row.status) }}</span></td>
                <td class="ui-td"><p class="reason-cell" :title="compactText(row.reason)">{{ briefText(row.reason, 130) }}</p></td>
                <td class="ui-td text-center">
                  <button class="ui-btn ui-btn-rose ui-btn-xs" type="button" @click.stop="openDelete(row)">
                    <i class="fa-solid fa-trash text-[11px]" />
                    Delete
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="ui-divider mt-3 flex flex-col gap-2 pt-3 text-[11px] text-slate-600 dark:text-slate-300 sm:flex-row sm:items-center sm:justify-between">
          <div>Page {{ page }} · Showing {{ rows.length }} of {{ total }}</div>
          <div class="flex items-center justify-end gap-1">
            <button type="button" class="ui-pagebtn" :disabled="!canPrev" @click="page = 1">«</button>
            <button type="button" class="ui-pagebtn" :disabled="!canPrev" @click="page = Math.max(1, page - 1)">Prev</button>
            <button type="button" class="ui-pagebtn" :disabled="!canNext" @click="page = page + 1">Next</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="viewOpen" class="ui-modal-backdrop">
      <div class="ui-modal overflow-hidden p-0">
        <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div class="min-w-0">
            <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Leave Request Details</div>
            <div class="truncate text-[11px] text-slate-500 dark:text-slate-400">{{ viewItem?.employeeName || viewItem?.name || '—' }} · {{ fmtDateTime(viewItem?.createdAt) }}</div>
          </div>
          <button class="ui-btn ui-btn-ghost ui-btn-xs" type="button" @click="closeView">
            <i class="fa-solid fa-xmark text-[11px]" /> Close
          </button>
        </div>
        <div class="space-y-3 p-4">
          <div class="grid gap-3 md:grid-cols-2">
            <div class="ui-card p-3">
              <div class="ui-section-title">Employee</div>
              <div class="mt-1 text-[12px] font-extrabold text-slate-900 dark:text-slate-50">{{ viewItem?.employeeName || viewItem?.name || '—' }}</div>
              <div class="text-[11px] text-slate-500 dark:text-slate-400">ID: {{ viewItem?.employeeId || '—' }}</div>
            </div>
            <div class="ui-card p-3">
              <div class="ui-section-title">Status</div>
              <div class="mt-1"><span :class="statusBadgeUiClass(viewItem?.status)">{{ statusLabel(viewItem?.status) }}</span></div>
              <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">{{ modeLabel(viewItem?.approvalMode) }}</div>
            </div>
          </div>
          <div class="grid gap-3 md:grid-cols-3">
            <div class="ui-frame p-3"><div class="ui-label">Leave Type</div><div class="font-extrabold">{{ viewItem?.leaveTypeCode || '—' }}</div></div>
            <div class="ui-frame p-3"><div class="ui-label">Date</div><div>{{ fmtYmd(viewItem?.startDate) }} → {{ fmtYmd(viewItem?.endDate) }}</div></div>
            <div class="ui-frame p-3"><div class="ui-label">Days</div><div class="font-extrabold">{{ Number(viewItem?.totalDays || 0).toLocaleString() }}</div></div>
          </div>
          <div class="ui-card p-3">
            <div class="ui-section-title">Reason</div>
            <div class="mt-1 whitespace-pre-wrap text-[12px] text-slate-700 dark:text-slate-200">{{ viewItem?.reason || '—' }}</div>
          </div>
          <div class="flex justify-end gap-2 pt-1">
            <button class="ui-btn ui-btn-ghost" type="button" @click="closeView">Close</button>
            <button class="ui-btn ui-btn-rose" type="button" @click="openDelete(viewItem)">Delete</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="deleteOpen" class="ui-modal-backdrop">
      <div class="ui-modal p-4">
        <div class="flex items-start gap-3">
          <div class="grid h-10 w-10 place-items-center rounded-2xl border border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-300">
            <i class="fa-solid fa-triangle-exclamation" />
          </div>
          <div class="flex-1">
            <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Delete this leave request?</div>
            <div class="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
              This permanently removes the request and recalculates leave remaining for employee
              <span class="font-extrabold">{{ deleteItem?.employeeName || deleteItem?.employeeId || '—' }}</span>.
            </div>
          </div>
        </div>
        <div class="mt-4 flex justify-end gap-2">
          <button class="ui-btn ui-btn-ghost" type="button" :disabled="deleting" @click="closeDelete">Close</button>
          <button class="ui-btn ui-btn-rose" type="button" :disabled="deleting" @click="confirmDelete">
            <i v-if="deleting" class="fa-solid fa-spinner animate-spin text-[11px]" />
            Delete and Recalculate
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
