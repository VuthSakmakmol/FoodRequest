<!-- src/views/expat/admin/components/AdminManagerAndGmReport.vue
  ✅ Fixed mode: MANAGER_GM
  ✅ Contract-based preview (no date range filter)
  ✅ Contract selector shows ALL contracts (from record meta.contracts)
  ✅ Default contract = current/latest
  ✅ Uses contractId to fetch record (backend supports ?contractId=)
  ✅ Vector Print-to-PDF (iframe print)
  ✅ Signature resolver + auth-protected signatures -> Blob URLs
  ✅ Per-row signatures (same as GM+COO fix):
      - Record By => requester employee signature (employeeId)
      - Checked By => leave_admin signature
      - Manager => only after manager approved (PENDING_GM or APPROVED)
      - GM => only after GM approved (APPROVED)
-->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { subscribeRoleIfNeeded, onSocket } from '@/utils/socket'

defineOptions({ name: 'AdminManagerAndGmReport' })

const { showToast } = useToast()

/* ───────── Tailwind mini UI helpers ───────── */
const ui = {
  input:
    'w-full rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-[12px] outline-none ' +
    'placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200 ' +
    'dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100 dark:placeholder:text-slate-500 ' +
    'dark:focus:border-slate-600 dark:focus:ring-slate-800/70',
  th: 'px-2.5 py-2 text-left text-[11px] font-extrabold whitespace-nowrap',
  td: 'px-2.5 py-2.5 align-middle',
  table: 'min-w-full border-collapse text-[12px] text-slate-700 dark:text-slate-100 table-fixed',
}

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

/* ───────── State ───────── */
const loading = ref(false)
const error = ref('')
const report = ref(null)

/* ───────── Pagination ───────── */
const page = ref(1)
const pageSize = ref(15)

/* ───────── Helpers ───────── */
function safeText(v) {
  return String(v ?? '').trim()
}
function fmtYMD(v) {
  if (!v) return ''
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD') : String(v)
}
function ymd(v) {
  const s = safeText(v)
  if (!s) return ''
  const d = dayjs(s)
  return d.isValid() ? d.format('YYYY-MM-DD') : s
}
function num(v) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}
function upStatus(v) {
  return String(v || '').toUpperCase().trim()
}

/**
 * Normalize approval mode to:
 * - MANAGER_GM
 * - GM_COO
 */
function normalizeApprovalMode(emp) {
  const raw =
    safeText(emp?.approvalMode) ||
    safeText(emp?.meta?.approvalMode) ||
    safeText(emp?.profile?.approvalMode) ||
    ''
  const m = raw.toUpperCase()

  const hasCoo = !!safeText(emp?.cooLoginId || emp?.meta?.cooLoginId)
  if (m.includes('COO') || m.includes('GM_COO') || m.includes('GM+COO') || m.includes('GM_AND_COO') || hasCoo)
    return 'GM_COO'

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
      limit: 500,
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

    const stamp = safeText(asOf.value) || 'as_of'
    XLSX.writeFile(wb, `leave_report_manager_gm_${stamp}.xlsx`)
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

/* ───────── Contracts in preview ───────── */
const contractOptions = ref([]) // [{ id, idx, from, to, label, isCurrent }]
const selectedContractId = ref('')
const contractWatchReady = ref(false)

function stripCurrentSuffix(label) {
  const s = safeText(label)
  if (!s) return ''
  return s.replace(/\s*\(current\)\s*/gi, ' ').replace(/\s{2,}/g, ' ').trim()
}

function normalizeContracts(rawContracts, empFallback) {
  const arr = Array.isArray(rawContracts) ? rawContracts : []

  const mapped = arr
    .map((c, i) => {
      const from = ymd(c.startDate || c.contractDate || c.from)
      const to = ymd(c.endDate || c.contractEndDate || c.to)
      const id = safeText(c.contractId || c._id || c.id || `${from || 'na'}:${to || 'na'}:${i + 1}`)
      const idx = Number(c.contractNo) || Number(c.contractNumber) || (i + 1)

      const labelRaw = safeText(c.label) || `Contract ${idx}${from ? `: ${from}` : ''}${to ? ` → ${to}` : ''}`
      const label = stripCurrentSuffix(labelRaw)

      const isCurrent = !!c.isCurrent
      return { id, idx, from, to, label, isCurrent }
    })
    .filter((x) => x.from || x.to)

  if (!mapped.length) {
    const from = ymd(empFallback?.contractDate)
    const to = ymd(empFallback?.contractEndDate)
    if (from || to) {
      mapped.push({
        id: `single:${from || 'na'}:${to || 'na'}`,
        idx: 1,
        from,
        to,
        label: stripCurrentSuffix(`Contract 1${from ? `: ${from}` : ''}${to ? ` → ${to}` : ''}`),
        isCurrent: true,
      })
    }
  }

  mapped.sort((a, b) => (a.from || '').localeCompare(b.from || ''))

  const today = dayjs().format('YYYY-MM-DD')
  const anyCurrentFlag = mapped.some((x) => x.isCurrent)
  if (!anyCurrentFlag) {
    for (const c of mapped) {
      const from = c.from || ''
      const to = c.to || ''
      const isCur = !!from && (!to ? from <= today : from <= today && today <= to)
      if (isCur) c.isCurrent = true
    }
    if (!mapped.some((x) => x.isCurrent) && mapped.length) mapped[mapped.length - 1].isCurrent = true
  }

  return mapped.map((c, i) => {
    const idx = c.idx || (i + 1)
    const label = stripCurrentSuffix(c.label) || stripCurrentSuffix(`Contract ${idx}${c.from ? `: ${c.from}` : ''}${c.to ? ` → ${c.to}` : ''}`)
    return { ...c, idx, label }
  })
}

function pickDefaultContractId(list, preferredId = '') {
  const pref = safeText(preferredId)
  if (pref) {
    const ok = list.find((x) => x.id === pref)
    if (ok) return ok.id
  }
  const cur = list.find((x) => x.isCurrent)
  return cur?.id || list[list.length - 1]?.id || ''
}

const selectedContract = computed(() => {
  const id = safeText(selectedContractId.value)
  return contractOptions.value.find((x) => x.id === id) || null
})

function contractDisplayLabel(c) {
  if (!c) return ''
  return c.isCurrent ? `${c.label} (Current)` : c.label
}

/* ───────── SIGNATURE: protected content -> blob urls (cached) ───────── */
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
function toAbsUrl(urlOrPath) {
  const u = safeText(urlOrPath)
  if (!u) return ''
  if (/^https?:\/\//i.test(u)) return u

  const apiBase = safeText(import.meta.env.VITE_API_URL || '')
    .replace(/\/api\/?$/i, '')
    .replace(/\/$/, '')

  const origin = apiBase || (typeof window !== 'undefined' ? window.location.origin : '')
  return `${origin}${u.startsWith('/') ? '' : '/'}${u}`
}
async function toAuthedBlobUrl(rawUrl) {
  const u = safeText(rawUrl)
  if (!u) return ''
  const abs = toAbsUrl(u)

  const token = getToken()
  const headers = token ? { Authorization: `Bearer ${token}` } : {}

  try {
    const res = await fetch(abs, { headers })
    if (!res.ok) return ''
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  } catch {
    return ''
  }
}

/* signature META caches */
const userSigMetaCache = new Map()
const employeeSigMetaCache = new Map()
const blobCache = new Map()

function clearBlobCache() {
  for (const v of blobCache.values()) revokeIfBlob(v)
  blobCache.clear()
}

async function getUserSignatureMetaUrl(loginId) {
  const id = safeText(loginId)
  if (!id) return ''
  const key = `user:${id}`
  if (userSigMetaCache.has(key)) return userSigMetaCache.get(key) || ''
  try {
    const res = await api.get(`/admin/signatures/users/${encodeURIComponent(id)}`)
    const url = res?.data?.signatureUrl || res?.data?.url || ''
    userSigMetaCache.set(key, url || '')
    return url || ''
  } catch {
    userSigMetaCache.set(key, '')
    return ''
  }
}

async function getEmployeeSignatureMetaUrl(employeeId) {
  const id = safeText(employeeId)
  if (!id) return ''
  if (employeeSigMetaCache.has(id)) return employeeSigMetaCache.get(id) || ''
  try {
    const res = await api.get(`/admin/signatures/employees/${encodeURIComponent(id)}`)
    const url = res?.data?.signatureUrl || res?.data?.url || ''
    employeeSigMetaCache.set(id, url || '')
    return url || ''
  } catch {
    employeeSigMetaCache.set(id, '')
    return ''
  }
}

function isLikelyEmployeeId(v) {
  const s = safeText(v)
  return /^\d{4,}$/.test(s)
}

/** numeric => employees first, else users first (then fallback) */
async function resolveSignatureMetaUrl(idLike) {
  const id = safeText(idLike)
  if (!id) return ''

  const key = `any:${id}`
  if (userSigMetaCache.has(key)) return userSigMetaCache.get(key) || ''

  const firstEmployees = isLikelyEmployeeId(id)

  let url = ''
  if (firstEmployees) url = await getEmployeeSignatureMetaUrl(id)
  else url = await getUserSignatureMetaUrl(id)

  if (!url) {
    if (firstEmployees) url = await getUserSignatureMetaUrl(id)
    else url = await getEmployeeSignatureMetaUrl(id)
  }

  userSigMetaCache.set(key, url || '')
  return url || ''
}

async function metaUrlToBlob(metaUrl) {
  const m = safeText(metaUrl)
  if (!m) return ''
  if (blobCache.has(m)) return blobCache.get(m) || ''
  const b = await toAuthedBlobUrl(m)
  blobCache.set(m, b || '')
  return b || ''
}

/* ───────── Row signatures (per cell) ───────── */
/**
 * IMPORTANT: ref(Map) but update by replacing Map (reactive)
 */
const rowSig = ref(new Map()) // key -> { recordBy, checkedBy, manager, gm }

function rowKey(r) {
  return `${safeText(r?.date)}|${safeText(r?.from)}|${safeText(r?.to)}|${safeText(r?.leaveTypeCode)}|${safeText(r?.status)}|${safeText(r?.remark)}`
}

function clearRowSig() {
  rowSig.value = new Map()
}

function setRowSig(k, v) {
  const m = new Map(rowSig.value)
  m.set(k, v)
  rowSig.value = m
}

/** ✅ Manager signature only after manager approved (pending_gm / approved) */
function showManagerSignatureForRow(r) {
  const st = upStatus(r?.status)
  return st === 'PENDING_GM' || st === 'APPROVED'
}

/** ✅ GM signature only after final approved */
function showGmSignatureForRow(r) {
  const st = upStatus(r?.status)
  return st === 'APPROVED'
}

async function ensureRowSignatures(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const jobs = []

  for (const r of list) {
    const k = rowKey(r)
    if (rowSig.value.has(k)) continue

    // ✅ FORCE rules:
    const recordById = safeText(r.recordByLoginId) // employeeId
    const checkedById = LEAVE_ADMIN_LOGIN
    const managerId = safeText(r.approvedManagerLoginId)
    const gmId = safeText(r.approvedGMLoginId)

    jobs.push(
      (async () => {
        const [recMeta, chkMeta, mgrMeta, gmMeta] = await Promise.all([
          resolveSignatureMetaUrl(recordById),
          resolveSignatureMetaUrl(checkedById),
          resolveSignatureMetaUrl(managerId),
          resolveSignatureMetaUrl(gmId),
        ])

        const [recBlob, chkBlob, mgrBlob, gmBlob] = await Promise.all([
          metaUrlToBlob(recMeta),
          metaUrlToBlob(chkMeta),
          metaUrlToBlob(mgrMeta),
          metaUrlToBlob(gmMeta),
        ])

        setRowSig(k, {
          recordBy: recBlob || '',
          checkedBy: chkBlob || '',
          manager: mgrBlob || '',
          gm: gmBlob || '',
        })
      })()
    )
  }

  const BATCH = 12
  for (let i = 0; i < jobs.length; i += BATCH) {
    await Promise.all(jobs.slice(i, i + BATCH))
  }
}

/* ───────── Fetch record for selected contract (uses contractId) ───────── */
async function fetchRecordForSelectedContract(employeeId) {
  const c = selectedContract.value
  const params = { ts: Date.now() }

  if (safeText(asOf.value)) params.asOf = safeText(asOf.value)

  if (c?.id && /^[a-f0-9]{24}$/i.test(String(c.id))) {
    params.contractId = c.id
  } else {
    if (c?.from && c?.to) {
      params.from = c.from
      params.to = c.to
    } else if (c?.from && !c?.to) {
      params.from = c.from
      params.to = safeText(asOf.value) || dayjs().format('YYYY-MM-DD')
    }
  }

  const res = await api.get(`/admin/leave/reports/employee/${encodeURIComponent(employeeId)}/record`, { params })
  previewData.value = res?.data || null
}

/* ───────── Modal open/close ───────── */
async function openPreview(emp) {
  previewEmp.value = emp
  previewOpen.value = true
  previewLoading.value = true
  previewError.value = ''
  previewData.value = null

  contractOptions.value = []
  selectedContractId.value = ''
  contractWatchReady.value = false

  clearRowSig()
  clearBlobCache()

  try {
    const employeeId = safeText(emp?.employeeId)
    if (!employeeId) throw new Error('Missing employeeId')

    // 1) fetch once to get meta.contracts + meta.selectedContractId
    await fetchRecordForSelectedContract(employeeId)

    const metaContracts = previewData.value?.meta?.contracts || []
    const preferredContractId = safeText(previewData.value?.meta?.selectedContractId)

    // 2) build contracts + set selected
    const list = normalizeContracts(metaContracts, emp)
    contractOptions.value = list
    selectedContractId.value = pickDefaultContractId(list, preferredContractId)

    // 3) refetch using selected contract + build signatures
    contractWatchReady.value = true
    await refetchPreviewByContract()
  } catch (e) {
    console.error('openPreview error', e)
    previewError.value = e?.response?.data?.message || e?.message || 'Failed to load leave record.'
  } finally {
    previewLoading.value = false
  }
}

async function refetchPreviewByContract() {
  try {
    const employeeId = safeText(previewEmp.value?.employeeId)
    if (!employeeId) return

    previewLoading.value = true
    previewError.value = ''
    previewData.value = null

    clearRowSig()

    await fetchRecordForSelectedContract(employeeId)
    await ensureRowSignatures(previewData.value?.rows || [])
  } catch (e) {
    console.error('refetchPreviewByContract error', e)
    previewError.value = e?.response?.data?.message || 'Failed to load leave record.'
  } finally {
    previewLoading.value = false
  }
}

watch(selectedContractId, async () => {
  if (!previewOpen.value) return
  if (!previewEmp.value) return
  if (!contractWatchReady.value) return
  await refetchPreviewByContract()
})

function closePreview() {
  previewOpen.value = false
  previewLoading.value = false
  previewError.value = ''
  previewData.value = null
  previewEmp.value = null
  contractOptions.value = []
  selectedContractId.value = ''
  contractWatchReady.value = false

  clearRowSig()
  clearBlobCache()
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
    .sig-cell { display:flex; align-items:flex-end; justify-content:center; min-height:16mm; }
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
    const c = selectedContract.value

    const rows = (previewData.value?.rows || []).map((r) => ({
      Date: r.date,
      From: r.from,
      To: r.to,
      AL_Day: r.AL_day,
      AL_Remain: r.AL_remain,
      UL: r.UL_day,
      SL: r.SL_day,
      ML: r.ML_day,
      RecordBy: r.recordByLoginId,
      CheckedBy: LEAVE_ADMIN_LOGIN,
      Manager: r.approvedManagerLoginId,
      GM: r.approvedGMLoginId,
      Remark: r.remark,
      Status: r.status,
      LeaveType: r.leaveTypeCode,
    }))

    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'LeaveRecord')

    const empId = safeText(emp.employeeId || previewEmp.value?.employeeId)
    const contractNo = c?.idx ? `c${c.idx}` : 'contract'
    const stamp = `${c?.from || 'na'}_${c?.to || 'na'}`
    XLSX.writeFile(wb, `leave_record_${MODE.toLowerCase()}_${empId}_${contractNo}_${stamp}.xlsx`)

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
  clearRowSig()
  clearBlobCache()
})
</script>

<template>
  <div class="w-full min-h-screen px-3 sm:px-4 py-3 space-y-3">
    <!-- Filters -->
    <div class="rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/40">
      <div class="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div class="text-[12px] font-semibold text-slate-900 dark:text-slate-50">Manager + GM Report</div>
          <div class="text-[11px] text-slate-500 dark:text-slate-400">
            Shows only employees in <span class="font-semibold">Manager + GM</span> approval mode.
          </div>
          <div class="text-[11px] text-slate-500 dark:text-slate-400">
            Preview uses <span class="font-semibold">selected contract</span> (default current/latest).
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
        <div class="md:col-span-4">
          <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Search</label>
          <input v-model="q" type="text" placeholder="Employee ID, name, dept..." :class="ui.input" />
        </div>

        <div class="md:col-span-2">
          <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">As of</label>
          <input v-model="asOf" type="date" :class="ui.input" />
        </div>

        <div class="md:col-span-3">
          <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Department</label>
          <input v-model="department" type="text" placeholder="HR, IT..." :class="ui.input" />
        </div>

        <div class="md:col-span-3">
          <label class="block text-[11px] font-medium text-slate-600 dark:text-slate-300">Manager Login ID</label>
          <input v-model="managerLoginId" type="text" placeholder="(optional filter)" :class="ui.input" />
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
              Preview generates Leave Record with signatures for the selected contract.
            </div>
          </div>
          <div class="text-[11px] text-slate-500 dark:text-slate-400">
            Page {{ page }} / {{ pageCount }} · {{ employeesAll.length }} employees
          </div>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table :class="ui.table">
          <colgroup>
            <col style="width: 120px;" />
            <col style="width: 240px;" />
            <col style="width: 220px;" />
            <col style="width: 132px;" />
            <col style="width: 132px;" />
            <col style="width: 140px;" />
            <col style="width: 140px;" />
            <col style="width: 140px;" />
          </colgroup>

          <thead
            class="border-b border-slate-200 bg-slate-100/90 text-[11px] uppercase tracking-wide text-slate-500
                   dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-300"
          >
            <tr>
              <th :class="ui.th">Employee ID</th>
              <th :class="ui.th">Name</th>
              <th :class="ui.th">Department</th>
              <th :class="ui.th">Join Date</th>
              <th :class="ui.th">Contract</th>
              <th :class="ui.th">Manager</th>
              <th :class="ui.th">GM</th>
              <th :class="[ui.th, 'text-right']">Action</th>
            </tr>
          </thead>

          <tbody>
            <tr
              v-for="emp in employeesPage"
              :key="emp.employeeId"
              class="border-b border-slate-200 hover:bg-slate-50/80 dark:border-slate-700 dark:hover:bg-slate-900/70"
            >
              <td :class="ui.td" class="font-mono">{{ emp.employeeId || '—' }}</td>
              <td :class="ui.td" class="truncate">
                <span class="font-medium text-slate-900 dark:text-slate-50">{{ emp.name || '—' }}</span>
                <span
                  v-if="emp.isActive === false"
                  class="ml-2 rounded-full border border-slate-300 px-2 py-0.5 text-[10px] text-slate-500 dark:border-slate-700 dark:text-slate-300"
                >
                  Inactive
                </span>
              </td>
              <td :class="ui.td" class="truncate">{{ emp.department || '—' }}</td>
              <td :class="ui.td" class="whitespace-nowrap font-mono">{{ fmtYMD(emp.joinDate) || '—' }}</td>
              <td :class="ui.td" class="whitespace-nowrap font-mono">{{ fmtYMD(emp.contractDate) || '—' }}</td>
              <td :class="ui.td" class="font-mono text-[11px]">{{ emp.managerLoginId || '—' }}</td>
              <td :class="ui.td" class="font-mono text-[11px]">{{ emp.gmLoginId || '—' }}</td>
              <td :class="ui.td" class="text-right">
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

    <!-- ───────── Preview Modal (FULLSCREEN) ───────── -->
    <div v-if="previewOpen" class="fixed inset-0 z-[60]">
      <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" @click="closePreview" />

      <div class="absolute inset-0 p-0">
        <div class="h-full w-full bg-white dark:bg-slate-950 flex flex-col">
          <!-- Top bar -->
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
            <div class="min-w-[260px]">
              <div class="text-[12px] font-semibold text-slate-900 dark:text-white">
                Leave Record — <span class="font-mono">{{ previewEmp?.employeeId }}</span>
              </div>
              <div class="text-[11px] text-slate-500 dark:text-slate-300">As of: {{ safeText(asOf) }}</div>
              <div class="text-[11px] text-slate-500 dark:text-slate-300">
                Mode: <span class="font-semibold">Manager + GM</span>
              </div>

              <!-- Contract selector -->
              <div class="mt-1 flex flex-wrap items-center gap-2">
                <div class="text-[11px] text-slate-500 dark:text-slate-300">Contract:</div>

                <select
                  v-model="selectedContractId"
                  class="h-8 rounded-xl border border-slate-300 bg-white px-2 text-[11px] outline-none
                         focus:border-slate-400 focus:ring-2 focus:ring-slate-200
                         dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100 dark:focus:border-slate-600 dark:focus:ring-slate-800/70"
                >
                  <option v-for="c in contractOptions" :key="c.id" :value="c.id">
                    {{ contractDisplayLabel(c) }}
                  </option>
                  <option v-if="!contractOptions.length" value="">(No contract info)</option>
                </select>

                <div v-if="selectedContract" class="text-[11px] text-slate-500 dark:text-slate-300">
                  <span class="font-mono">{{ selectedContract.from || '—' }}</span>
                  <span class="mx-1">→</span>
                  <span class="font-mono">{{ selectedContract.to || '—' }}</span>
                </div>
              </div>
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
          <div class="flex-1 overflow-y-auto bg-slate-100/70 p-3 sm:p-4 dark:bg-slate-900">
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

            <!-- Printable -->
            <div v-else class="w-full">
              <div class="mx-auto w-fit rounded-xl bg-white p-2 sm:p-3 shadow-sm dark:bg-white">
                <div ref="previewRef" class="print-sheet">
                  <!-- Header -->
                  <div class="sheet-header">
                    <div>
                      <div class="sheet-title">Leave Record - Foreigner</div>
                      <div class="text-[10px] text-slate-700">
                        Contract:
                        <span class="mono">{{ selectedContract?.from || '—' }}</span>
                        <span class="mx-1">→</span>
                        <span class="mono">{{ selectedContract?.to || '—' }}</span>
                      </div>
                    </div>
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

                  <!-- Table MANAGER + GM -->
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
                      <col style="width: 30mm;" />
                      <col style="width: 30mm;" />
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

                        <!-- Record By (employee requester) -->
                        <td class="small">
                          <div class="sig-cell">
                            <img
                              v-if="rowSig.get(rowKey(r))?.recordBy"
                              :src="rowSig.get(rowKey(r))?.recordBy"
                              alt="Record by sign"
                              class="sig-img"
                            />
                          </div>
                        </td>

                        <!-- Checked By (leave_admin) -->
                        <td class="small">
                          <div class="sig-cell">
                            <img
                              v-if="rowSig.get(rowKey(r))?.checkedBy"
                              :src="rowSig.get(rowKey(r))?.checkedBy"
                              alt="Checked by sign"
                              class="sig-img"
                            />
                          </div>
                        </td>

                        <!-- Manager (only after manager approved) -->
                        <td class="small">
                          <div class="sig-cell">
                            <img
                              v-if="rowSig.get(rowKey(r))?.manager && showManagerSignatureForRow(r)"
                              :src="rowSig.get(rowKey(r))?.manager"
                              alt="Manager sign"
                              class="sig-img"
                            />
                          </div>
                        </td>

                        <!-- GM (only after GM approved) -->
                        <td class="small">
                          <div class="sig-cell">
                            <img
                              v-if="rowSig.get(rowKey(r))?.gm && showGmSignatureForRow(r)"
                              :src="rowSig.get(rowKey(r))?.gm"
                              alt="GM sign"
                              class="sig-img"
                            />
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
  </div>
</template>

<style scoped>
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
  align-items: flex-end;
  justify-content: center;
  min-height: 16mm;
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

<style>
@page {
  size: A4;
  margin: 0;
}
</style>
