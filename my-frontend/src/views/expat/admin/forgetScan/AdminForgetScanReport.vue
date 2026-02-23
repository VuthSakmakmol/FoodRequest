<!-- src/views/expat/admin/forgetScan/AdminForgetScanReport.vue
  ✅ Admin viewer report for Forget Scan requests
  ✅ Clean header: title row + ONE toolbar row with 6 filters
  ✅ Filters (6-in-1): Search, Status, EmployeeId, From, To, PerPage
  ✅ Server paging: limit/skip (best-effort Next/Prev)
  ✅ Responsive: mobile cards + desktop table (column width config)
  ✅ Export Excel (xlsx) for current filtered page
  ✅ Details modal
  ✅ Realtime updates (forgetscan:req:created / forgetscan:req:updated)
-->
<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import * as XLSX from 'xlsx'

import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/store/auth'

// realtime (same pattern)
import socket, { subscribeRoleIfNeeded, subscribeEmployeeIfNeeded, subscribeUserIfNeeded } from '@/utils/socket'

defineOptions({ name: 'AdminForgetScanReport' })

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
const exporting = ref(false)
const rows = ref([])

/* filters (6 in 1 row) */
const search = ref('')
const statusFilter = ref('ALL')
const employeeIdFilter = ref('')
const dateFrom = ref('')
const dateTo = ref('')
const perPage = ref(50)
const perPageOptions = [20, 50, 100, 200]

/* server pagination */
const page = ref(1)

/* view modal */
const viewOpen = ref(false)
const viewItem = ref(null)

/* ───────────────── COLUMN WIDTH CONFIG (DESKTOP TABLE) ───────────────── */
const COL_WIDTH = {
  created: '150px',
  employee: '290px',
  forgot: '160px',
  type: '120px',
  mode: '170px',
  status: '140px',
  reason: 'auto',
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
const TYPE_LABEL = { FORGET_IN: 'Forget In', FORGET_OUT: 'Forget Out' }
const MODE_LABEL = {
  MANAGER_AND_GM: 'Manager + GM',
  MANAGER_AND_COO: 'Manager + COO',
  GM_AND_COO: 'GM + COO',
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
  if (t.length <= max) return t
  return t.slice(0, max).trimEnd() + '…'
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
  return MODE_LABEL[m] || m || '—'
}
function typeLabel(v) {
  const t = up(v)
  return TYPE_LABEL[t] || t || '—'
}

/* ───────────────── API ─────────────────
  GET /leave/forget-scan/admin?employeeId=&status=&from=&to=&limit=&skip=
*/
function buildQuery() {
  const q = {}

  // status
  if (statusFilter.value !== 'ALL') q.status = up(statusFilter.value)

  // employeeId
  if (s(employeeIdFilter.value)) q.employeeId = s(employeeIdFilter.value)

  // date range (only apply if both are provided)
  const df = s(dateFrom.value)
  const dt = s(dateTo.value)
  if ((df && !dt) || (!df && dt)) {
    showToast({ type: 'warning', message: 'Please provide both date from and date to.' })
  } else if (df && dt) {
    q.from = df
    q.to = dt
  }

  const limit = Math.min(Math.max(Number(perPage.value || 50), 1), 200)
  const skip = Math.max((Number(page.value) - 1) * limit, 0)

  q.limit = limit
  q.skip = skip

  return q
}

async function fetchRows() {
  try {
    loading.value = true
    const params = buildQuery()
    const res = await api.get('/leave/forget-scan/admin', { params })
    rows.value = Array.isArray(res.data) ? res.data : []
  } catch (e) {
    showToast({ type: 'error', message: e?.response?.data?.message || 'Failed to load forget scan report' })
  } finally {
    loading.value = false
  }
}

/* local search within fetched page (safe & snappy) */
const filteredRows = computed(() => {
  let list = [...rows.value]

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
        r.forgotDate,
        r.forgotType,
        r.requesterLoginId,
        r.managerLoginId,
        r.gmLoginId,
        r.cooLoginId,
        r.managerComment,
        r.gmComment,
        r.cooComment,
      ]
        .map((x) => String(x || '').toLowerCase())
        .join(' ')
      return hay.includes(q)
    })
  }

  // newest first
  list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
  return list
})

const filteredCount = computed(() => filteredRows.value.length)

/* best-effort next/prev (no total count from backend) */
const canPrev = computed(() => page.value > 1)
const canNext = computed(() => rows.value.length === Number(perPage.value || 50))

/* any server-side filter change resets to page 1 */
watch(
  () => [statusFilter.value, employeeIdFilter.value, dateFrom.value, dateTo.value, perPage.value],
  () => {
    page.value = 1
    fetchRows()
  }
)
watch(
  () => page.value,
  () => fetchRows()
)

/* actions */
function clearFilters() {
  search.value = ''
  statusFilter.value = 'ALL'
  employeeIdFilter.value = ''
  dateFrom.value = ''
  dateTo.value = ''
  perPage.value = 50
  page.value = 1
  fetchRows()
}

/* view modal */
function openView(row) {
  viewItem.value = row
  viewOpen.value = true
}
function closeView() {
  viewOpen.value = false
  viewItem.value = null
}

/* export */
function excelRows(list) {
  return (list || []).map((r, idx) => {
    const approvals = Array.isArray(r.approvals) ? r.approvals : []
    const mgr = approvals.find((a) => up(a.level) === 'MANAGER')
    const gm = approvals.find((a) => up(a.level) === 'GM')
    const coo = approvals.find((a) => up(a.level) === 'COO')

    return {
      No: idx + 1,
      CreatedAt: fmtDateTime(r.createdAt),
      EmployeeID: s(r.employeeId),
      EmployeeName: s(r.employeeName || r.name),
      Department: s(r.department),

      ForgotDate: s(r.forgotDate),
      ForgotType: typeLabel(r.forgotType),

      ApprovalMode: modeLabel(r.approvalMode),
      Status: up(r.status),

      Reason: compactText(r.reason),

      RequesterLoginId: s(r.requesterLoginId),

      ManagerLoginId: s(r.managerLoginId),
      ManagerStatus: s(mgr?.status),
      ManagerActedAt: fmtDateTime(mgr?.actedAt),
      ManagerComment: s(r.managerComment || mgr?.note),

      // GmLoginId: s(r.gmLoginId),
      GmStatus: s(gm?.status),
      GmActedAt: fmtDateTime(gm?.actedAt),
      GmComment: s(r.gmComment || gm?.note),

      // CooLoginId: s(r.cooLoginId),
      CooStatus: s(coo?.status),
      CooActedAt: fmtDateTime(coo?.actedAt),
      CooComment: s(r.cooComment || coo?.note),

      UpdatedAt: fmtDateTime(r.updatedAt),
      CancelledBy: s(r.cancelledBy),
      CancelledAt: fmtDateTime(r.cancelledAt),
    }
  })
}

async function exportExcel() {
  try {
    exporting.value = true

    // export what user currently sees (current page + local search applied)
    const data = excelRows(filteredRows.value)

    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'ForgetScanReport')

    const stamp = dayjs().format('YYYYMMDD_HHmm')
    XLSX.writeFile(wb, `ForgetScanReport_${stamp}.xlsx`)
    showToast({ type: 'success', message: 'Excel exported.' })
  } catch (e) {
    showToast({ type: 'error', message: e?.message || 'Export failed' })
  } finally {
    exporting.value = false
  }
}

/* realtime */
function upsertRow(doc) {
  if (!doc?._id) return
  const id = String(doc._id)
  const idx = rows.value.findIndex((x) => String(x._id) === id)

  if (idx >= 0) rows.value[idx] = { ...rows.value[idx], ...doc }
  else rows.value.unshift(doc)

  if (viewItem.value?._id && String(viewItem.value._id) === id) {
    viewItem.value = { ...viewItem.value, ...doc }
  }
}
function onCreated(doc) {
  upsertRow(doc)
}
function onUpdated(doc) {
  upsertRow(doc)
}

onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)

  // join admin rooms
  try {
    subscribeRoleIfNeeded({ role: 'LEAVE_ADMIN' })
    const empId = String(auth.user?.employeeId || auth.user?.empId || '').trim()
    const loginId = String(auth.user?.loginId || auth.user?.id || auth.user?.sub || '').trim()
    if (empId) await subscribeEmployeeIfNeeded(empId)
    if (loginId) await subscribeUserIfNeeded(loginId)
  } catch {}

  await fetchRows()

  socket.on('forgetscan:req:created', onCreated)
  socket.on('forgetscan:req:updated', onUpdated)
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
  socket.off('forgetscan:req:created', onCreated)
  socket.off('forgetscan:req:updated', onUpdated)
})
</script>

<template>
  <div class="ui-page min-h-screen w-full">
    <div class="w-full">
      <div class="ui-card rounded-none border-x-0 border-t-0 overflow-hidden">
        <!-- HERO -->
        <div class="ui-hero-gradient">
          <!-- Row 1: title + actions -->
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="text-[15px] font-extrabold">Forget Scan Report · Admin</div>
              <div class="mt-1 flex flex-wrap items-center gap-2">
                <span class="ui-badge ui-badge-info">Showing: {{ filteredCount }}</span>
                <span class="ui-badge ui-badge-info">Page: {{ page }}</span>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <button class="ui-btn ui-btn-sm ui-btn-soft" type="button" :disabled="loading" @click="fetchRows" title="Refresh">
                <i class="fa-solid fa-rotate-right text-[11px]" />
              </button>

              <button
                class="ui-btn ui-btn-sm ui-btn-soft"
                type="button"
                :disabled="loading || exporting"
                @click="exportExcel"
                title="Export Excel"
              >
                <i v-if="!exporting" class="fa-solid fa-file-excel text-[11px]" />
                <i v-else class="fa-solid fa-spinner animate-spin text-[11px]" />
              </button>

              <button class="ui-btn ui-btn-sm ui-btn-ghost" type="button" :disabled="loading" @click="clearFilters" title="Clear">
                <i class="fa-solid fa-broom text-[11px]" />
              </button>
            </div>
          </div>

          <!-- Row 2: ✅ 6 filters in one row (desktop). On mobile it stacks. -->
          <div class="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-12">
            <!-- 1) Search -->
            <div class="lg:col-span-2">
              <div class="flex items-center rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-[11px]">
                <i class="fa-solid fa-magnifying-glass mr-2 text-white/80" />
                <input
                  v-model="search"
                  type="text"
                  placeholder="Search employee / id / dept / reason..."
                  class="w-full bg-transparent text-white outline-none placeholder:text-white/70"
                />
              </div>
            </div>

            <!-- 2) Status -->
            <div class="lg:col-span-2">
              <select
                v-model="statusFilter"
                class="w-full rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-[11px] text-white outline-none"
                title="Status"
              >
                <option v-for="(label, key) in STATUS_LABEL" :key="key" :value="key">
                  {{ label }}
                </option>
              </select>
            </div>

            <!-- 3) Employee ID -->
            <div class="lg:col-span-1">
              <input
                v-model="employeeIdFilter"
                type="text"
                placeholder="Employee ID"
                class="w-full rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-[11px] text-white outline-none placeholder:text-white/70"
              />
            </div>

            <!-- 4) From -->
            <div class="lg:col-span-2">
              <input
                v-model="dateFrom"
                type="date"
                class="w-full rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-[11px] text-white outline-none"
                title="From"
              />
            </div>

            <!-- 5) To -->
            <div class="lg:col-span-2">
              <input
                v-model="dateTo"
                type="date"
                class="w-full rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-[11px] text-white outline-none"
                title="To"
              />
            </div>

            <!-- 6) Per page -->
            <div class="lg:col-span-1">
              <select
                v-model="perPage"
                class="w-full rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-[11px] text-white outline-none"
                title="Per page"
              >
                <option v-for="opt in perPageOptions" :key="'per-' + opt" :value="opt">
                  {{ opt }}
                </option>
              </select>
            </div>
          </div>

          <!-- <div class="mt-2 text-[11px] text-white/80 flex items-center justify-between">
            <button
              type="button"
              class="ui-btn ui-btn-xs ui-btn-soft"
              :disabled="loading"
              @click="fetchRows"
              title="Apply"
            >
              <i class="fa-solid fa-filter text-[11px] mr-2" />
              Apply
            </button>
          </div> -->
        </div>

        <!-- BODY -->
        <div class="px-2 pb-3 pt-3 sm:px-4 lg:px-6">
          <div v-if="loading && !filteredRows.length" class="ui-skeleton h-14 w-full mb-2" />

          <!-- MOBILE CARDS -->
          <div v-if="isMobile" class="space-y-2">
            <div v-if="!filteredRows.length && !loading" class="ui-frame p-4 text-center text-[12px] text-slate-500">
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
                    ID: {{ row.employeeId || '—' }} · {{ fmtYmd(row.forgotDate) }} · {{ typeLabel(row.forgotType) }}
                  </div>
                </div>

                <div class="shrink-0 text-right space-y-1">
                  <span :class="statusBadgeUiClass(row.status)">
                    {{ STATUS_LABEL[row.status] || row.status }}
                  </span>
                </div>
              </div>

              <div class="mt-2 grid gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                <div class="ui-frame p-2">
                  <div class="font-extrabold text-slate-700 dark:text-slate-200">Mode</div>
                  <div class="mt-0.5">{{ modeLabel(row.approvalMode) }}</div>
                </div>

                <div class="ui-frame p-2">
                  <div class="font-extrabold text-slate-700 dark:text-slate-200">Reason</div>
                  <div class="mt-0.5">{{ briefText(row.reason, 140) }}</div>
                </div>
              </div>

              <div class="mt-3 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                <span>Tap to view</span>
                <span>{{ row.department || '—' }}</span>
              </div>
            </article>
          </div>

          <!-- DESKTOP TABLE -->
          <div v-else class="ui-table-wrap">
            <table class="ui-table table-fixed w-full min-w-[1100px]">
              <colgroup>
                <col :style="{ width: COL_WIDTH.created }" />
                <col :style="{ width: COL_WIDTH.employee }" />
                <col :style="{ width: COL_WIDTH.forgot }" />
                <col :style="{ width: COL_WIDTH.type }" />
                <col :style="{ width: COL_WIDTH.mode }" />
                <col :style="{ width: COL_WIDTH.status }" />
                <col :style="{ width: COL_WIDTH.reason }" />
              </colgroup>

              <thead>
                <tr>
                  <th class="ui-th">Created</th>
                  <th class="ui-th">Employee</th>
                  <th class="ui-th">Forgot Date</th>
                  <th class="ui-th">Type</th>
                  <th class="ui-th">Mode</th>
                  <th class="ui-th">Status</th>
                  <th class="ui-th">Reason</th>
                </tr>
              </thead>

              <tbody>
                <tr v-if="!loading && !filteredRows.length">
                  <td colspan="7" class="ui-td py-8 text-slate-500 dark:text-slate-400">No items found.</td>
                </tr>

                <tr v-for="row in filteredRows" :key="row._id" class="ui-tr-hover cursor-pointer" @click="openView(row)">
                  <td class="ui-td">
                    <div class="truncate">{{ fmtDateTime(row.createdAt) }}</div>
                  </td>

                  <td class="ui-td">
                    <div class="font-extrabold text-slate-900 dark:text-slate-50 truncate">
                      {{ row.employeeName || row.name || row.employeeId || '—' }}
                    </div>
                    <div class="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                      ID: {{ row.employeeId || '—' }} <span v-if="row.department">· {{ row.department }}</span>
                    </div>
                  </td>

                  <td class="ui-td">
                    <div class="truncate">{{ fmtYmd(row.forgotDate) }}</div>
                  </td>

                  <td class="ui-td">
                    <div class="truncate">{{ typeLabel(row.forgotType) }}</div>
                  </td>

                  <td class="ui-td">
                    <div class="truncate">{{ modeLabel(row.approvalMode) }}</div>
                  </td>

                  <td class="ui-td">
                    <span :class="statusBadgeUiClass(row.status)">
                      {{ STATUS_LABEL[row.status] || row.status }}
                    </span>
                  </td>

                  <td class="ui-td">
                    <p class="reason-cell" :title="compactText(row.reason)">
                      {{ row.reason ? compactText(row.reason) : '—' }}
                    </p>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Server Pagination -->
          <div class="mt-3 flex flex-col gap-2 ui-divider pt-3 text-[11px] text-slate-600 dark:text-slate-300 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-slate-500 dark:text-slate-400">Page {{ page }}</span>
            </div>

            <div class="flex items-center justify-end gap-1">
              <button type="button" class="ui-pagebtn" :disabled="!canPrev" @click="page = 1">«</button>
              <button type="button" class="ui-pagebtn" :disabled="!canPrev" @click="page = Math.max(1, page - 1)">Prev</button>
              <button type="button" class="ui-pagebtn" :disabled="!canNext" @click="page = page + 1">Next</button>
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

                <div class="mt-2 ui-label">Approval Mode</div>
                <div class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                  {{ modeLabel(viewItem?.approvalMode) }}
                </div>
              </div>
            </div>
          </div>

          <div class="grid gap-3 md:grid-cols-3">
            <div class="ui-card p-3">
              <div class="ui-section-title">Forgot Date</div>
              <div class="mt-1 text-[12px] text-slate-700 dark:text-slate-200">
                {{ fmtYmd(viewItem?.forgotDate) }}
              </div>
            </div>

            <div class="ui-card p-3">
              <div class="ui-section-title">Type</div>
              <div class="mt-1 text-[12px] text-slate-700 dark:text-slate-200">
                {{ typeLabel(viewItem?.forgotType) }}
              </div>
            </div>

            <div class="ui-card p-3">
              <div class="ui-section-title">Requester Login</div>
              <div class="mt-1 text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                {{ viewItem?.requesterLoginId || '—' }}
              </div>
            </div>
          </div>

          <div class="ui-card p-3">
            <div class="ui-section-title">Reason</div>
            <div class="mt-1 text-[12px] text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
              {{ viewItem?.reason || '—' }}
            </div>
          </div>

          <div class="ui-card p-3">
            <div class="ui-section-title">Approvers</div>
            <div class="mt-1 grid gap-2 text-[12px] text-slate-700 dark:text-slate-200 md:grid-cols-3">
              <div class="ui-frame p-2">
                <div class="text-[11px] text-slate-500 dark:text-slate-400">Manager</div>
                <div class="font-extrabold">{{ viewItem?.managerLoginId || '—' }}</div>
                <div v-if="viewItem?.managerDecisionAt" class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {{ fmtDateTime(viewItem.managerDecisionAt) }}
                </div>
                <div v-if="viewItem?.managerComment" class="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                  {{ viewItem.managerComment }}
                </div>
              </div>

              <div class="ui-frame p-2">
                <div class="text-[11px] text-slate-500 dark:text-slate-400">GM</div>
                <div class="font-extrabold">{{ viewItem?.gmLoginId || '—' }}</div>
                <div v-if="viewItem?.gmDecisionAt" class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {{ fmtDateTime(viewItem.gmDecisionAt) }}
                </div>
                <div v-if="viewItem?.gmComment" class="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                  {{ viewItem.gmComment }}
                </div>
              </div>

              <div class="ui-frame p-2">
                <div class="text-[11px] text-slate-500 dark:text-slate-400">COO</div>
                <div class="font-extrabold">{{ viewItem?.cooLoginId || '—' }}</div>
                <div v-if="viewItem?.cooDecisionAt" class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {{ fmtDateTime(viewItem.cooDecisionAt) }}
                </div>
                <div v-if="viewItem?.cooComment" class="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                  {{ viewItem.cooComment }}
                </div>
              </div>
            </div>
          </div>

          <div class="flex justify-end gap-2 pt-1">
            <button class="ui-btn ui-btn-ghost" type="button" @click="closeView">Close</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.reason-cell {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.35;
}
</style>