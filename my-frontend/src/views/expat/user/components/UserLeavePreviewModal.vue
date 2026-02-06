<!-- src/views/expat/user/components/UserLeavePreviewModal.vue
  ✅ Fullscreen preview
  ✅ Uses /leave/user/record
  ✅ Contract selector
  ✅ asOf = selected contract end date
  ✅ Vector Print-to-PDF
  ✅ Signature fetch (supports url/signatureUrl/fileId)
  ✅ AL remain fallback calc if backend sends 0/missing
-->

<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'

defineOptions({ name: 'UserLeavePreviewModal' })

const { showToast } = useToast()

const props = defineProps({
  open: { type: Boolean, default: false },
  me: { type: Object, default: () => ({}) }, // { employeeId, loginId, name, ... }
})

const emit = defineEmits(['close'])

/* ───────── helpers ───────── */
function safeText(v) {
  return String(v ?? '').trim()
}
function upStatus(v) {
  return safeText(v).toUpperCase()
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
function isLikelyEmployeeId(v) {
  return /^\d{4,}$/.test(safeText(v))
}
function revokeIfBlob(url) {
  if (url && String(url).startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url)
    } catch {}
  }
}

/* ───────── state ───────── */
const loading = ref(false)
const error = ref('')
const record = ref(null)
const previewRef = ref(null)

/* ───────── contracts ───────── */
const contractOptions = ref([]) // [{ id, idx, from, to, label, isCurrent }]
const selectedContractId = ref('')
const contractWatchReady = ref(false)

function stripCurrentSuffix(label) {
  const s = safeText(label)
  if (!s) return ''
  return s.replace(/\s*\(current\)\s*/gi, ' ').replace(/\s{2,}/g, ' ').trim()
}

function normalizeContracts(rawContracts, fallbackMe = {}) {
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
    const from = ymd(fallbackMe?.contractDate)
    const to = ymd(fallbackMe?.contractEndDate)
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
    const label =
      stripCurrentSuffix(c.label) ||
      stripCurrentSuffix(`Contract ${idx}${c.from ? `: ${c.from}` : ''}${c.to ? ` → ${c.to}` : ''}`)
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

/* internal asOf = contract end date */
const previewAsOfYMD = computed(() => {
  const c = selectedContract.value
  const end = ymd(c?.to) || ymd(record.value?.meta?.contract?.endDate || record.value?.meta?.contract?.to)
  return end || dayjs().format('YYYY-MM-DD')
})

/* ───────── signature fetch (user endpoints) ───────── */
function getToken() {
  try {
    return localStorage.getItem('token') || ''
  } catch {
    return ''
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

const metaCache = new Map() // key -> resolved meta url
const blobCache = new Map() // metaUrl -> blobUrl

function clearBlobCache() {
  for (const v of blobCache.values()) revokeIfBlob(v)
  blobCache.clear()
}

function normalizeMetaToUrl(data) {
  // supports:
  // { url }
  // { signatureUrl }
  // { signatureUrl: { url } }
  // { fileId } or { gridFsId } => build content url
  const url =
    safeText(data?.url) ||
    safeText(data?.signatureUrl) ||
    safeText(data?.signatureUrl?.url) ||
    ''

  if (url) return url

  const fileId = safeText(data?.fileId || data?.gridFsId || data?.id)
  if (fileId) {
    // IMPORTANT: requires backend route:
    // GET /api/leave/user/signatures/content/:fileId
    const base = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')
    return `${base}/leave/user/signatures/content/${encodeURIComponent(fileId)}?ts=${Date.now()}`
  }

  return ''
}

async function resolveSignatureMetaUrl(idLike) {
  const id = safeText(idLike)
  if (!id) return ''

  const key = `any:${id}`
  if (metaCache.has(key)) return metaCache.get(key) || ''

  try {
    const res = await api.get(`/leave/user/signatures/resolve/${encodeURIComponent(id)}`)
    const url = normalizeMetaToUrl(res?.data || {})
    metaCache.set(key, url || '')
    return url || ''
  } catch {
    metaCache.set(key, '')
    return ''
  }
}

async function metaUrlToBlob(metaUrl) {
  const m = safeText(metaUrl)
  if (!m) return ''
  if (blobCache.has(m)) return blobCache.get(m) || ''
  const b = await toAuthedBlobUrl(m)
  blobCache.set(m, b || '')
  return b || ''
}

/* ───────── row signatures ───────── */
const rowSig = ref(new Map()) // key -> { recordBy, checkedBy, manager, gm, coo }

function rowKey(r) {
  return `${safeText(r?.date)}|${safeText(r?.from)}|${safeText(r?.to)}|${safeText(r?.leaveTypeCode)}|${safeText(
    r?.status
  )}|${safeText(r?.remark)}`
}
function setRowSig(k, v) {
  const m = new Map(rowSig.value)
  m.set(k, v)
  rowSig.value = m
}
function clearRowSig() {
  rowSig.value = new Map()
}

const LEAVE_ADMIN_LOGIN = 'leave_admin'

function showManagerSignatureForRow(r) {
  const st = upStatus(r?.status)
  return st === 'PENDING_GM' || st === 'PENDING_COO' || st === 'APPROVED'
}
function showGmSignatureForRow(r) {
  const st = upStatus(r?.status)
  return st === 'PENDING_COO' || st === 'APPROVED'
}
function showCooSignatureForRow(r) {
  const st = upStatus(r?.status)
  return st === 'APPROVED'
}

async function ensureRowSignatures(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const jobs = []

  const meEmpId = safeText(props.me?.employeeId)
  const meLogin = safeText(props.me?.loginId)

  for (const r of list) {
    const k = rowKey(r)
    if (rowSig.value.has(k)) continue

    // ✅ record-by: prefer row value, else fallback to me.employeeId/loginId
    const recordById =
      safeText(r.recordByLoginId) ||
      safeText(r.recordByEmployeeId) ||
      (isLikelyEmployeeId(meEmpId) ? meEmpId : meLogin)

    const checkedById = LEAVE_ADMIN_LOGIN
    const managerId = safeText(r.approvedManagerLoginId)
    const gmId = safeText(r.approvedGMLoginId)
    const cooId = safeText(r.approvedCOOLoginId)

    jobs.push(
      (async () => {
        const [recMeta, chkMeta, mgrMeta, gmMeta, cooMeta] = await Promise.all([
          resolveSignatureMetaUrl(recordById),
          resolveSignatureMetaUrl(checkedById),
          resolveSignatureMetaUrl(managerId),
          resolveSignatureMetaUrl(gmId),
          resolveSignatureMetaUrl(cooId),
        ])

        const [recBlob, chkBlob, mgrBlob, gmBlob, cooBlob] = await Promise.all([
          metaUrlToBlob(recMeta),
          metaUrlToBlob(chkMeta),
          metaUrlToBlob(mgrMeta),
          metaUrlToBlob(gmMeta),
          metaUrlToBlob(cooMeta),
        ])

        setRowSig(k, {
          recordBy: recBlob || '',
          checkedBy: chkBlob || '',
          manager: mgrBlob || '',
          gm: gmBlob || '',
          coo: cooBlob || '',
        })
      })()
    )
  }

  const BATCH = 12
  for (let i = 0; i < jobs.length; i += BATCH) {
    await Promise.all(jobs.slice(i, i + BATCH))
  }
}

/* ───────── AL remain fallback (client-side) ───────── */
function findBalance(balances, code) {
  const c = safeText(code).toUpperCase()
  const arr = Array.isArray(balances) ? balances : []
  return arr.find((b) => safeText(b?.leaveTypeCode).toUpperCase() === c) || null
}

const computedRows = computed(() => {
  const rows = Array.isArray(record.value?.rows) ? record.value.rows : []
  if (!rows.length) return rows

  // if backend already sends meaningful remain, keep it
  const anyNonZeroRemain = rows.some((r) => num(r.AL_remain) > 0)
  if (anyNonZeroRemain) return rows

  // fallback: starting remaining from meta balances
  const startBal =
    findBalance(record.value?.meta?.balances, 'AL') ||
    findBalance(record.value?.meta?.closeSnapshot?.balances, 'AL') ||
    findBalance(record.value?.meta?.openSnapshot?.balances, 'AL')

  const startRemain = num(startBal?.remaining ?? startBal?.strictRemaining ?? 0)
  if (startRemain <= 0) return rows

  let remain = startRemain
  return rows.map((r) => {
    const alDay = num(r.AL_day)
    remain = remain - alDay
    // do not force negative clamp — keep truthful if it goes below 0
    return { ...r, AL_remain: remain }
  })
})

/* ───────── API: record ───────── */
async function fetchRecordForSelectedContract() {
  const params = { ts: Date.now(), asOf: previewAsOfYMD.value }

  const c = selectedContract.value
  if (c?.id && /^[a-f0-9]{24}$/i.test(String(c.id))) {
    params.contractId = c.id
  } else {
    if (c?.from && c?.to) {
      params.from = c.from
      params.to = c.to
    } else if (c?.from && !c?.to) {
      params.from = c.from
      params.to = params.asOf
    }
  }

  const res = await api.get('/leave/user/record', { params })
  record.value = res?.data || null

  clearRowSig()
  await ensureRowSignatures(record.value?.rows || [])
}

/* ───────── open/close ───────── */
async function openAndLoad() {
  loading.value = true
  error.value = ''
  record.value = null

  contractOptions.value = []
  selectedContractId.value = ''
  contractWatchReady.value = false

  clearRowSig()
  clearBlobCache()
  metaCache.clear()

  try {
    // first fetch to obtain meta.contracts
    await fetchRecordForSelectedContract()

    const metaContracts = record.value?.meta?.contracts || []
    const preferred = safeText(record.value?.meta?.selectedContractId)

    const list = normalizeContracts(metaContracts, record.value?.meta || props.me)
    contractOptions.value = list
    selectedContractId.value = pickDefaultContractId(list, preferred)

    contractWatchReady.value = true

    // refetch with selected contract (ensures correct contract context)
    await fetchRecordForSelectedContract()
  } catch (e) {
    console.error('UserLeavePreviewModal open error', e)
    error.value = e?.response?.data?.message || e?.message || 'Failed to load your leave record.'
    showToast({ type: 'error', title: 'Preview failed', message: error.value })
  } finally {
    loading.value = false
  }
}

function close() {
  emit('close')
}

/* contract change -> refetch */
watch(
  () => selectedContractId.value,
  async () => {
    if (!props.open) return
    if (!contractWatchReady.value) return
    try {
      loading.value = true
      error.value = ''
      clearRowSig()
      clearBlobCache()
      await fetchRecordForSelectedContract()
    } catch (e) {
      console.error('contract refetch error', e)
      error.value = e?.response?.data?.message || e?.message || 'Failed to load record.'
    } finally {
      loading.value = false
    }
  }
)

watch(
  () => props.open,
  (v) => {
    if (v) openAndLoad()
    else {
      clearRowSig()
      clearBlobCache()
      record.value = null
      error.value = ''
      loading.value = false
      contractOptions.value = []
      selectedContractId.value = ''
      contractWatchReady.value = false
      metaCache.clear()
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  clearRowSig()
  clearBlobCache()
})

/* ───────── Vector Print-to-PDF ───────── */
async function printPdf() {
  try {
    const el = previewRef.value
    if (!el) return

    await nextTick()

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>My Leave Record</title>
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
    table.sheet-table { width:100%; border-collapse:collapse; border-spacing:0; font-size:10.5px; margin-top:5px; }
    .sheet-table th, .sheet-table td { border: 0.5pt solid #111827; padding: 4px 4px; vertical-align: top; }
    .sheet-table thead th { background:#e7e3da; text-align:center; font-weight:800; }
    .center { text-align:center; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
    .nowrap { white-space:nowrap; }
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
    console.error('printPdf error', e)
    showToast({ type: 'error', title: 'PDF failed', message: e?.message || 'Cannot export PDF.' })
  }
}
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-[60]">
    <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" @click="close" />

    <div class="absolute inset-0 p-0">
      <div class="h-full w-full bg-white dark:bg-slate-950 flex flex-col">
        <!-- Top bar -->
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <div class="min-w-[260px]">
            <div class="text-[12px] font-semibold text-slate-900 dark:text-white">
              My Leave Record — <span class="font-mono">{{ me?.employeeId || me?.loginId }}</span>
            </div>

            <div class="text-[11px] text-slate-500 dark:text-slate-300">
              As of: <span class="font-mono">{{ previewAsOfYMD }}</span>
            </div>

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
              :disabled="loading || !record"
              @click="printPdf"
            >
              <i class="fa-solid fa-print text-[11px]" />
              Print / PDF
            </button>

            <button
              class="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800
                     dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
              @click="close"
            >
              <i class="fa-solid fa-xmark text-[11px]" />
              Close
            </button>
          </div>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto bg-slate-100/70 p-3 sm:p-4 dark:bg-slate-900">
          <div
            v-if="error"
            class="mb-3 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-[11px] text-rose-700
                   dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100"
          >
            {{ error }}
          </div>

          <div v-if="loading" class="space-y-2">
            <div class="h-10 w-full animate-pulse rounded-xl bg-slate-200/90 dark:bg-slate-800/70" />
            <div class="h-14 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/60" />
            <div class="h-14 w-full animate-pulse rounded-xl bg-slate-200/80 dark:bg-slate-800/60" />
          </div>

          <div v-else class="w-full">
            <div class="mx-auto w-fit rounded-xl bg-white p-2 sm:p-3 shadow-sm dark:bg-white">
              <div ref="previewRef" class="print-sheet">
                <div class="sheet-header">
                  <div>
                    <div class="sheet-title">Leave Record - Foreigner</div>
                    <div class="text-[10px] text-slate-700">
                      Contract:
                      <span class="mono">{{ selectedContract?.from || '—' }}</span>
                      <span class="mx-1">→</span>
                      <span class="mono">{{ selectedContract?.to || '—' }}</span>
                    </div>
                    <div class="text-[10px] text-slate-700">
                      As of:
                      <span class="mono">{{ previewAsOfYMD }}</span>
                    </div>
                  </div>
                  <div class="sheet-brand">
                    <img src="/brand/trax-logo.png" alt="TRAX" class="sheet-logo" />
                  </div>
                </div>

                <div class="sheet-line"></div>

                <table class="sheet-table">
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
                      <th colspan="3">Approved by</th>
                      <th rowspan="2">Remark</th>
                    </tr>
                    <tr>
                      <th>From</th>
                      <th>To</th>
                      <th>Day</th>
                      <th>Remain</th>
                      <th>Manager</th>
                      <th>GM</th>
                      <th>COO</th>
                    </tr>
                  </thead>

                  <tbody>
                    <tr v-for="(r, idx) in computedRows" :key="idx">
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
                          <img v-if="rowSig.get(rowKey(r))?.recordBy" :src="rowSig.get(rowKey(r))?.recordBy" class="sig-img" />
                        </div>
                      </td>

                      <td class="small">
                        <div class="sig-cell">
                          <img v-if="rowSig.get(rowKey(r))?.checkedBy" :src="rowSig.get(rowKey(r))?.checkedBy" class="sig-img" />
                        </div>
                      </td>

                      <td class="small">
                        <div class="sig-cell">
                          <img
                            v-if="rowSig.get(rowKey(r))?.manager && showManagerSignatureForRow(r)"
                            :src="rowSig.get(rowKey(r))?.manager"
                            class="sig-img"
                          />
                        </div>
                      </td>

                      <td class="small">
                        <div class="sig-cell">
                          <img
                            v-if="rowSig.get(rowKey(r))?.gm && showGmSignatureForRow(r)"
                            :src="rowSig.get(rowKey(r))?.gm"
                            class="sig-img"
                          />
                        </div>
                      </td>

                      <td class="small">
                        <div class="sig-cell">
                          <img
                            v-if="rowSig.get(rowKey(r))?.coo && showCooSignatureForRow(r)"
                            :src="rowSig.get(rowKey(r))?.coo"
                            class="sig-img"
                          />
                        </div>
                      </td>

                      <td class="remark">{{ r.remark || '' }}</td>
                    </tr>

                    <tr v-for="n in Math.max(0, 18 - computedRows.length)" :key="'blank-' + n">
                      <td v-for="c in 14" :key="c">&nbsp;</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div v-if="record" class="mt-2 text-[11px] text-slate-500 dark:text-slate-300">
              Tip: Print → “Save as PDF”, turn off “Headers and footers”.
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
.sheet-header { display:flex; align-items:flex-end; justify-content:space-between; gap:10px; }
.sheet-title { font-size:16px; font-weight:800; letter-spacing:0.2px; }
.sheet-brand { display:flex; justify-content:flex-end; align-items:center; }
.sheet-logo { height:24px !important; width:auto !important; max-width:60mm !important; object-fit:contain; display:block; }
.sheet-line { height:2px; background:#14532d; margin:6px 0 8px 0; opacity:0.9; }

.sheet-table { width:100%; border-collapse:collapse; font-size:10.5px; margin-top:5px; }
.sheet-table th, .sheet-table td { border: 0.6px solid #111827; padding: 4px 4px; vertical-align: top; }
.sheet-table thead th { background:#e7e3da; text-align:center; font-weight:800; }

.small { font-size:10px; }
.remark { font-size:10px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; }
.nowrap { white-space:nowrap; }
.center { text-align:center; }

.sig-cell { display:flex; align-items:flex-end; justify-content:center; min-height:16mm; }
.sig-img { max-height:16mm; max-width:100%; object-fit:contain; }
</style>

<style>
@page { size: A4; margin: 0; }
</style>
