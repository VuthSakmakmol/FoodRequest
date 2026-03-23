<!-- src/views/expat/admin/data/CentralData.vue -->
<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import * as XLSX from 'xlsx'

import api from '@/utils/api'
import { useToast } from '@/composables/useToast'

defineOptions({ name: 'CentralData' })

const { showToast } = useToast()

/* ───────────────── responsive ───────────────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────────────── state ───────────────── */
const loading = ref(false)
const exporting = ref(false)
const rows = ref([])
const total = ref(0)

/* ───────────────── filters ───────────────── */
const search = ref('')
const moduleFilter = ref('ALL') // ALL | LEAVE | FORGET_SCAN | SWAP_DAY
const statusFilter = ref('ALL')
const modeFilter = ref('ALL')
const from = ref('')
const to = ref('')

/* ───────────────── pagination ───────────────── */
const page = ref(1)
const pageSize = ref(25)
const pageSizeOptions = [10, 25, 50, 100]

const skip = computed(() => (page.value - 1) * pageSize.value)
const totalPages = computed(() =>
  Math.max(1, Math.ceil(total.value / Math.max(1, Number(pageSize.value || 25))))
)

/* ───────────────── helpers ───────────────── */
function s(v) {
  return String(v ?? '').trim()
}
function up(v) {
  return s(v).toUpperCase()
}
function fmtDate(v) {
  const x = s(v)
  return x || '—'
}
function fmtDT(iso) {
  const v = s(iso)
  if (!v) return '—'
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : '—'
}
function compactText(v) {
  return String(v || '').replace(/\s+/g, ' ').trim()
}
function briefText(v, max = 140) {
  const t = compactText(v)
  if (!t) return '—'
  if (t.length <= max) return t
  return `${t.slice(0, max).trimEnd()}…`
}
function rowNo(index) {
  return skip.value + index + 1
}

function moduleIcon(mod) {
  const m = up(mod)
  if (m === 'LEAVE') return 'fa-plane-departure'
  if (m === 'FORGET_SCAN') return 'fa-fingerprint'
  if (m === 'SWAP_DAY') return 'fa-right-left'
  return 'fa-layer-group'
}

function badgeClassForModule(mod) {
  const m = up(mod)
  if (m === 'LEAVE') {
    return 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/35 dark:text-sky-200 dark:ring-sky-900/45'
  }
  if (m === 'FORGET_SCAN') {
    return 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/35 dark:text-amber-200 dark:ring-amber-900/45'
  }
  if (m === 'SWAP_DAY') {
    return 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/35 dark:text-emerald-200 dark:ring-emerald-900/45'
  }
  return 'bg-slate-50 text-slate-700 ring-slate-200 dark:bg-slate-950/35 dark:text-slate-200 dark:ring-slate-800/55'
}

function stageBadgeClass(stage) {
  const x = up(stage)
  if (x === 'MANAGER') return 'ui-badge ui-badge-info'
  if (x === 'GM') return 'ui-badge ui-badge-warning'
  if (x === 'COO') return 'ui-badge ui-badge-success'
  if (x === 'FINAL') return 'ui-badge'
  return 'ui-badge'
}

function statusBadgeClass(status) {
  const x = up(status)
  if (x === 'APPROVED') return 'ui-badge ui-badge-success'
  if (x === 'REJECTED') return 'ui-badge ui-badge-danger'
  if (x === 'CANCELLED') return 'ui-badge'
  if (x.startsWith('PENDING')) return 'ui-badge ui-badge-warning'
  return 'ui-badge'
}

/* summary badges */
const currentCount = computed(() => rows.value.length)
const leaveCount = computed(() => rows.value.filter((r) => up(r.module) === 'LEAVE').length)
const forgetCount = computed(() => rows.value.filter((r) => up(r.module) === 'FORGET_SCAN').length)
const swapCount = computed(() => rows.value.filter((r) => up(r.module) === 'SWAP_DAY').length)

/* ───────────────── fetch ───────────────── */
async function fetchCentral() {
  loading.value = true
  try {
    const { data } = await api.get('/leave/reports/central', {
      params: {
        search: search.value,
        module: moduleFilter.value,
        status: statusFilter.value,
        approvalMode: modeFilter.value,
        from: from.value,
        to: to.value,
        limit: pageSize.value,
        skip: skip.value,
      },
    })

    rows.value = Array.isArray(data?.rows) ? data.rows : []
    total.value = Number(data?.total || 0)
  } catch (e) {
    showToast({ type: 'error', message: 'Failed to load report' })
  } finally {
    loading.value = false
  }
}

/* ───────────────── watches ───────────────── */
watch([search, moduleFilter, statusFilter, modeFilter, from, to, pageSize], () => {
  page.value = 1
  fetchCentral()
})
watch(page, () => fetchCentral())

/* ───────────────── pagination actions ───────────────── */
function prevPage() {
  if (page.value > 1) page.value--
}
function nextPage() {
  if (page.value < totalPages.value) page.value++
}
function clearFilters() {
  search.value = ''
  moduleFilter.value = 'ALL'
  statusFilter.value = 'ALL'
  modeFilter.value = 'ALL'
  from.value = ''
  to.value = ''
  pageSize.value = 25
  page.value = 1
  fetchCentral()
}

/* ───────────────── excel export ───────────────── */
async function exportExcel() {
  try {
    exporting.value = true
    showToast({ type: 'info', message: 'Preparing Excel...' })

    const { data } = await api.get('/leave/reports/central', {
      params: {
        search: search.value,
        module: moduleFilter.value,
        status: statusFilter.value,
        approvalMode: modeFilter.value,
        from: from.value,
        to: to.value,
        limit: 5000,
        skip: 0,
      },
    })

    const all = Array.isArray(data?.rows) ? data.rows : []

    const sheetRows = all.map((r, i) => ({
      No: i + 1,
      Module: r.module,
      RequestId: r.requestId,
      EmployeeId: r.employeeId,
      EmployeeName: r.employeeName,
      Department: r.department,
      ApprovalMode: r.approvalMode,
      Status: r.status,
      Stage: r.stage,
      DateFrom: r.dateFrom,
      DateTo: r.dateTo,
      Summary: r.summary,
      Reason: r.reason,
      CreatedAt: fmtDT(r.createdAt),
      UpdatedAt: fmtDT(r.updatedAt),
      ManagerDecisionAt: fmtDT(r.managerDecisionAt),
      GmDecisionAt: fmtDT(r.gmDecisionAt),
      CooDecisionAt: fmtDT(r.cooDecisionAt),
    }))

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows), 'Report')

    const legend = [
      { Key: 'Module', Meaning: 'LEAVE / FORGET_SCAN / SWAP_DAY' },
      { Key: 'Stage', Meaning: 'Derived from Status: MANAGER / GM / COO / FINAL' },
      { Key: 'DateFrom/DateTo', Meaning: 'Main request date range (Forget Scan is single day)' },
      { Key: 'Summary', Meaning: 'Compact human-readable description of the request' },
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(legend), 'Legend')

    XLSX.writeFile(wb, `report_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`)
    showToast({ type: 'success', message: 'Excel exported' })
  } catch (e) {
    showToast({ type: 'error', message: 'Export failed' })
  } finally {
    exporting.value = false
  }
}

/* ───────────────── lifecycle ───────────────── */
onMounted(() => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)
  fetchCentral()
})
onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
})
</script>

<template>
  <div class="ui-page min-h-screen w-full">
    <div class="w-full">
      <div class="ui-card rounded-none border-x-0 border-t-0 overflow-hidden">
        <!-- HERO -->
        <div class="ui-hero-gradient">
          <div class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <div class="text-[16px] font-extrabold text-white">Report</div>
                <span
                  class="rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-extrabold text-white ring-1 ring-inset ring-white/20"
                >
                  Admin
                </span>
              </div>

              <div class="mt-3 flex flex-wrap items-center gap-2">
                <span class="ui-badge ui-badge-info">Total: {{ total }}</span>
                <span class="ui-badge ui-badge-info">Current: {{ currentCount }}</span>
                <span class="ui-badge ui-badge-info">Leave: {{ leaveCount }}</span>
                <span class="ui-badge ui-badge-warning">Forget Scan: {{ forgetCount }}</span>
                <span class="ui-badge ui-badge-success">Swap Day: {{ swapCount }}</span>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <button
                class="ui-btn ui-btn-sm ui-btn-soft"
                type="button"
                :disabled="loading"
                @click="fetchCentral"
                title="Refresh"
              >
                <i class="fa-solid fa-rotate-right text-[11px]" />
                Refresh
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
                Export
              </button>

              <button
                class="ui-btn ui-btn-sm ui-btn-ghost"
                type="button"
                :disabled="loading"
                @click="clearFilters"
                title="Clear filters"
              >
                <i class="fa-solid fa-broom text-[11px]" />
                Clear
              </button>
            </div>
          </div>

          <!-- compact filter area -->
          <div class="mt-4 rounded-2xl border border-white/15 bg-white/10 p-3 backdrop-blur-sm">
            <div class="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-12">
              <div class="xl:col-span-3 min-w-0">
                <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">
                  Search
                </label>
                <div
                  class="flex items-center rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-[11px]
                         focus-within:border-white/35 focus-within:bg-white/15"
                >
                  <i class="fa-solid fa-magnifying-glass mr-2 text-white/75" />
                  <input
                    v-model="search"
                    type="text"
                    placeholder="Employee / name / dept / request ID / summary..."
                    class="w-full min-w-0 bg-transparent text-white placeholder:text-white/60 outline-none"
                  />
                </div>
              </div>

              <div class="xl:col-span-2">
                <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">
                  Module
                </label>
                <select v-model="moduleFilter" class="filter-select">
                  <option value="ALL">All Modules</option>
                  <option value="LEAVE">Leave</option>
                  <option value="FORGET_SCAN">Forget Scan</option>
                  <option value="SWAP_DAY">Swap Working Day</option>
                </select>
              </div>

              <div class="xl:col-span-2">
                <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">
                  Status
                </label>
                <select v-model="statusFilter" class="filter-select">
                  <option value="ALL">All Status</option>
                  <option value="PENDING_MANAGER">PENDING_MANAGER</option>
                  <option value="PENDING_GM">PENDING_GM</option>
                  <option value="PENDING_COO">PENDING_COO</option>
                  <option value="APPROVED">APPROVED</option>
                  <option value="REJECTED">REJECTED</option>
                  <option value="CANCELLED">CANCELLED</option>
                </select>
              </div>

              <div class="xl:col-span-2">
                <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">
                  Approval mode
                </label>
                <select v-model="modeFilter" class="filter-select">
                  <option value="ALL">All Modes</option>
                  <option value="MANAGER_AND_GM">MANAGER_AND_GM</option>
                  <option value="MANAGER_AND_COO">MANAGER_AND_COO</option>
                  <option value="GM_AND_COO">GM_AND_COO</option>
                  <option value="MANAGER_ONLY">MANAGER_ONLY</option>
                  <option value="GM_ONLY">GM_ONLY</option>
                  <option value="COO_ONLY">COO_ONLY</option>
                </select>
              </div>

              <div class="xl:col-span-1">
                <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">
                  From
                </label>
                <input
                  v-model="from"
                  type="date"
                  class="filter-input"
                  title="From"
                />
              </div>

              <div class="xl:col-span-2">
                <label class="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/80">
                  To
                </label>
                <input
                  v-model="to"
                  type="date"
                  class="filter-input"
                  title="To"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- BODY -->
        <div class="px-2 pb-3 pt-3 sm:px-4 lg:px-6">
          <div v-if="loading && !rows.length" class="ui-skeleton mb-2 h-14 w-full" />

          <!-- DESKTOP TABLE -->
          <div v-if="!isMobile" class="mt-0">
            <div class="ui-table-wrap ui-scrollbar overflow-x-auto overflow-y-hidden">
              <table class="ui-table min-w-[2800px]">
                <thead>
                  <tr>
                    <th class="ui-th w-[80px]">No</th>
                    <th class="ui-th w-[160px]">Module</th>
                    <th class="ui-th w-[180px]">Request ID</th>
                    <th class="ui-th w-[120px]">Emp ID</th>
                    <th class="ui-th w-[220px] text-left">Employee Name</th>
                    <th class="ui-th w-[180px] text-left">Department</th>
                    <th class="ui-th w-[180px]">Approval Mode</th>
                    <th class="ui-th w-[180px]">Status</th>
                    <th class="ui-th w-[120px]">Stage</th>
                    <th class="ui-th w-[120px]">Date From</th>
                    <th class="ui-th w-[120px]">Date To</th>
                    <th class="ui-th w-[360px] text-left">Summary</th>
                    <th class="ui-th w-[360px] text-left">Reason</th>
                    <th class="ui-th w-[170px]">Created At</th>
                    <th class="ui-th w-[170px]">Updated At</th>
                    <th class="ui-th w-[180px]">Manager Decision At</th>
                    <th class="ui-th w-[180px]">GM Decision At</th>
                    <th class="ui-th w-[180px]">COO Decision At</th>
                  </tr>
                </thead>

                <tbody>
                  <tr v-if="loading">
                    <td colspan="18" class="ui-td py-8 text-center opacity-70">
                      <i class="fa-solid fa-circle-notch fa-spin mr-2"></i>
                      Loading...
                    </td>
                  </tr>

                  <tr v-else-if="!rows.length">
                    <td colspan="18" class="ui-td py-8 text-center opacity-70">No data</td>
                  </tr>

                  <tr
                    v-else
                    v-for="(r, index) in rows"
                    :key="r.module + ':' + r.requestId"
                    class="ui-tr-hover"
                  >
                    <td class="ui-td whitespace-nowrap font-semibold">
                      {{ rowNo(index) }}
                    </td>

                    <td class="ui-td">
                      <span
                        class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1 whitespace-nowrap"
                        :class="badgeClassForModule(r.module)"
                      >
                        <i class="fa-solid" :class="moduleIcon(r.module)"></i>
                        {{ r.module || '—' }}
                      </span>
                    </td>

                    <td class="ui-td whitespace-nowrap font-medium">
                      {{ r.requestId || '—' }}
                    </td>

                    <td class="ui-td whitespace-nowrap font-medium">
                      {{ r.employeeId || '—' }}
                    </td>

                    <td class="ui-td text-left">
                      <div class="font-extrabold text-slate-900 dark:text-slate-50">
                        {{ r.employeeName || '—' }}
                      </div>
                    </td>

                    <td class="ui-td text-left">
                      {{ r.department || '—' }}
                    </td>

                    <td class="ui-td whitespace-nowrap text-xs font-semibold">
                      {{ r.approvalMode || '—' }}
                    </td>

                    <td class="ui-td">
                      <span :class="statusBadgeClass(r.status)">
                        {{ r.status || '—' }}
                      </span>
                    </td>

                    <td class="ui-td">
                      <span :class="stageBadgeClass(r.stage)">
                        {{ r.stage || '—' }}
                      </span>
                    </td>

                    <td class="ui-td whitespace-nowrap">
                      {{ fmtDate(r.dateFrom) }}
                    </td>

                    <td class="ui-td whitespace-nowrap">
                      {{ fmtDate(r.dateTo) }}
                    </td>

                    <td class="ui-td text-left">
                      <div class="line-clamp-3 font-medium">
                        {{ briefText(r.summary, 220) }}
                      </div>
                    </td>

                    <td class="ui-td text-left">
                      <div class="line-clamp-3 text-sm opacity-80">
                        {{ briefText(r.reason, 220) }}
                      </div>
                    </td>

                    <td class="ui-td whitespace-nowrap">
                      {{ fmtDT(r.createdAt) }}
                    </td>

                    <td class="ui-td whitespace-nowrap">
                      {{ fmtDT(r.updatedAt) }}
                    </td>

                    <td class="ui-td whitespace-nowrap">
                      {{ fmtDT(r.managerDecisionAt) }}
                    </td>

                    <td class="ui-td whitespace-nowrap">
                      {{ fmtDT(r.gmDecisionAt) }}
                    </td>

                    <td class="ui-td whitespace-nowrap">
                      {{ fmtDT(r.cooDecisionAt) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- MOBILE CARDS -->
          <div v-else class="mt-0 space-y-2">
            <div
              v-for="(r, index) in rows"
              :key="r.module + ':' + r.requestId"
              class="rounded-2xl border border-slate-200/60 bg-white/70 p-3 dark:border-slate-800/60 dark:bg-slate-950/40"
            >
              <div class="flex items-start justify-between gap-2">
                <span
                  class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1"
                  :class="badgeClassForModule(r.module)"
                >
                  <i class="fa-solid" :class="moduleIcon(r.module)"></i>
                  {{ r.module || '—' }}
                </span>

                <div class="text-right text-xs">
                  <div class="font-semibold text-slate-700 dark:text-slate-200">
                    #{{ rowNo(index) }}
                  </div>
                  <div class="mt-1">
                    <span :class="statusBadgeClass(r.status)">
                      {{ r.status || '—' }}
                    </span>
                  </div>
                </div>
              </div>

              <div class="mt-3 grid grid-cols-1 gap-2 text-sm">
                <div>
                  <div class="text-xs opacity-70">Request ID</div>
                  <div class="font-medium break-all">{{ r.requestId || '—' }}</div>
                </div>

                <div>
                  <div class="text-xs opacity-70">Employee</div>
                  <div class="font-semibold text-slate-900 dark:text-slate-50">
                    {{ r.employeeId || '—' }} — {{ r.employeeName || '—' }}
                  </div>
                  <div class="text-xs opacity-70">{{ r.department || '—' }}</div>
                </div>

                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <div class="text-xs opacity-70">Approval Mode</div>
                    <div class="font-medium">{{ r.approvalMode || '—' }}</div>
                  </div>
                  <div>
                    <div class="text-xs opacity-70">Stage</div>
                    <div>
                      <span :class="stageBadgeClass(r.stage)">
                        {{ r.stage || '—' }}
                      </span>
                    </div>
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <div class="text-xs opacity-70">Date From</div>
                    <div class="font-medium">{{ fmtDate(r.dateFrom) }}</div>
                  </div>
                  <div>
                    <div class="text-xs opacity-70">Date To</div>
                    <div class="font-medium">{{ fmtDate(r.dateTo) }}</div>
                  </div>
                </div>

                <div>
                  <div class="text-xs opacity-70">Summary</div>
                  <div class="font-medium">{{ r.summary || '—' }}</div>
                </div>

                <div>
                  <div class="text-xs opacity-70">Reason</div>
                  <div class="text-sm">{{ r.reason || '—' }}</div>
                </div>

                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <div class="text-xs opacity-70">Created At</div>
                    <div class="font-medium">{{ fmtDT(r.createdAt) }}</div>
                  </div>
                  <div>
                    <div class="text-xs opacity-70">Updated At</div>
                    <div class="font-medium">{{ fmtDT(r.updatedAt) }}</div>
                  </div>
                </div>

                <div class="grid grid-cols-1 gap-2">
                  <div>
                    <div class="text-xs opacity-70">Manager Decision At</div>
                    <div class="font-medium">{{ fmtDT(r.managerDecisionAt) }}</div>
                  </div>
                  <div>
                    <div class="text-xs opacity-70">GM Decision At</div>
                    <div class="font-medium">{{ fmtDT(r.gmDecisionAt) }}</div>
                  </div>
                  <div>
                    <div class="text-xs opacity-70">COO Decision At</div>
                    <div class="font-medium">{{ fmtDT(r.cooDecisionAt) }}</div>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="loading" class="py-6 text-center opacity-70">
              <i class="fa-solid fa-circle-notch fa-spin mr-2"></i>
              Loading...
            </div>
            <div v-else-if="!rows.length" class="py-6 text-center opacity-70">No data</div>
          </div>

          <!-- FOOTER PAGINATION -->
          <div
            class="ui-divider mt-3 flex flex-col gap-2 pt-3 text-[11px] text-slate-600 dark:text-slate-300 sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="flex items-center gap-2">
              <select v-model="pageSize" class="ui-select !w-auto !py-1.5 !text-[11px]">
                <option v-for="opt in pageSizeOptions" :key="'size-' + opt" :value="opt">
                  {{ opt }}
                </option>
              </select>

              <span class="text-[11px] text-slate-500 dark:text-slate-400">
                Showing {{ rows.length }} of {{ total }} • Page {{ page }} / {{ totalPages }}
              </span>
            </div>

            <div class="flex items-center justify-end gap-1">
              <button type="button" class="ui-pagebtn" :disabled="page <= 1" @click="page = 1">«</button>
              <button type="button" class="ui-pagebtn" :disabled="page <= 1" @click="prevPage">Prev</button>
              <button type="button" class="ui-pagebtn" :disabled="page >= totalPages" @click="nextPage">Next</button>
              <button type="button" class="ui-pagebtn" :disabled="page >= totalPages" @click="page = totalPages">»</button>
            </div>
          </div>
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

.filter-input::placeholder {
  color: rgba(255, 255, 255, 0.65);
}

.filter-input:focus,
.filter-select:focus {
  border-color: rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.14);
}

.filter-select option {
  color: #0f172a;
}

.ui-table-wrap {
  -webkit-overflow-scrolling: touch;
}

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.line-clamp-3 {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>