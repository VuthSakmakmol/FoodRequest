<!-- src/views/expat/user/components/UserLeavePreviewModal.vue
  ✅ AdminGmAndCooReport-style fullscreen preview
  ✅ Uses /leave/user/record (NOT admin endpoints)
  ✅ Contract selector (from parent contracts)
  ✅ Preview uses asOf = selected contract end date (contract.to)
  ✅ Vector Print-to-PDF (iframe print)
  ✅ Signatures (best-effort):
      - Record By => employee signature (employeeId)
      - Checked by => leave_admin signature
      - Manager => shown after manager approved
      - GM => shown after gm approved (or final)
    If signature endpoints blocked => it will just show blank cells (no crash)
-->

<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'

defineOptions({ name: 'UserLeavePreviewModal' })

const props = defineProps({
  open: { type: Boolean, default: false },
  me: { type: Object, default: () => ({}) }, // { employeeId, name, department, joinDate, approvalMode, ... }
  contracts: { type: Array, default: () => [] }, // [{ id, idx, from, to, label, isCurrent }]
  contractId: { type: String, default: '' },
})

const emit = defineEmits(['close', 'update:contractId'])

const { showToast } = useToast()

/* ───────── helpers ───────── */
const s = (v) => String(v ?? '').trim()
const ymd = (v) => {
  const t = s(v)
  if (!t) return ''
  const d = dayjs(t)
  return d.isValid() ? d.format('YYYY-MM-DD') : t
}
const up = (v) => s(v).toUpperCase()
const upStatus = (v) => String(v || '').toUpperCase().trim()

function fmtYMD(v) {
  const t = s(v)
  if (!t) return ''
  const d = dayjs(t)
  return d.isValid() ? d.format('YYYY-MM-DD') : t
}

/* ───────── contract selection ───────── */
const selectedContract = computed(() => {
  const id = s(props.contractId)
  return (props.contracts || []).find((c) => s(c.id) === id) || null
})

const currentContract = computed(() => {
  const arr = props.contracts || []
  return arr.find((x) => x.isCurrent) || arr[arr.length - 1] || null
})

const previewAsOfYMD = computed(() => {
  // ✅ SAME as admin: use contract end date
  const end = ymd(selectedContract.value?.to || currentContract.value?.to)
  return end || dayjs().format('YYYY-MM-DD')
})

/* ───────── preview state ───────── */
const previewLoading = ref(false)
const previewError = ref('')
const previewData = ref(null) // { meta, rows }
const previewRef = ref(null)

/* ───────── signature rules (MANAGER+GM flow) ─────────
   Your backend status chain for user record usually:
   - PENDING_MANAGER -> PENDING_GM -> APPROVED
   If your statuses differ, adjust here.
*/
function showManagerSignatureForRow(r) {
  const st = upStatus(r?.status)
  return st === 'PENDING_GM' || st === 'APPROVED'
}
function showGmSignatureForRow(r) {
  const st = upStatus(r?.status)
  return st === 'APPROVED'
}

/* ───────── fetch record (user endpoint) ───────── */
async function fetchRecordForContract() {
  const c = selectedContract.value || currentContract.value
  const params = { ts: Date.now(), asOf: previewAsOfYMD.value }

  // prefer contractId if looks like ObjectId
  if (c?.id && /^[a-f0-9]{24}$/i.test(String(c.id))) {
    params.contractId = c.id
  } else if (c?.from && c?.to) {
    params.from = c.from
    params.to = c.to
  } else if (c?.from && !c?.to) {
    params.from = c.from
    params.to = params.asOf
  }

  const res = await api.get('/leave/user/record', { params })
  previewData.value = res?.data || null
}

/* ───────── signature (best-effort) ───────── */
const LEAVE_ADMIN_LOGIN = 'leave_admin'

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
  const u = s(urlOrPath)
  if (!u) return ''
  if (/^https?:\/\//i.test(u)) return u

  const apiBase = s(import.meta.env.VITE_API_URL || '')
    .replace(/\/api\/?$/i, '')
    .replace(/\/$/, '')

  const origin = apiBase || (typeof window !== 'undefined' ? window.location.origin : '')
  return `${origin}${u.startsWith('/') ? '' : '/'}${u}`
}
async function toAuthedBlobUrl(rawUrl) {
  const u = s(rawUrl)
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

const metaCache = new Map()
const blobCache = new Map()

function clearSigCaches() {
  for (const v of blobCache.values()) revokeIfBlob(v)
  metaCache.clear()
  blobCache.clear()
}

async function getSignatureMetaUrl(idLike) {
  const id = s(idLike)
  if (!id) return ''

  const key = `meta:${id}`
  if (metaCache.has(key)) return metaCache.get(key) || ''

  // Best effort endpoints (some deployments block these for user)
  const endpoints = [
    `/leave/user/signatures/${encodeURIComponent(id)}`, // optional if you add later
    `/admin/signatures/users/${encodeURIComponent(id)}`,
    `/admin/signatures/employees/${encodeURIComponent(id)}`,
  ]

  for (const ep of endpoints) {
    try {
      const res = await api.get(ep)
      const url = res?.data?.signatureUrl || res?.data?.url || ''
      if (url) {
        metaCache.set(key, url)
        return url
      }
    } catch {
      // ignore
    }
  }

  metaCache.set(key, '')
  return ''
}

async function metaUrlToBlob(metaUrl) {
  const m = s(metaUrl)
  if (!m) return ''
  if (blobCache.has(m)) return blobCache.get(m) || ''
  const b = await toAuthedBlobUrl(m)
  blobCache.set(m, b || '')
  return b || ''
}

/* per-row signature cache */
const rowSig = ref(new Map()) // key -> { recordBy, checkedBy, manager, gm }
function rowKey(r) {
  return `${s(r?.date)}|${s(r?.from)}|${s(r?.to)}|${s(r?.leaveTypeCode)}|${s(r?.status)}|${s(r?.remark)}`
}
function clearRowSig() {
  rowSig.value = new Map()
}
function setRowSig(k, v) {
  const m = new Map(rowSig.value)
  m.set(k, v)
  rowSig.value = m
}

async function ensureRowSignatures(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const jobs = []

  // these come from profile meta normally
  const managerId = s(previewData.value?.meta?.managerLoginId || '')
  const gmId = s(previewData.value?.meta?.gmLoginId || '')

  for (const r of list) {
    const k = rowKey(r)
    if (rowSig.value.has(k)) continue

    const recordByEmployeeId = s(props.me?.employeeId || r?.employeeId || r?.recordByEmployeeId || '')
    const checkedById = LEAVE_ADMIN_LOGIN

    jobs.push(
      (async () => {
        const [recMeta, chkMeta, mgrMeta, gmMeta] = await Promise.all([
          getSignatureMetaUrl(recordByEmployeeId),
          getSignatureMetaUrl(checkedById),
          getSignatureMetaUrl(managerId),
          getSignatureMetaUrl(gmId),
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

/* ───────── open / refetch ───────── */
async function openAndLoad() {
  previewLoading.value = true
  previewError.value = ''
  previewData.value = null
  clearRowSig()
  clearSigCaches()

  try {
    await fetchRecordForContract()
    // signatures are best-effort; if blocked, it stays blank (no crash)
    await ensureRowSignatures(previewData.value?.rows || [])
  } catch (e) {
    console.error('User preview load error', e)
    previewError.value = e?.response?.data?.message || e?.message || 'Failed to load leave record.'
  } finally {
    previewLoading.value = false
  }
}

watch(
  () => props.open,
  async (v) => {
    if (v) await openAndLoad()
  }
)

watch(
  () => props.contractId,
  async () => {
    if (!props.open) return
    await openAndLoad()
  }
)

function closePreview() {
  emit('close')
}

/* ───────── Print-to-PDF (vector iframe) ───────── */
async function downloadPdf() {
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
    .sheet-table th, .sheet-table td { border: 0.5pt solid #111827; padding: 4px 4px; vertical-align: top; }
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
    console.error('downloadPdf error', e)
    showToast({ type: 'error', title: 'PDF failed', message: e?.message || 'Cannot export PDF.' })
  }
}

onBeforeUnmount(() => {
  clearRowSig()
  clearSigCaches()
})
</script>

<template>
  <!-- FULLSCREEN modal exactly like admin -->
  <div v-if="open" class="fixed inset-0 z-[60]">
    <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" @click="closePreview" />

    <div class="absolute inset-0 p-0">
      <div class="h-full w-full bg-white dark:bg-slate-950 flex flex-col">
        <!-- Top bar -->
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <div class="min-w-[260px]">
            <div class="text-[12px] font-semibold text-slate-900 dark:text-white">
              My Leave Record — <span class="font-mono">{{ me?.employeeId }}</span>
            </div>

            <div class="text-[11px] text-slate-500 dark:text-slate-300">
              Contract:
              <span class="font-mono">{{ selectedContract?.from || currentContract?.from || '—' }}</span>
              <span class="mx-1">→</span>
              <span class="font-mono">{{ selectedContract?.to || currentContract?.to || '—' }}</span>
              <span class="mx-2">·</span>
              As of: <span class="font-mono">{{ previewAsOfYMD }}</span>
            </div>

            <!-- Contract selector -->
            <div class="mt-1 flex flex-wrap items-center gap-2">
              <div class="text-[11px] text-slate-500 dark:text-slate-300">Contract:</div>

              <select
                class="h-8 rounded-xl border border-slate-300 bg-white px-2 text-[11px] outline-none
                       focus:border-slate-400 focus:ring-2 focus:ring-slate-200
                       dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100 dark:focus:border-slate-600 dark:focus:ring-slate-800/70"
                :value="contractId"
                @change="emit('update:contractId', $event.target.value)"
              >
                <option v-for="c in contracts" :key="c.id" :value="c.id">
                  {{ c.isCurrent ? `${c.label} (Current)` : c.label }}
                </option>
              </select>
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

          <div v-else class="w-full">
            <div class="mx-auto w-fit rounded-xl bg-white p-2 sm:p-3 shadow-sm dark:bg-white">
              <div ref="previewRef" class="print-sheet">
                <div class="sheet-header">
                  <div>
                    <div class="sheet-title">Leave Record - Foreigner</div>
                    <div class="text-[10px] text-slate-700">
                      Contract:
                      <span class="mono">{{ selectedContract?.from || currentContract?.from || '—' }}</span>
                      <span class="mx-1">→</span>
                      <span class="mono">{{ selectedContract?.to || currentContract?.to || '—' }}</span>
                    </div>
                    <div class="text-[10px] text-slate-700">
                      As of: <span class="mono">{{ previewAsOfYMD }}</span>
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
                    <div class="meta-value">{{ me?.name || previewData?.meta?.name || '' }}</div>

                    <div class="meta-label">ID:</div>
                    <div class="meta-value mono">{{ me?.employeeId || previewData?.meta?.employeeId || '' }}</div>

                    <div class="meta-label">Department:</div>
                    <div class="meta-value">{{ me?.department || previewData?.meta?.department || '' }}</div>

                    <div class="meta-label">Section:</div>
                    <div class="meta-value">{{ previewData?.meta?.section || 'Foreigner' }}</div>
                  </div>

                  <div class="meta-row">
                    <div class="meta-label">Date Join:</div>
                    <div class="meta-value mono">{{ fmtYMD(me?.joinDate || previewData?.meta?.joinDate) || '' }}</div>
                    <div class="meta-legend">
                      <span class="meta-label">Leave Type:</span>
                      <span><b>AL</b>: Annual Leave</span>
                      <span><b>SL</b>: Sick Leave</span>
                      <span><b>ML</b>: Maternity Leave</span>
                      <span><b>UL</b>: Unpaid Leave</span>
                    </div>
                  </div>
                </div>

                <!-- SAME TABLE STYLE AS ADMIN (Manager + GM) -->
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

                      <!-- Record By (employee) -->
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

                      <!-- Manager -->
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

                      <!-- GM -->
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
</template>

<style scoped>
/* printable sheet (same as admin) */
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
</style>

<style>
@page {
  size: A4;
  margin: 0;
}
</style>
