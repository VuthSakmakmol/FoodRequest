<!-- src/views/expat/admin/data/CentralData.vue
  ✅ CENTRAL DATA (Admin)
  ✅ Unified: Leave + Forget Scan + Swap Working Day
  ✅ NO attachments
  ✅ Enterprise UI pattern
  ✅ Excel export (xlsx) of CURRENT FILTERS
  ✅ Responsive: desktop table + mobile cards
  ✅ IMPORTANT: Desktop table supports horizontal scroll (long/wide tables)
-->

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
onMounted(() => {
  updateIsMobile()
  window.addEventListener('resize', updateIsMobile)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateIsMobile)
})

/* ───────────────── state ───────────────── */
const loading = ref(false)
const rows = ref([])
const total = ref(0)

/* ───────────────── filters ───────────────── */
const search = ref('')
const moduleFilter = ref('ALL') // ALL | LEAVE | FORGET_SCAN | SWAP_DAY
const statusFilter = ref('ALL') // ALL | PENDING_MANAGER | ...
const modeFilter = ref('ALL') // ALL | MANAGER_AND_GM | ...

const from = ref('')
const to = ref('')

/* ───────────────── pagination ───────────────── */
const page = ref(1)
const pageSize = ref(25)

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
  if (!v) return ''
  return dayjs(v).format('YYYY-MM-DD HH:mm')
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
  if (m === 'LEAVE')
    return 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/35 dark:text-sky-200 dark:ring-sky-900/45'
  if (m === 'FORGET_SCAN')
    return 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/35 dark:text-amber-200 dark:ring-amber-900/45'
  if (m === 'SWAP_DAY')
    return 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/35 dark:text-emerald-200 dark:ring-emerald-900/45'
  return 'bg-slate-50 text-slate-700 ring-slate-200 dark:bg-slate-950/35 dark:text-slate-200 dark:ring-slate-800/55'
}

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
    showToast('Failed to load Central Data', 'error')
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
onMounted(() => fetchCentral())

/* ───────────────── pagination actions ───────────────── */
function prevPage() {
  if (page.value > 1) page.value--
}
function nextPage() {
  if (page.value < totalPages.value) page.value++
}

/* ───────────────── excel export ───────────────── */
async function exportExcel() {
  try {
    showToast('Preparing Excel...', 'info')

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
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows), 'Central Data')

    const legend = [
      { Key: 'Module', Meaning: 'LEAVE / FORGET_SCAN / SWAP_DAY' },
      { Key: 'Stage', Meaning: 'Derived from Status: MANAGER / GM / COO / FINAL' },
      { Key: 'DateFrom/DateTo', Meaning: 'Main request date range (Forget Scan is single day)' },
      { Key: 'Summary', Meaning: 'Compact human-readable description of the request' },
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(legend), 'Legend')

    XLSX.writeFile(wb, `central_data_${dayjs().format('YYYYMMDD_HHmm')}.xlsx`)
    showToast('Excel exported', 'success')
  } catch (e) {
    showToast('Export failed', 'error')
  }
}
</script>

<template>
  <div class="ui-page min-h-screen w-full">
    <div class="ui-container-edge">
      <!-- HERO -->
      <div class="ui-card ui-hero-gradient rounded-none border-x-0 border-t-0">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-xl font-semibold">Central Data</div>
            <div class="text-sm opacity-80">
              Unified report for Leave, Forget Scan, and Swap Working Day (no attachments)
            </div>
          </div>

          <button class="ui-btn ui-btn-primary" @click="exportExcel" :disabled="loading">
            <i class="fa-solid fa-file-export mr-2"></i>
            Export Excel
          </button>
        </div>

        <!-- FILTERS -->
        <div class="mt-4 grid grid-cols-1 md:grid-cols-6 gap-2">
          <div class="md:col-span-2">
            <input
              v-model="search"
              class="ui-input w-full"
              placeholder="Search employee/name/department/summary..."
            />
          </div>

          <select v-model="moduleFilter" class="ui-input">
            <option value="ALL">All Modules</option>
            <option value="LEAVE">Leave</option>
            <option value="FORGET_SCAN">Forget Scan</option>
            <option value="SWAP_DAY">Swap Working Day</option>
          </select>

          <select v-model="statusFilter" class="ui-input">
            <option value="ALL">All Status</option>
            <option value="PENDING_MANAGER">PENDING_MANAGER</option>
            <option value="PENDING_GM">PENDING_GM</option>
            <option value="PENDING_COO">PENDING_COO</option>
            <option value="APPROVED">APPROVED</option>
            <option value="REJECTED">REJECTED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>

          <select v-model="modeFilter" class="ui-input">
            <option value="ALL">All Modes</option>
            <option value="MANAGER_AND_GM">MANAGER_AND_GM</option>
            <option value="MANAGER_AND_COO">MANAGER_AND_COO</option>
            <option value="GM_AND_COO">GM_AND_COO</option>
            <option value="MANAGER_ONLY">MANAGER_ONLY</option>
            <option value="GM_ONLY">GM_ONLY</option>
          </select>

          <div class="flex gap-2">
            <input v-model="from" class="ui-input w-full" placeholder="From (YYYY-MM-DD)" />
            <input v-model="to" class="ui-input w-full" placeholder="To (YYYY-MM-DD)" />
          </div>
        </div>
      </div>

      <!-- RESULTS -->
      <div class="ui-card mt-3 p-3 sm:p-4">
        <div class="flex items-center justify-between gap-3">
          <div class="text-sm opacity-80">
            Total: <span class="font-semibold">{{ total }}</span>
          </div>

          <div class="flex items-center gap-2">
            <select v-model="pageSize" class="ui-input !w-auto">
              <option :value="10">10</option>
              <option :value="25">25</option>
              <option :value="50">50</option>
            </select>

            <button class="ui-btn ui-btn-ghost" @click="prevPage" :disabled="page <= 1">Prev</button>
            <div class="text-sm opacity-80">Page {{ page }} / {{ totalPages }}</div>
            <button class="ui-btn ui-btn-ghost" @click="nextPage" :disabled="page >= totalPages">Next</button>
          </div>
        </div>

        <!-- DESKTOP TABLE (HORIZONTAL SCROLL ALWAYS WORKS) -->
        <div v-if="!isMobile" class="mt-3">
          <!-- ✅ IMPORTANT:
               ui-table-wrap already has overflow-x-auto in your CSS,
               but we add ui-scrollbar + extra overflow classes to guarantee it. -->
          <div class="ui-table-wrap ui-scrollbar overflow-x-auto overflow-y-hidden">
            <table class="ui-table min-w-[1400px]">
              <thead>
                <tr>
                  <th class="ui-th w-[160px]">Module</th>
                  <th class="ui-th w-[120px]">Emp ID</th>
                  <th class="ui-th w-[240px] text-left">Name</th>
                  <th class="ui-th w-[180px]">Dept</th>
                  <th class="ui-th w-[200px]">Mode</th>
                  <th class="ui-th w-[220px]">Status / Stage</th>
                  <th class="ui-th w-[240px]">Date</th>
                  <th class="ui-th w-[520px] text-left">Summary</th>
                </tr>
              </thead>

              <tbody>
                <tr v-if="loading">
                  <td colspan="8" class="ui-td text-center py-8 opacity-70">
                    <i class="fa-solid fa-circle-notch fa-spin mr-2"></i>
                    Loading...
                  </td>
                </tr>

                <tr v-else-if="!rows.length">
                  <td colspan="8" class="ui-td text-center py-8 opacity-70">No data</td>
                </tr>

                <tr v-else v-for="r in rows" :key="r.module + ':' + r.requestId" class="ui-tr-hover">
                  <td class="ui-td">
                    <span
                      class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1 whitespace-nowrap"
                      :class="badgeClassForModule(r.module)"
                    >
                      <i class="fa-solid" :class="moduleIcon(r.module)"></i>
                      {{ r.module }}
                    </span>
                  </td>

                  <td class="ui-td font-medium whitespace-nowrap">{{ r.employeeId || '—' }}</td>

                  <td class="ui-td text-left">
                    <div class="font-extrabold text-slate-900 dark:text-slate-50 truncate">
                      {{ r.employeeName || '—' }}
                    </div>
                  </td>

                  <td class="ui-td whitespace-nowrap">{{ r.department || '—' }}</td>

                  <td class="ui-td text-xs font-semibold whitespace-nowrap">{{ r.approvalMode || '—' }}</td>

                  <td class="ui-td">
                    <div class="font-semibold whitespace-nowrap">{{ r.status || '—' }}</div>
                    <div class="text-xs opacity-70 whitespace-nowrap">Stage: {{ r.stage || '—' }}</div>
                  </td>

                  <td class="ui-td">
                    <div class="whitespace-nowrap">{{ fmtDate(r.dateFrom) }}</div>
                    <div v-if="r.dateTo && r.dateTo !== r.dateFrom" class="text-xs opacity-70 whitespace-nowrap">
                      → {{ fmtDate(r.dateTo) }}
                    </div>
                  </td>

                  <td class="ui-td text-left">
                    <div class="font-medium line-clamp-2">
                      {{ r.summary || '—' }}
                    </div>
                    <div v-if="r.reason" class="text-xs opacity-70 line-clamp-2 mt-0.5">
                      {{ r.reason }}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- small helper hint for users -->
          <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            Tip: You can scroll the table left/right to see all columns.
          </div>
        </div>

        <!-- MOBILE CARDS -->
        <div v-else class="mt-3 space-y-2">
          <div
            v-for="r in rows"
            :key="r.module + ':' + r.requestId"
            class="rounded-2xl border border-slate-200/60 dark:border-slate-800/60 bg-white/70 dark:bg-slate-950/40 p-3"
          >
            <div class="flex items-start justify-between gap-2">
              <span
                class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ring-1"
                :class="badgeClassForModule(r.module)"
              >
                <i class="fa-solid" :class="moduleIcon(r.module)"></i>
                {{ r.module }}
              </span>

              <div class="text-xs opacity-70 text-right">
                <div class="font-semibold">{{ r.status || '—' }}</div>
                <div>Stage: {{ r.stage || '—' }}</div>
              </div>
            </div>

            <div class="mt-2">
              <div class="font-medium text-slate-900 dark:text-slate-50">
                {{ r.employeeId || '—' }} — {{ r.employeeName || '—' }}
              </div>
              <div class="text-xs opacity-70">{{ r.department || '—' }}</div>
            </div>

            <div class="mt-2 text-sm">
              <div class="text-xs opacity-70">Mode</div>
              <div class="font-semibold">{{ r.approvalMode || '—' }}</div>
            </div>

            <div class="mt-2 text-sm">
              <div class="text-xs opacity-70">Date</div>
              <div class="font-medium">
                {{ fmtDate(r.dateFrom) }}
                <span v-if="r.dateTo && r.dateTo !== r.dateFrom" class="opacity-80">
                  → {{ fmtDate(r.dateTo) }}
                </span>
              </div>
            </div>

            <div class="mt-2 text-sm">
              <div class="text-xs opacity-70">Summary</div>
              <div class="font-medium">{{ r.summary || '—' }}</div>
              <div v-if="r.reason" class="text-xs opacity-70 line-clamp-3 mt-1">
                {{ r.reason }}
              </div>
            </div>
          </div>

          <div v-if="loading" class="text-center py-6 opacity-70">
            <i class="fa-solid fa-circle-notch fa-spin mr-2"></i>
            Loading...
          </div>
          <div v-else-if="!rows.length" class="text-center py-6 opacity-70">No data</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ✅ Guarantee smooth horizontal scroll on mobile/trackpad (desktop too) */
.ui-table-wrap {
  -webkit-overflow-scrolling: touch;
}

/* Optional: make clamp work consistently */
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