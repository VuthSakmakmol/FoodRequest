<!-- src/views/expat/admin/components/AdminManagerAndGmReport.vue
  ✅ Fixed mode: MANAGER_GM
  ✅ Vector Print-to-PDF (iframe print)
  ✅ Smaller text, clean borders, forced logo size
  ✅ Smart signature resolver
  ✅ FIX: signatures show even when content endpoint requires auth (Blob URLs)
-->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { subscribeRoleIfNeeded, onSocket } from '@/utils/socket'

defineOptions({ name: 'AdminManagerAndGmReport' })

const { showToast } = useToast()

/* ───────── constants ───────── */
const MODE = 'MANAGER_GM'
const LEAVE_ADMIN_LOGIN = 'leave_admin'

/* ───────── responsive ───────── */
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
function safeText(v) {
  return String(v ?? '').trim()
}
function fmtYMD(v) {
  if (!v) return ''
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD') : String(v)
}
function num(v) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}
function normalizeApprovalMode(emp) {
  const raw =
    safeText(emp?.approvalMode) ||
    safeText(emp?.meta?.approvalMode) ||
    safeText(emp?.profile?.approvalMode) ||
    ''
  const m = raw.toUpperCase()

  const hasCoo = !!safeText(emp?.cooLoginId || emp?.meta?.cooLoginId)
  if (m.includes('COO') || m.includes('GM_AND_COO') || m.includes('GM+COO') || hasCoo) return 'GM_COO'
  return 'MANAGER_GM'
}

const TYPE_ORDER = computed(() => report.value?.meta?.typeOrder || ['AL', 'SP', 'MC', 'MA', 'UL'])
function balOf(emp, code) {
  const c = String(code || '').toUpperCase()
  return (emp?.balances || []).find((b) => String(b.leaveTypeCode || '').toUpperCase() === c) || null
}

/* ───────── API: summary ───────── */
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
    if (!dateFrom.value || !dateTo.value) {
      delete params.dateFrom
      delete params.dateTo
    }
    const res = await api.get('/admin/leave/reports/summary', { params })
    report.value = res?.data || null
  } catch (e) {
    console.error('fetchReport error', e)
    error.value = e?.response?.data?.message || 'Failed to load report.'
    if (!silent) showToast({ type: 'error', title: 'Report failed', message: error.value })
  } finally {
    loading.value = false
  }
}

/* ───────── Employees filtered (Manager + GM only) ───────── */
const employeesAllRaw = computed(() => report.value?.employees || [])
const employeesAll = computed(() => employeesAllRaw.value.filter((emp) => normalizeApprovalMode(emp) === 'MANAGER_GM'))

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

/* ───────── Excel Export (employees list) ───────── */
async function exportEmployeesExcel() {
  try {
    const XLSX = await import('xlsx')
    const codes = TYPE_ORDER.value

    const rows = employeesAll.value.map((emp) => {
      const base = {
        employeeId: safeText(emp.employeeId),
        name: safeText(emp.name),
        department: safeText(emp.department),
        joinDate: fmtYMD(emp.joinDate),
        contractDate: fmtYMD(emp.contractDate),
        managerLoginId: safeText(emp.managerLoginId),
        gmLoginId: safeText(emp.gmLoginId),
        cooLoginId: safeText(emp.cooLoginId),
        approvalMode: safeText(emp.approvalMode) || MODE,
        isActive: emp.isActive ? 'YES' : 'NO',
      }
      for (const code of codes) {
        const b = balOf(emp, code) || {}
        base[`${code}_Used`] = num(b.used)
        base[`${code}_Remaining`] = num(b.remaining)
        base[`${code}_StrictRemaining`] = num(b.strictRemaining)
      }
      return base
    })

    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Manager_GM')

    const from = dateFrom.value && dateTo.value ? `${dateFrom.value}_to_${dateTo.value}` : 'all'
    XLSX.writeFile(wb, `leave_report_manager_gm_${from}.xlsx`)
    showToast({ type: 'success', title: 'Exported', message: 'Employees exported.' })
  } catch (e) {
    console.error('exportEmployeesExcel error', e)
    showToast({ type: 'error', title: 'Export failed', message: e?.message || 'Cannot export.' })
  }
}

/* ───────── Preview (per employee) ───────── */
const previewOpen = ref(false)
const previewLoading = ref(false)
const previewError = ref('')
const previewEmp = ref(null)
const previewData = ref(null)
const previewRef = ref(null)

/* ───────── signature url caches (META endpoints) ───────── */
const userSigCache = new Map() // key -> meta url
const employeeSigCache = new Map() // employeeId -> meta url

async function getUserSignatureUrl(loginId) {
  const id = safeText(loginId)
  if (!id) return ''
  const key = `user:${id}`
  if (userSigCache.has(key)) return userSigCache.get(key) || ''
  try {
    const res = await api.get(`/admin/signatures/users/${encodeURIComponent(id)}`)
    const url = res?.data?.signatureUrl || res?.data?.url || ''
    userSigCache.set(key, url || '')
    return url || ''
  } catch {
    userSigCache.set(key, '')
    return ''
  }
}

async function getEmployeeSignatureUrl(employeeId) {
  const id = safeText(employeeId)
  if (!id) return ''
  if (employeeSigCache.has(id)) return employeeSigCache.get(id) || ''
  try {
    const res = await api.get(`/admin/signatures/employees/${encodeURIComponent(id)}`)
    const url = res?.data?.signatureUrl || res?.data?.url || ''
    employeeSigCache.set(id, url || '')
    return url || ''
  } catch {
    employeeSigCache.set(id, '')
    return ''
  }
}

function isLikelyEmployeeId(v) {
  const s = safeText(v)
  return /^\d{4,}$/.test(s)
}

/* ✅ Smart resolver:
   - numeric => employees first
   - otherwise => users first
*/
async function resolveSignatureUrl(idLike) {
  const id = safeText(idLike)
  if (!id) return ''

  const key = `any:${id}`
  if (userSigCache.has(key)) return userSigCache.get(key) || ''

  const first = isLikelyEmployeeId(id) ? 'employees' : 'users'
  const second = first === 'employees' ? 'users' : 'employees'

  try {
    const r1 = await api.get(`/admin/signatures/${first}/${encodeURIComponent(id)}`)
    const u1 = r1?.data?.signatureUrl || r1?.data?.url || ''
    userSigCache.set(key, u1 || '')
    return u1 || ''
  } catch (e1) {
    try {
      const r2 = await api.get(`/admin/signatures/${second}/${encodeURIComponent(id)}`)
      const u2 = r2?.data?.signatureUrl || r2?.data?.url || ''
      userSigCache.set(key, u2 || '')
      return u2 || ''
    } catch {
      userSigCache.set(key, '')
      return ''
    }
  }
}

/* ───────── SIGNATURE FIX: convert protected URLs -> blob URLs ───────── */
function getToken() {
  try {
    return localStorage.getItem('token') || ''
  } catch {
    return ''
  }
}
function revokeIfBlob(url) {
  if (url && String(url).startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url)
    } catch {}
  }
}
async function toAuthedBlobUrl(rawUrl) {
  const u = safeText(rawUrl)
  if (!u) return ''

  // absolute url builder
  const abs = (() => {
    if (/^https?:\/\//i.test(u)) return u
    const apiBase = safeText(import.meta.env.VITE_API_URL || '')
      .replace(/\/api\/?$/i, '')
      .replace(/\/$/, '')
    const origin = apiBase || window.location.origin
    return `${origin}${u.startsWith('/') ? '' : '/'}${u}`
  })()

  const token = getToken()
  const headers = token ? { Authorization: `Bearer ${token}` } : {}

  const res = await fetch(abs, { headers })
  if (!res.ok) return ''
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

/* attached signatures for current preview (BLOB URLS) */
const sig = ref({
  requesterUrl: '',
  leaveAdminUrl: '',
  managerUrl: '',
  gmUrl: '',
})

function clearSig() {
  revokeIfBlob(sig.value.requesterUrl)
  revokeIfBlob(sig.value.leaveAdminUrl)
  revokeIfBlob(sig.value.managerUrl)
  revokeIfBlob(sig.value.gmUrl)
  sig.value = { requesterUrl: '', leaveAdminUrl: '', managerUrl: '', gmUrl: '' }
}

const rangeLabel = computed(() => {
  const f = safeText(dateFrom.value)
  const t = safeText(dateTo.value)
  if (!f || !t) return 'all → all'
  return `${f} → ${t}`
})

async function loadSignaturesForPreview() {
  const empId = safeText(previewData.value?.meta?.employeeId || previewEmp.value?.employeeId)

  const leaveAdminLoginId =
    safeText(previewData.value?.meta?.leaveAdminLoginId) ||
    safeText(report.value?.meta?.leaveAdminLoginId) ||
    LEAVE_ADMIN_LOGIN

  const managerId = safeText(previewData.value?.meta?.managerLoginId || previewEmp.value?.managerLoginId)
  const gmId = safeText(previewData.value?.meta?.gmLoginId || previewEmp.value?.gmLoginId)

  // meta urls
  const requesterRaw = await getEmployeeSignatureUrl(empId)
  const leaveAdminRaw = await resolveSignatureUrl(leaveAdminLoginId)
  const managerRaw = await resolveSignatureUrl(managerId)
  const gmRaw = await resolveSignatureUrl(gmId)

  // ✅ convert to blob urls (so <img> works with auth)
  const [requesterUrl, leaveAdminUrl, managerUrl, gmUrl] = await Promise.all([
    toAuthedBlobUrl(requesterRaw),
    toAuthedBlobUrl(leaveAdminRaw),
    toAuthedBlobUrl(managerRaw),
    toAuthedBlobUrl(gmRaw),
  ])

  sig.value = {
    requesterUrl: requesterUrl || '',
    leaveAdminUrl: leaveAdminUrl || '',
    managerUrl: managerUrl || '',
    gmUrl: gmUrl || '',
  }
}

async function openPreview(emp) {
  previewEmp.value = emp
  previewOpen.value = true
  previewLoading.value = true
  previewError.value = ''
  previewData.value = null
  clearSig()

  try {
    const employeeId = safeText(emp?.employeeId)
    const params = {}
    if (dateFrom.value && dateTo.value && dateRangeOk.value) {
      params.from = safeText(dateFrom.value)
      params.to = safeText(dateTo.value)
    }

    const res = await api.get(`/admin/leave/reports/employee/${encodeURIComponent(employeeId)}/record`, { params })
    previewData.value = res?.data || null

    await loadSignaturesForPreview()
  } catch (e) {
    console.error('openPreview error', e)
    previewError.value = e?.response?.data?.message || 'Failed to load leave record.'
  } finally {
    previewLoading.value = false
  }
}

function closePreview() {
  previewOpen.value = false
  previewLoading.value = false
  previewError.value = ''
  previewData.value = null
  previewEmp.value = null
  clearSig()
}

/* ✅ BEST PDF: Vector Print-to-PDF */
async function downloadPdf() {
  try {
    const el = previewRef.value
    if (!el) return

    await nextTick()

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Leave Record</title>
  <style>
    @page { size: A4; margin: 0; }
    html, body { margin:0; padding:0; background:#fff; }
    .print-sheet {
      width: 210mm;
      min-height: 297mm;
      padding: 5mm;
      margin: 0;
      color: #111827;
      background: #ffffff;
      font-size: 10.5px;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
    }
    .sheet-header { display:flex; align-items:flex-end; justify-content:space-between; gap:10px; }
    .sheet-title { font-size:16px; font-weight:800; letter-spacing:0.2px; }
    .sheet-brand { display:flex; justify-content:flex-end; align-items:center; }
    .sheet-logo { height:24px !important; width:auto !important; max-width:60mm !important; object-fit:contain; display:block; }
    .sheet-line { height:2px; background:#14532d; margin:6px 0 8px 0; opacity:0.9; }

    .sheet-meta { font-size:10.5px; }
    .meta-row {
      display:grid;
      grid-template-columns: 18mm 1fr 12mm 26mm 22mm 1fr 16mm 1fr;
      gap: 5px 8px;
      align-items: center;
      margin-bottom: 7px;
    }
    .meta-label { font-weight:700; }
    .meta-value { border-bottom: 0.5pt solid #111827; padding: 1px 4px; min-height: 14px; }
    .meta-legend { grid-column: span 7; display:flex; gap:14px; flex-wrap:wrap; align-items:center; }

    table.sheet-table { width:100%; border-collapse:collapse; border-spacing:0; font-size:10.5px; margin-top:5px; }
    .sheet-table th, .sheet-table td {
      border: 0.5pt solid #111827;
      padding: 4px 4px;
      vertical-align: top;
    }
    .sheet-table thead th { background:#e7e3da; text-align:center; font-weight:800; }
    .center { text-align:center; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    .nowrap { white-space:nowrap; }
    .small { font-size:10px; }
    .remark { font-size:10px; }
    .sig-img { max-height:16mm; max-width:100%; object-fit:contain; }
  </style>
</head>
<body>
  ${el.outerHTML}
  <script>
    (async () => {
      const imgs = Array.from(document.images || []);
      await Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise(r => { img.onload=r; img.onerror=r; })));
      setTimeout(() => { window.focus(); window.print(); }, 50);
    })();
  <\\/script>
</body>
</html>`

    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    document.body.appendChild(iframe)

    const win = iframe.contentWindow
    const doc = win.document
    doc.open()
    doc.write(html)
    doc.close()

    iframe.onload = () => {
      try {
        win.focus()
        win.print()
      } catch {}
    }

    const cleanup = () => {
      try {
        document.body.removeChild(iframe)
      } catch {}
      window.removeEventListener('focus', cleanup)
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('focus', cleanup)
    window.addEventListener('afterprint', cleanup)
  } catch (e) {
    console.error('downloadPdf(print) error', e)
    showToast({ type: 'error', title: 'PDF failed', message: e?.message || 'Cannot export PDF.' })
  }
}

/* Excel export for the record rows */
async function exportRecordExcel() {
  try {
    const XLSX = await import('xlsx')
    const emp = previewData.value?.meta || {}
    const rows = (previewData.value?.rows || []).map((r) => ({
      Date: r.date,
      From: r.from,
      To: r.to,
      AL_Day: r.AL_day,
      AL_Remain: r.AL_remain,
      UL: r.UL_day,
      SL: r.SL_day,
      ML: r.ML_day,
      RecordBy: 'Requester',
      CheckedBy: 'Leave Admin',
      Approved_1: 'Manager',
      Approved_2: 'OM / GM',
      Remark: r.remark,
      Status: r.status,
      LeaveType: r.leaveTypeCode,
    }))

    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'LeaveRecord')

    const empId = safeText(emp.employeeId || previewEmp.value?.employeeId)
    const from = dateFrom.value && dateTo.value ? `${dateFrom.value}_to_${dateTo.value}` : 'all'
    XLSX.writeFile(wb, `leave_record_${MODE.toLowerCase()}_${empId}_${from}.xlsx`)

    showToast({ type: 'success', title: 'Exported', message: 'Record exported.' })
  } catch (e) {
    console.error('exportRecordExcel error', e)
    showToast({ type: 'error', title: 'Export failed', message: e?.message || 'Cannot export.' })
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
  subscribeRoleIfNeeded()
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
  clearSig()
})
</script>

<template>
  <div class="space-y-3">
    <!-- Filters -->
    <div class="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/40">
      <div class="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">Manager + GM Report</div>
          <div class="text-[11px] text-slate-500 dark:text-slate-400">
            Shows only employees in <span class="font-semibold">Manager + GM</span> approval mode.
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800
                   dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 disabled:opacity-60"
            :disabled="loading || !report"
            @click="exportEmployeesExcel"
          >
            <i class="fa-solid fa-file-excel text-[11px]" />
            Export Employees
          </button>

          <button
            type="button"
            class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-50
                   dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900 disabled:opacity-60"
            :disabled="loading"
            @click="fetchReport(false)"
          >
            <i class="fa-solid fa-rotate text-[11px]" :class="loading ? 'fa-spin' : ''" />
            Refresh
          </button>
        </div>
      </div>

      <div class="mt-3 grid grid-cols-1 gap-2 md:grid-cols-12">
        <div class="md:col-span-3">
          <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Search</label>
          <input v-model="q" type="text" placeholder="Employee ID, name, dept..." class="input-mini" />
        </div>

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
            {{ employeesAll.length }} employees
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

    <!-- Employees table -->
    <div class="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div class="border-b border-slate-200 bg-slate-50/80 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-950/40">
        <div class="flex items-center justify-between gap-2">
          <div>
            <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">Employees</div>
            <div class="text-[11px] text-slate-500 dark:text-slate-400">
              Preview generates the Leave Record template with auto-attached signatures.
            </div>
          </div>
          <div class="text-[11px] text-slate-500 dark:text-slate-400">Page {{ page }} / {{ pageCount }} · {{ employeesAll.length }} employees</div>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="table-fixed min-w-full border-collapse text-[12px] text-slate-700 dark:text-slate-100">
          <colgroup>
            <col style="width: 120px;" />
            <col style="width: 240px;" />
            <col style="width: 220px;" />
            <col style="width: 132px;" />
            <col style="width: 132px;" />
            <col style="width: 120px;" />
            <col style="width: 120px;" />
            <col style="width: 140px;" />
          </colgroup>

          <thead
            class="border-b border-slate-200 bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-500
                   dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300"
          >
            <tr>
              <th class="table-th">Employee ID</th>
              <th class="table-th">Name</th>
              <th class="table-th">Department</th>
              <th class="table-th">Join Date</th>
              <th class="table-th">Contract</th>
              <th class="table-th">Manager</th>
              <th class="table-th">GM</th>
              <th class="table-th text-right">Action</th>
            </tr>
          </thead>

          <tbody>
            <tr
              v-for="emp in employeesPage"
              :key="emp.employeeId"
              class="border-b border-slate-200 hover:bg-slate-50/80 dark:border-slate-700 dark:hover:bg-slate-900/70"
            >
              <td class="table-td font-mono">{{ emp.employeeId || '—' }}</td>
              <td class="table-td truncate">
                <span class="font-medium text-slate-900 dark:text-slate-50">{{ emp.name || '—' }}</span>
                <span
                  v-if="emp.isActive === false"
                  class="ml-2 rounded-full border border-slate-300 px-2 py-0.5 text-[10px] text-slate-500 dark:border-slate-700 dark:text-slate-300"
                >
                  Inactive
                </span>
              </td>
              <td class="table-td truncate">{{ emp.department || '—' }}</td>
              <td class="table-td whitespace-nowrap font-mono">{{ fmtYMD(emp.joinDate) || '—' }}</td>
              <td class="table-td whitespace-nowrap font-mono">{{ fmtYMD(emp.contractDate) || '—' }}</td>
              <td class="table-td font-mono text-[11px]">{{ emp.managerLoginId || '—' }}</td>
              <td class="table-td font-mono text-[11px]">{{ emp.gmLoginId || '—' }}</td>
              <td class="table-td text-right">
                <button
                  type="button"
                  class="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800
                         dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                  @click="openPreview(emp)"
                >
                  <i class="fa-solid fa-eye text-[11px]" />
                  Preview
                </button>
              </td>
            </tr>

            <tr v-if="employeesPage.length === 0">
              <td :colspan="8" class="py-6 text-center text-[11px] text-slate-500 dark:text-slate-400">No employees found.</td>
            </tr>
          </tbody>
        </table>

        <div class="flex items-center justify-between px-3 py-2">
          <button
            class="rounded-full px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200/70 dark:text-slate-200 dark:hover:bg-slate-800 disabled:opacity-50"
            @click="prevPage"
            :disabled="page <= 1"
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
            :disabled="page >= pageCount"
          >
            Next <i class="fa-solid fa-chevron-right ml-2 text-[11px]" />
          </button>
        </div>
      </div>
    </div>

    <!-- ───────── Preview Modal ───────── -->
    <div v-if="previewOpen" class="fixed inset-0 z-[60]">
      <div class="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" @click="closePreview" />
      <div class="absolute inset-0 overflow-y-auto p-3 sm:p-6">
        <div class="mx-auto w-full max-w-6xl overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-950">
          <!-- Top bar -->
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
            <div>
              <div class="text-[12px] font-semibold text-slate-900 dark:text-white">
                Leave Record — <span class="font-mono">{{ previewEmp?.employeeId }}</span>
              </div>
              <div class="text-[11px] text-slate-500 dark:text-slate-300">Range: {{ rangeLabel }}</div>
              <div class="text-[11px] text-slate-500 dark:text-slate-300">Mode: <span class="font-semibold">Manager + GM</span></div>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <button
                class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-50
                       dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900 disabled:opacity-60"
                :disabled="previewLoading || !previewData"
                @click="downloadPdf"
              >
                <i class="fa-solid fa-print text-[11px]" />
                Print / PDF
              </button>

              <button
                class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-50
                       dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900 disabled:opacity-60"
                :disabled="previewLoading || !previewData"
                @click="exportRecordExcel"
              >
                <i class="fa-solid fa-file-excel text-[11px]" />
                Excel
              </button>

              <button
                class="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800
                       dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                @click="closePreview"
              >
                <i class="fa-solid fa-xmark text-[11px]" />
                Close
              </button>
            </div>
          </div>

          <!-- Body -->
          <div class="bg-slate-100/70 p-3 dark:bg-slate-900">
            <div
              v-if="previewError"
              class="mb-3 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-[11px] text-rose-700
                     dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100"
            >
              {{ previewError }}
            </div>

            <div v-if="previewLoading" class="space-y-2">
              <div class="h-10 w-full animate-pulse rounded-xl bg-slate-200/90 dark:bg-slate-800/70" />
              <div class="h-14 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/60" />
              <div class="h-14 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/60" />
            </div>

            <!-- Printable area -->
            <div v-else class="mx-auto w-fit rounded-xl bg-white p-3 shadow-sm dark:bg-white">
              <div ref="previewRef" class="print-sheet">
                <!-- Header -->
                <div class="sheet-header">
                  <div class="sheet-title">Leave Record - Foreigner</div>
                  <div class="sheet-brand">
                    <img src="/brand/trax-logo.png" alt="TRAX" class="sheet-logo" />
                  </div>
                </div>

                <div class="sheet-line"></div>

                <div class="sheet-meta">
                  <div class="meta-row">
                    <div class="meta-label">Name:</div>
                    <div class="meta-value">{{ previewData?.meta?.name || '' }}</div>

                    <div class="meta-label">ID:</div>
                    <div class="meta-value mono">{{ previewData?.meta?.employeeId || '' }}</div>

                    <div class="meta-label">Department:</div>
                    <div class="meta-value">{{ previewData?.meta?.department || '' }}</div>

                    <div class="meta-label">Section:</div>
                    <div class="meta-value">{{ previewData?.meta?.section || 'Foreigner' }}</div>
                  </div>

                  <div class="meta-row">
                    <div class="meta-label">Date Join:</div>
                    <div class="meta-value mono">{{ previewData?.meta?.joinDate || '' }}</div>
                    <div class="meta-legend">
                      <span class="meta-label">Leave Type:</span>
                      <span><b>AL</b>: Annual Leave</span>
                      <span><b>SL</b>: Sick Leave</span>
                      <span><b>ML</b>: Maternity Leave</span>
                      <span><b>UL</b>: Unpaid Leave</span>
                    </div>
                  </div>
                </div>

                <!-- Table -->
                <table class="sheet-table">
                  <colgroup>
                    <col style="width: 16mm;" />
                    <col style="width: 16mm;" />
                    <col style="width: 16mm;" />
                    <col style="width: 13mm;" />
                    <col style="width: 13mm;" />
                    <col style="width: 8mm;" />
                    <col style="width: 8mm;" />
                    <col style="width: 8mm;" />
                    <col style="width: 22mm;" />
                    <col style="width: 22mm;" />
                    <col style="width: 26mm;" />
                    <col style="width: 34mm;" />
                    <col style="width: 14mm;" />
                  </colgroup>

                  <thead>
                    <tr>
                      <th rowspan="2">Date</th>
                      <th colspan="2">Leave Date</th>
                      <th colspan="2">AL</th>
                      <th rowspan="2">UL<br />Day</th>
                      <th rowspan="2">SL<br />Day</th>
                      <th rowspan="2">ML<br />Day</th>
                      <th rowspan="2">Record<br />By</th>
                      <th rowspan="2">Checked<br />by</th>
                      <th colspan="2">Approved by</th>
                      <th rowspan="2">Remark</th>
                    </tr>
                    <tr>
                      <th>From</th>
                      <th>To</th>
                      <th>Day</th>
                      <th>Remain</th>
                      <th>Manager</th>
                      <th>OM / GM</th>
                    </tr>
                  </thead>

                  <tbody>
                    <tr v-for="(r, idx) in (previewData?.rows || [])" :key="idx">
                      <td class="mono nowrap">{{ r.date || '' }}</td>
                      <td class="mono nowrap">{{ r.from || '' }}</td>
                      <td class="mono nowrap">{{ r.to || '' }}</td>

                      <td class="mono center">{{ r.AL_day ?? '' }}</td>
                      <td class="mono center">{{ r.AL_remain ?? '' }}</td>

                      <td class="mono center">{{ r.UL_day ?? '' }}</td>
                      <td class="mono center">{{ r.SL_day ?? '' }}</td>
                      <td class="mono center">{{ r.ML_day ?? '' }}</td>

                      <td class="small">
                        <div class="sig-cell">
                          <img v-if="sig.requesterUrl" :src="sig.requesterUrl" alt="Requester sign" class="sig-img" />
                        </div>
                      </td>

                      <td class="small">
                        <div class="sig-cell">
                          <img v-if="sig.leaveAdminUrl" :src="sig.leaveAdminUrl" alt="Leave Admin sign" class="sig-img" />
                        </div>
                      </td>

                      <td class="small">
                        <div class="sig-cell">
                          <img v-if="sig.managerUrl" :src="sig.managerUrl" alt="Manager sign" class="sig-img" />
                        </div>
                      </td>

                      <td class="small">
                        <div class="sig-cell">
                          <img v-if="sig.gmUrl" :src="sig.gmUrl" alt="GM sign" class="sig-img" />
                        </div>
                      </td>

                      <td class="remark">{{ r.remark || '' }}</td>
                    </tr>

                    <tr v-for="n in Math.max(0, 18 - (previewData?.rows || []).length)" :key="'blank-' + n">
                      <td v-for="c in 13" :key="c">&nbsp;</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div v-if="!previewLoading && previewData" class="mt-2 text-[11px] text-slate-500 dark:text-slate-300">
              Tip: In print dialog, choose “Save as PDF”. Turn off “Headers and footers” for clean output.
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* compact inputs */
.input-mini {
  width: 100%;
  border-radius: 0.75rem;
  border: 1px solid rgb(203 213 225);
  background: white;
  padding: 6px 10px;
  font-size: 12px;
  outline: none;
}
:global(.dark) .input-mini {
  border-color: rgb(51 65 85);
  background: rgb(2 6 23 / 0.6);
  color: rgb(226 232 240);
}

.table-th {
  padding: 8px 10px;
  text-align: left;
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
}
.table-td {
  padding: 10px 10px;
  vertical-align: middle;
}
.table-fixed {
  table-layout: fixed;
}

/* printable sheet */
.print-sheet {
  width: 210mm;
  min-height: 297mm;
  padding: 5mm;
  margin: 0 auto;
  color: #111827;
  background: #ffffff;
  font-size: 10.5px;
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
}

.sheet-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 10px;
}
.sheet-title {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0.2px;
}

/* logo size hard-force */
.sheet-brand {
  display: flex;
  justify-content: flex-end;
  align-items: center;
}
.sheet-logo {
  height: 24px !important;
  width: auto !important;
  max-width: 60mm !important;
  object-fit: contain;
  display: block;
}

.sheet-line {
  height: 2px;
  background: #14532d;
  margin: 6px 0 8px 0;
  opacity: 0.9;
}

.sheet-meta {
  font-size: 10.5px;
}
.meta-row {
  display: grid;
  grid-template-columns: 18mm 1fr 12mm 26mm 22mm 1fr 16mm 1fr;
  gap: 5px 8px;
  align-items: center;
  margin-bottom: 7px;
}
.meta-label {
  font-weight: 700;
}
.meta-value {
  border-bottom: 0.6px solid #111827;
  padding: 1px 4px;
  min-height: 14px;
}
.meta-legend {
  grid-column: span 7;
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  align-items: center;
}

/* table */
.sheet-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 10.5px;
  margin-top: 5px;
}
.sheet-table th,
.sheet-table td {
  border: 0.6px solid #111827;
  padding: 4px 4px;
  vertical-align: top;
}
.sheet-table thead th {
  background: #e7e3da;
  text-align: center;
  font-weight: 800;
}

.center {
  text-align: center;
}
.small {
  font-size: 10px;
}
.remark {
  font-size: 10px;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}
.nowrap {
  white-space: nowrap;
}

/* signature */
.sig-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.sig-img {
  max-height: 16mm;
  max-width: 100%;
  object-fit: contain;
}

@media print {
  .print-sheet {
    box-shadow: none !important;
  }
}
</style>

<!-- IMPORTANT: @page must NOT be scoped -->
<style>
@page {
  size: A4;
  margin: 0;
}
</style>
