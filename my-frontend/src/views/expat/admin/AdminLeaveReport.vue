<!-- src/views/expat/admin/AdminLeaveReport.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { subscribeRoleIfNeeded, onSocket } from '@/utils/socket'

defineOptions({ name: 'AdminLeaveReport' })

const { showToast } = useToast()

/* ───────── responsive flag ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────── Filters ───────── */
const q = ref('')
const includeInactive = ref(false)
const department = ref('')
const managerLoginId = ref('')
const asOf = ref(dayjs().format('YYYY-MM-DD'))

const dateFrom = ref(dayjs().startOf('month').format('YYYY-MM-DD'))
const dateTo = ref(dayjs().format('YYYY-MM-DD'))

/* ───────── State ───────── */
const loading = ref(false)
const error = ref('')
const report = ref(null)

/* ───────── Pagination ───────── */
const page = ref(1)
const pageSize = ref(15)

/* ───────── Date validation ───────── */
const dateRangeOk = computed(() => {
  if (!dateFrom.value || !dateTo.value) return true
  return dateFrom.value <= dateTo.value
})

/* ───────── Helpers ───────── */
function num(v) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}
function fmtYMD(v) {
  if (!v) return '—'
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD') : String(v)
}
function safeText(v) {
  return String(v ?? '').trim()
}

const TYPE_ORDER = computed(() => report.value?.meta?.typeOrder || ['AL', 'SP', 'MC', 'MA', 'UL'])

function balOf(emp, code) {
  const c = String(code || '').toUpperCase()
  return (emp?.balances || []).find((b) => String(b.leaveTypeCode || '').toUpperCase() === c) || null
}

function statusLabel(s) {
  const st = String(s || '').toUpperCase()
  if (st === 'PENDING_MANAGER') return 'Pending (Mgr)'
  if (st === 'PENDING_GM') return 'Pending (GM)'
  if (st === 'APPROVED') return 'Approved'
  if (st === 'REJECTED') return 'Rejected'
  if (st === 'CANCELLED') return 'Cancelled'
  return st || '—'
}
function statusBadgeClass(s) {
  const st = String(s || '').toUpperCase()
  if (st === 'APPROVED')
    return 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200 dark:border-emerald-900/40'
  if (st === 'REJECTED')
    return 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-900/40'
  if (st === 'CANCELLED')
    return 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-800'
  if (st === 'PENDING_MANAGER' || st === 'PENDING_GM')
    return 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/25 dark:text-amber-200 dark:border-amber-900/40'
  return 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-800'
}

/* ───────── API ───────── */
async function fetchReport(silent = false) {
  loading.value = true
  error.value = ''
  try {
    const params = {
      q: safeText(q.value) || undefined,
      includeInactive: includeInactive.value ? '1' : undefined,
      department: safeText(department.value) || undefined,
      managerLoginId: safeText(managerLoginId.value) || undefined,
      asOf: safeText(asOf.value) || undefined,
      dateFrom: dateRangeOk.value ? safeText(dateFrom.value) || undefined : undefined,
      dateTo: dateRangeOk.value ? safeText(dateTo.value) || undefined : undefined,
      limit: 500,
    }

    // If user clears range, backend should treat as "all"
    if (!dateFrom.value || !dateTo.value) {
      delete params.dateFrom
      delete params.dateTo
    }

    const res = await api.get('/admin/leave/reports/summary', { params })
    report.value = res?.data || null
  } catch (e) {
    console.error('fetchReport error', e)
    error.value = e?.response?.data?.message || 'Failed to load report.'
    if (!silent) showToast({ type: 'error', title: 'Report load failed', message: error.value })
  } finally {
    loading.value = false
  }
}

/* ───────── KPIs ───────── */
const reqCountsByStatus = computed(() => report.value?.leaveRequests?.countsByStatus || {})
const totalRequests = computed(() => num(report.value?.meta?.counts?.leaveRequests))
const pendingRequests = computed(
  () => num(reqCountsByStatus.value.PENDING_MANAGER) + num(reqCountsByStatus.value.PENDING_GM)
)
const approvedRequests = computed(() => num(reqCountsByStatus.value.APPROVED))
const rejectedRequests = computed(() => num(reqCountsByStatus.value.REJECTED))
const cancelledRequests = computed(() => num(reqCountsByStatus.value.CANCELLED))

/* ───────── Employees pagination ───────── */
const employeesAll = computed(() => report.value?.employees || [])
const pageCount = computed(() => Math.max(1, Math.ceil(employeesAll.value.length / pageSize.value)))
const employeesPage = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return employeesAll.value.slice(start, start + pageSize.value)
})
function nextPage() {
  if (page.value < pageCount.value) page.value += 1
}
function prevPage() {
  if (page.value > 1) page.value -= 1
}

/* ───────── Leave usage ───────── */
const usageMode = ref('DAYS') // DAYS | COUNT
const daysByType = computed(() => report.value?.leaveRequests?.daysByType || {})
const countsByType = computed(() => report.value?.leaveRequests?.countsByType || {})

const usageRows = computed(() => {
  const codes = Object.keys({ ...daysByType.value, ...countsByType.value })
    .map((c) => String(c).toUpperCase())
    .filter(Boolean)

  const order = TYPE_ORDER.value
  const unique = [...new Set([...order, ...codes])]

  const rows = unique.map((code) => ({
    code,
    days: num(daysByType.value[code]),
    count: num(countsByType.value[code]),
  }))

  rows.sort((a, b) => (usageMode.value === 'COUNT' ? b.count - a.count : b.days - a.days))
  return rows
})

const usageTotal = computed(() => {
  if (usageMode.value === 'COUNT') return usageRows.value.reduce((a, r) => a + num(r.count), 0)
  return usageRows.value.reduce((a, r) => a + num(r.days), 0)
})
function usageValue(r) {
  return usageMode.value === 'COUNT' ? num(r.count) : num(r.days)
}
function usagePct(r) {
  const total = num(usageTotal.value)
  if (total <= 0) return 0
  return Math.round((usageValue(r) / total) * 100)
}

/* ───────── byMonth ───────── */
const byMonth = computed(() => report.value?.leaveRequests?.byMonth || {})
const monthRows = computed(() => {
  const keys = Object.keys(byMonth.value || {}).filter(Boolean).sort()
  return keys.map((k) => ({
    month: k,
    count: num(byMonth.value[k]?.count),
    days: num(byMonth.value[k]?.days),
  }))
})

/* ───────── Excel Export ───────── */
async function exportEmployeesExcel() {
  try {
    const XLSX = await import('xlsx')
    const codes = TYPE_ORDER.value

    const rows = employeesAll.value.map((emp) => {
      const base = {
        managerLoginId: safeText(emp.managerLoginId),
        employeeId: safeText(emp.employeeId),
        name: safeText(emp.name),
        department: safeText(emp.department),
        joinDate: fmtYMD(emp.joinDate),
        contractDate: fmtYMD(emp.contractDate),
        alCarry: num(emp.alCarry),
        balancesAsOf: safeText(emp.balancesAsOf),
        isActive: emp.isActive ? 'YES' : 'NO',
      }

      for (const code of codes) {
        const b = balOf(emp, code) || {}
        base[`${code}_Used`] = num(b.used)
        base[`${code}_Remaining`] = num(b.remaining)
      }

      return base
    })

    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Employees')

    const from = dateFrom.value && dateTo.value ? `${dateFrom.value}_to_${dateTo.value}` : 'all'
    XLSX.writeFile(wb, `leave_report_employees_${from}.xlsx`)

    showToast({ type: 'success', title: 'Exported', message: 'Employees exported to Excel.' })
  } catch (e) {
    console.error('exportEmployeesExcel error', e)
    showToast({ type: 'error', title: 'Export failed', message: e?.message || 'Cannot export excel.' })
  }
}

async function exportRequestsExcel() {
  try {
    const XLSX = await import('xlsx')

    const rows = (report.value?.leaveRequests?.recent || []).map((r) => ({
      requestId: safeText(r._id),
      employeeId: safeText(r.employeeId),
      leaveTypeCode: safeText(r.leaveTypeCode),
      startDate: fmtYMD(r.startDate),
      endDate: fmtYMD(r.endDate),
      totalDays: num(r.totalDays),
      status: safeText(r.status),
      managerLoginId: safeText(r.managerLoginId),
      gmLoginId: safeText(r.gmLoginId),
      createdAt: r.createdAt ? dayjs(r.createdAt).format('YYYY-MM-DD HH:mm') : '',
    }))

    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'LeaveRequests')

    const from = dateFrom.value && dateTo.value ? `${dateFrom.value}_to_${dateTo.value}` : 'all'
    XLSX.writeFile(wb, `leave_report_requests_${from}.xlsx`)

    showToast({ type: 'success', title: 'Exported', message: 'Requests exported to Excel.' })
  } catch (e) {
    console.error('exportRequestsExcel error', e)
    showToast({ type: 'error', title: 'Export failed', message: e?.message || 'Cannot export excel.' })
  }
}

/* ───────── Debounce search ───────── */
let tmr = null
watch(q, () => {
  if (tmr) clearTimeout(tmr)
  tmr = setTimeout(() => {
    page.value = 1
    fetchReport(true)
  }, 300)
})

watch([includeInactive, department, managerLoginId, asOf], () => {
  page.value = 1
  fetchReport(true)
})

watch([dateFrom, dateTo], () => {
  page.value = 1
  if (!dateRangeOk.value) return
  fetchReport(true)
})

/* ───────── realtime refresh ───────── */
const offHandlers = []
let refreshTimer = null
function triggerRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => fetchReport(true), 250)
}

function setupRealtime() {
  // join admin rooms
  subscribeRoleIfNeeded()

  // refresh report when leave requests / profiles change
  offHandlers.push(
    onSocket('leave:req:created', triggerRefresh),
    onSocket('leave:req:updated', triggerRefresh),
    onSocket('leave:req:manager-decision', triggerRefresh),
    onSocket('leave:req:gm-decision', triggerRefresh),
    onSocket('leave:req:coo-decision', triggerRefresh),
    onSocket('leave:req:cancelled', triggerRefresh),

    onSocket('leave:profile:created', triggerRefresh),
    onSocket('leave:profile:updated', triggerRefresh),
    onSocket('leave:profile:recalculated', triggerRefresh)
  )
}

function teardownRealtime() {
  offHandlers.forEach((off) => {
    try {
      off && off()
    } catch {}
  })
  offHandlers.length = 0
}

/* ───────── lifecycle ───────── */
onMounted(() => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)
  fetchReport(true)
  setupRealtime()
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
  if (tmr) clearTimeout(tmr)
  if (refreshTimer) clearTimeout(refreshTimer)
  teardownRealtime()
})
</script>

<template>
  <!-- ✅ FULL EDGE: no max-w wrapper, no wasted space -->
  <div class="w-full min-h-[calc(100vh-48px)]">
    <div class="w-full rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <!-- Header -->
      <div class="rounded-t-2xl bg-gradient-to-r from-emerald-600 via-teal-500 to-sky-500 px-4 py-3 text-white">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p class="text-[10px] uppercase tracking-[0.25em] text-emerald-100/80">Expat Leave</p>
            <p class="text-sm font-semibold">Admin Leave Report</p>
            <p class="text-[11px] text-emerald-50/90">
              Compact analytics + balances. Export employees and requests anytime.
            </p>
          </div>

          <div class="flex flex-1 flex-wrap items-end justify-end gap-3">
            <div class="min-w-[240px] w-full sm:w-[360px]">
              <label class="mb-1 block text-[11px] font-medium text-emerald-50">Search</label>
              <div
                class="flex items-center rounded-xl border border-emerald-200/80 bg-emerald-900/20 px-2.5 py-1.5 text-xs"
              >
                <i class="fa-solid fa-magnifying-glass mr-2 text-xs text-emerald-50/80" />
                <input
                  v-model="q"
                  type="text"
                  placeholder="Employee ID, name, dept, manager..."
                  class="flex-1 bg-transparent text-[11px] outline-none placeholder:text-emerald-100/80"
                />
              </div>
            </div>

            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
              :disabled="loading || !report"
              @click="exportEmployeesExcel"
            >
              <i class="fa-solid fa-file-excel text-[11px]" />
              Export Employees
            </button>

            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-indigo-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
              :disabled="loading || !report"
              @click="exportRequestsExcel"
            >
              <i class="fa-solid fa-file-excel text-[11px]" />
              Export Requests
            </button>

            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-white/15 disabled:opacity-60"
              :disabled="loading"
              @click="fetchReport(false)"
            >
              <i class="fa-solid fa-rotate text-[11px]" :class="loading ? 'fa-spin' : ''" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <!-- Body -->
      <div class="space-y-3 px-2 pb-2 pt-3 sm:px-3 sm:pb-3 lg:px-4 xl:px-5">
        <!-- Filters bar -->
        <div class="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/40">
          <div class="grid grid-cols-1 gap-2 md:grid-cols-12">
            <div class="md:col-span-2">
              <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Date From</label>
              <input v-model="dateFrom" type="date" class="input-mini" />
            </div>

            <div class="md:col-span-2">
              <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Date To</label>
              <input v-model="dateTo" type="date" class="input-mini" />
              <p v-if="!dateRangeOk" class="mt-1 text-[11px] text-rose-600 dark:text-rose-300">
                Date From cannot be after Date To.
              </p>
            </div>

            <div class="md:col-span-2">
              <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">As of</label>
              <input v-model="asOf" type="date" class="input-mini" />
            </div>

            <div class="md:col-span-3">
              <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Department</label>
              <input v-model="department" type="text" placeholder="HR, IT..." class="input-mini" />
            </div>

            <div class="md:col-span-3">
              <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Manager Login ID</label>
              <input v-model="managerLoginId" type="text" placeholder="Manager employeeId" class="input-mini" />
            </div>

            <div class="md:col-span-12 flex flex-wrap items-center justify-between gap-2 pt-1">
              <label class="inline-flex items-center gap-2 text-[11px] text-slate-700 dark:text-slate-200">
                <input v-model="includeInactive" type="checkbox" class="h-4 w-4 rounded border-slate-300 dark:border-slate-700" />
                Include inactive profiles
              </label>

              <div class="text-[11px] text-slate-500 dark:text-slate-400">
                <span class="font-semibold text-slate-700 dark:text-slate-200">Showing:</span>
                {{ report?.meta?.counts?.profiles ?? 0 }} profiles ·
                {{ report?.meta?.counts?.leaveRequests ?? 0 }} leave requests ·
                {{ report?.meta?.counts?.replaceDays ?? 0 }} replace days
              </div>
            </div>
          </div>

          <div
            v-if="error"
            class="mt-2 rounded-md border border-rose-400 bg-rose-50 px-3 py-2 text-[11px] text-rose-700
                   dark:border-rose-500/70 dark:bg-rose-950/40 dark:text-rose-100"
          >
            {{ error }}
          </div>
        </div>

        <!-- KPI pills -->
        <div class="flex flex-wrap gap-2">
          <div class="kpi-pill">
            <span class="kpi-title">Total</span>
            <span class="kpi-value">{{ totalRequests }}</span>
          </div>

          <div class="kpi-pill kpi-amber">
            <span class="kpi-title">Pending</span>
            <span class="kpi-value">{{ pendingRequests }}</span>
            <span class="kpi-sub">Mgr {{ reqCountsByStatus?.PENDING_MANAGER ?? 0 }} · GM {{ reqCountsByStatus?.PENDING_GM ?? 0 }}</span>
          </div>

          <div class="kpi-pill kpi-emerald">
            <span class="kpi-title">Approved</span>
            <span class="kpi-value">{{ approvedRequests }}</span>
          </div>

          <div class="kpi-pill kpi-rose">
            <span class="kpi-title">Rejected</span>
            <span class="kpi-value">{{ rejectedRequests }}</span>
          </div>

          <div class="kpi-pill">
            <span class="kpi-title">Cancelled</span>
            <span class="kpi-value">{{ cancelledRequests }}</span>
          </div>
        </div>

        <!-- Analytics -->
        <div class="grid gap-3 xl:grid-cols-12">
          <!-- Usage -->
          <div class="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 xl:col-span-6">
            <div class="flex items-center justify-between gap-2">
              <div>
                <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">Most Used Leave Types</div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400">Rank by days or request count.</div>
              </div>

              <div class="inline-flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-950">
                <button
                  type="button"
                  class="rounded-lg px-3 py-1.5 text-[11px] font-semibold"
                  :class="usageMode==='DAYS'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'"
                  @click="usageMode='DAYS'"
                >
                  By Days
                </button>
                <button
                  type="button"
                  class="rounded-lg px-3 py-1.5 text-[11px] font-semibold"
                  :class="usageMode==='COUNT'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'"
                  @click="usageMode='COUNT'"
                >
                  By Count
                </button>
              </div>
            </div>

            <div class="mt-3 space-y-2">
              <div v-for="r in usageRows.slice(0, 8)" :key="r.code" class="flex items-center gap-3">
                <div class="w-10 text-[11px] font-semibold text-slate-700 dark:text-slate-200">{{ r.code }}</div>
                <div class="flex-1">
                  <div class="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div class="h-2 rounded-full bg-emerald-600" :style="{ width: usagePct(r) + '%' }" />
                  </div>
                </div>
                <div class="w-24 text-right text-[11px] text-slate-500 dark:text-slate-300">
                  <span class="font-semibold text-slate-900 dark:text-white">{{ usageValue(r) }}</span>
                  <span class="ml-2">({{ usagePct(r) }}%)</span>
                </div>
              </div>

              <p v-if="usageRows.length === 0" class="py-3 text-center text-[11px] text-slate-500 dark:text-slate-400">
                No usage data.
              </p>
            </div>
          </div>

          <!-- Monthly -->
          <div class="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 xl:col-span-6">
            <div>
              <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">Monthly Trend</div>
              <div class="text-[11px] text-slate-500 dark:text-slate-400">Requests + total days per month.</div>
            </div>

            <div class="mt-3 overflow-auto">
              <table class="min-w-full border-collapse text-[12px] text-slate-700 dark:text-slate-100">
                <thead
                  class="border-b border-slate-200 bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-500
                         dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300"
                >
                  <tr>
                    <th class="table-th">Month</th>
                    <th class="table-th text-right">Requests</th>
                    <th class="table-th text-right">Days</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="m in monthRows.slice(-12)" :key="m.month" class="border-b border-slate-200 dark:border-slate-700">
                    <td class="table-td font-mono">{{ m.month }}</td>
                    <td class="table-td text-right">{{ m.count }}</td>
                    <td class="table-td text-right">{{ m.days }}</td>
                  </tr>

                  <tr v-if="monthRows.length === 0">
                    <td colspan="3" class="py-5 text-center text-[11px] text-slate-500 dark:text-slate-400">
                      No monthly data.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- Employees balances -->
        <div class="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div class="border-b border-slate-200 bg-slate-50/80 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-950/40">
            <div class="flex items-center justify-between gap-2">
              <div>
                <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">Employees Balances</div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400">
                  Showing "Used" + "Remaining" (as of {{ asOf || '—' }}).
                </div>
              </div>
              <div class="text-[11px] text-slate-500 dark:text-slate-400">
                Page {{ page }} / {{ pageCount }} · {{ employeesAll.length }} employees
              </div>
            </div>
          </div>

          <!-- Mobile cards -->
          <div v-if="isMobile" class="space-y-2 p-3">
            <article
              v-for="emp in employeesPage"
              :key="emp.employeeId"
              class="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950"
            >
              <div class="flex items-start justify-between gap-2">
                <div>
                  <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">
                    <span class="font-mono">{{ emp.employeeId }}</span> — {{ emp.name || '—' }}
                  </div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">{{ emp.department || '—' }}</div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    Join: <span class="font-medium text-slate-700 dark:text-slate-100">{{ fmtYMD(emp.joinDate) }}</span>
                    · Contract: <span class="font-medium text-slate-700 dark:text-slate-100">{{ fmtYMD(emp.contractDate) }}</span>
                  </div>
                </div>

                <span
                  class="rounded-full border px-2 py-1 text-[10px]"
                  :class="emp.isActive
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200'
                    : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200'"
                >
                  {{ emp.isActive ? 'Active' : 'Inactive' }}
                </span>
              </div>

              <div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div
                  v-for="code in TYPE_ORDER"
                  :key="code"
                  class="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-[10px] dark:border-slate-800 dark:bg-slate-900"
                >
                  <div class="flex items-center justify-between">
                    <span class="font-semibold">{{ code }}</span>
                    <span class="font-semibold text-slate-700 dark:text-slate-100">
                      U{{ num(balOf(emp, code)?.used) }}
                    </span>
                  </div>
                  <div class="mt-1 text-[10px] text-slate-500 dark:text-slate-300">
                    Remaining: <span class="font-semibold">R{{ num(balOf(emp, code)?.remaining) }}</span>
                  </div>
                </div>
              </div>
            </article>

            <div class="flex items-center justify-between pt-1">
              <button
                class="rounded-full px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200/70 dark:text-slate-200 dark:hover:bg-slate-800 disabled:opacity-50"
                @click="prevPage"
                :disabled="page<=1"
              >
                <i class="fa-solid fa-chevron-left mr-2 text-[11px]" /> Prev
              </button>

              <button
                class="rounded-full px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200/70 dark:text-slate-200 dark:hover:bg-slate-800 disabled:opacity-50"
                @click="nextPage"
                :disabled="page>=pageCount"
              >
                Next <i class="fa-solid fa-chevron-right ml-2 text-[11px]" />
              </button>
            </div>
          </div>

          <!-- Desktop table -->
          <div v-else class="overflow-x-auto">
            <table class="table-fixed min-w-full border-collapse text-[12px] text-slate-700 dark:text-slate-100">
              <colgroup>
                <col style="width: 128px;" />
                <col style="width: 220px;" />
                <col style="width: 220px;" />
                <col style="width: 120px;" />
                <col style="width: 120px;" />
                <col v-for="code in TYPE_ORDER" :key="'col-'+code" style="width: 110px;" />
                <col style="width: 90px;" />
              </colgroup>

              <thead
                class="border-b border-slate-200 bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-500
                       dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300"
              >
                <tr>
                  <th class="table-th">Employee ID</th>
                  <th class="table-th">Name</th>
                  <th class="table-th">Department</th>
                  <th class="table-th whitespace-nowrap">Join Date</th>
                  <th class="table-th whitespace-nowrap">Contract</th>
                  <th v-for="code in TYPE_ORDER" :key="'h-'+code" class="table-th text-center">{{ code }}</th>
                  <th class="table-th text-center">Active</th>
                </tr>
              </thead>

              <tbody>
                <tr
                  v-for="emp in employeesPage"
                  :key="emp.employeeId"
                  class="border-b border-slate-200 hover:bg-slate-50/80 dark:border-slate-700 dark:hover:bg-slate-900/70"
                >
                  <td class="table-td truncate font-mono">{{ emp.employeeId || '—' }}</td>
                  <td class="table-td truncate">
                    <span class="font-medium text-slate-900 dark:text-slate-50">{{ emp.name || '—' }}</span>
                  </td>
                  <td class="table-td truncate">{{ emp.department || '—' }}</td>
                  <td class="table-td whitespace-nowrap font-mono">{{ fmtYMD(emp.joinDate) }}</td>
                  <td class="table-td whitespace-nowrap font-mono">{{ fmtYMD(emp.contractDate) }}</td>

                  <td
                    v-for="code in TYPE_ORDER"
                    :key="emp.employeeId + '-' + code"
                    class="table-td align-middle text-center"
                  >
                    <div class="bal-box">
                      <div class="bal-top">U{{ num(balOf(emp, code)?.used) }}</div>
                      <div class="bal-bot">R{{ num(balOf(emp, code)?.remaining) }}</div>
                    </div>
                  </td>

                  <td class="table-td align-middle text-center">
                    <span
                      class="inline-flex justify-center rounded-full border px-2 py-1 text-[10px]"
                      :class="emp.isActive
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200'
                        : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200'"
                    >
                      {{ emp.isActive ? 'YES' : 'NO' }}
                    </span>
                  </td>
                </tr>

                <tr v-if="employeesPage.length === 0">
                  <td
                    :colspan="6 + TYPE_ORDER.length"
                    class="py-6 text-center text-[11px] text-slate-500 dark:text-slate-400"
                  >
                    No employees found.
                  </td>
                </tr>
              </tbody>
            </table>

            <div class="flex items-center justify-between px-3 py-2">
              <button
                class="rounded-full px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200/70 dark:text-slate-200 dark:hover:bg-slate-800 disabled:opacity-50"
                @click="prevPage"
                :disabled="page<=1"
              >
                <i class="fa-solid fa-chevron-left mr-2 text-[11px]" /> Prev
              </button>

              <div class="text-[11px] text-slate-500 dark:text-slate-400">
                Showing {{ employeesAll.length ? (page - 1) * pageSize + 1 : 0 }}–{{ Math.min(page * pageSize, employeesAll.length) }}
                of {{ employeesAll.length }}
              </div>

              <button
                class="rounded-full px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200/70 dark:text-slate-200 dark:hover:bg-slate-800 disabled:opacity-50"
                @click="nextPage"
                :disabled="page>=pageCount"
              >
                Next <i class="fa-solid fa-chevron-right ml-2 text-[11px]" />
              </button>
            </div>
          </div>
        </div>

        <!-- Recent Leave Requests -->
        <div class="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div class="border-b border-slate-200 bg-slate-50/80 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-950/40">
            <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">Recent Leave Requests</div>
            <div class="text-[11px] text-slate-500 dark:text-slate-400">Latest activity in your selected date range.</div>
          </div>

          <div class="overflow-x-auto">
            <table class="min-w-full border-collapse text-[12px] text-slate-700 dark:text-slate-100">
              <thead
                class="border-b border-slate-200 bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-500
                       dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300"
              >
                <tr>
                  <th class="table-th">Employee</th>
                  <th class="table-th">Type</th>
                  <th class="table-th">Dates</th>
                  <th class="table-th text-right">Days</th>
                  <th class="table-th">Status</th>
                  <th class="table-th">Created</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="r in (report?.leaveRequests?.recent || [])"
                  :key="r._id"
                  class="border-b border-slate-200 dark:border-slate-700"
                >
                  <td class="table-td font-mono">{{ r.employeeId }}</td>
                  <td class="table-td">
                    <span class="inline-flex rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-semibold dark:border-slate-700">
                      {{ r.leaveTypeCode }}
                    </span>
                  </td>
                  <td class="table-td whitespace-nowrap font-mono">
                    {{ fmtYMD(r.startDate) }} → {{ fmtYMD(r.endDate) }}
                  </td>
                  <td class="table-td text-right font-semibold">{{ num(r.totalDays) }}</td>
                  <td class="table-td">
                    <span class="inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold" :class="statusBadgeClass(r.status)">
                      {{ statusLabel(r.status) }}
                    </span>
                  </td>
                  <td class="table-td font-mono text-[11px]">
                    {{ r.createdAt ? dayjs(r.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
                  </td>
                </tr>

                <tr v-if="!(report?.leaveRequests?.recent || []).length">
                  <td colspan="6" class="py-6 text-center text-[11px] text-slate-500 dark:text-slate-400">
                    No recent requests.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Loading skeleton -->
        <div v-if="loading" class="space-y-2">
          <div class="h-10 w-full animate-pulse rounded-xl bg-slate-200/90 dark:bg-slate-800/70" />
          <div class="h-14 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/60" />
          <div class="h-14 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/60" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.table-th { padding: 8px 10px; text-align: left; font-size: 11px; font-weight: 800; white-space: nowrap; }
.table-td { padding: 10px 10px; vertical-align: middle; }
.table-fixed { table-layout: fixed; }

/* compact inputs */
.input-mini{
  width: 100%;
  border-radius: 0.75rem;
  border: 1px solid rgb(203 213 225);
  background: white;
  padding: 6px 10px;
  font-size: 12px;
  outline: none;
}
:global(.dark) .input-mini{
  border-color: rgb(51 65 85);
  background: rgb(2 6 23 / 0.6);
  color: rgb(226 232 240);
}

/* KPI pills */
.kpi-pill{
  display:flex;
  align-items:baseline;
  gap:10px;
  padding: 8px 12px;
  border-radius: 9999px;
  border: 1px solid rgb(226 232 240);
  background: rgb(248 250 252);
  color: rgb(15 23 42);
}
:global(.dark) .kpi-pill{
  border-color: rgb(30 41 59);
  background: rgb(2 6 23 / 0.35);
  color: rgb(226 232 240);
}
.kpi-title{ font-size: 11px; font-weight: 700; opacity: .85; }
.kpi-value{ font-size: 14px; font-weight: 900; }
.kpi-sub{ font-size: 11px; opacity: .75; }

.kpi-amber{ border-color: rgb(253 230 138); background: rgb(255 251 235); }
:global(.dark) .kpi-amber{ border-color: rgb(120 53 15 / .6); background: rgb(69 26 3 / .25); }

.kpi-emerald{ border-color: rgb(167 243 208); background: rgb(236 253 245); }
:global(.dark) .kpi-emerald{ border-color: rgb(6 78 59 / .6); background: rgb(6 95 70 / .2); }

.kpi-rose{ border-color: rgb(254 205 211); background: rgb(255 241 242); }
:global(.dark) .kpi-rose{ border-color: rgb(136 19 55 / .6); background: rgb(76 5 25 / .25); }

/* tidy balance box */
.bal-box{
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  gap: 2px;
  min-height: 40px;
  padding: 6px 8px;
  border-radius: 14px;
  border: 1px solid rgb(226 232 240);
  background: rgb(248 250 252);
}
:global(.dark) .bal-box{
  border-color: rgb(30 41 59);
  background: rgb(2 6 23 / 0.35);
}
.bal-top{
  font-size: 11px;
  font-weight: 900;
  color: rgb(15 23 42);
}
:global(.dark) .bal-top{ color: rgb(226 232 240); }
.bal-bot{
  font-size: 10px;
  font-weight: 800;
  color: rgb(71 85 105);
}
:global(.dark) .bal-bot{ color: rgb(148 163 184); }
</style>
