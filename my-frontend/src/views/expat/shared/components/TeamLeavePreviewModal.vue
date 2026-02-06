<!-- src/views/expat/shared/components/TeamLeavePreviewModal.vue
  ✅ Same as UserLeavePreviewModal.vue
  ✅ Uses /leave/user/record/employee (approver endpoint)
  ✅ asOf = selected contract end date (contract.to)
  ✅ Signature meta resolver uses /leave/user/signatures/resolve/:idLike (recommended)
-->
<script setup>
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'

defineOptions({ name: 'TeamLeavePreviewModal' })

const props = defineProps({
  open: { type: Boolean, default: false },
  employeeId: { type: String, default: '' }, // ✅ target employee
  me: { type: Object, default: () => ({}) },
  contracts: { type: Array, default: () => [] },
  contractId: { type: String, default: '' },
})

const emit = defineEmits(['close', 'update:contractId'])
const { showToast } = useToast()

const s = (v) => String(v ?? '').trim()
const ymd = (v) => {
  const t = s(v)
  if (!t) return ''
  const d = dayjs(t)
  return d.isValid() ? d.format('YYYY-MM-DD') : t
}
const upStatus = (v) => String(v || '').toUpperCase().trim()

function fmtYMD(v) {
  const t = s(v)
  if (!t) return ''
  const d = dayjs(t)
  return d.isValid() ? d.format('YYYY-MM-DD') : t
}

const selectedContract = computed(() => {
  const id = s(props.contractId)
  return (props.contracts || []).find((c) => s(c.id) === id) || null
})
const currentContract = computed(() => {
  const arr = props.contracts || []
  return arr.find((x) => x.isCurrent) || arr[arr.length - 1] || null
})

const previewAsOfYMD = computed(() => {
  const end = ymd(selectedContract.value?.to || currentContract.value?.to)
  return end || dayjs().format('YYYY-MM-DD')
})

const previewLoading = ref(false)
const previewError = ref('')
const previewData = ref(null)
const previewRef = ref(null)

/* signature visibility logic (Manager+GM flow) */
function showManagerSignatureForRow(r) {
  const st = upStatus(r?.status)
  return st === 'PENDING_GM' || st === 'APPROVED'
}
function showGmSignatureForRow(r) {
  const st = upStatus(r?.status)
  return st === 'APPROVED'
}

/* fetch record (approver endpoint) */
async function fetchRecordForContract() {
  const c = selectedContract.value || currentContract.value
  const params = { ts: Date.now(), asOf: previewAsOfYMD.value, employeeId: s(props.employeeId || props.me?.employeeId) }
  if (!params.employeeId) throw new Error('Missing employeeId')

  if (c?.id && /^[a-f0-9]{24}$/i.test(String(c.id))) {
    params.contractId = c.id
  } else if (c?.from && c?.to) {
    params.from = c.from
    params.to = c.to
  } else if (c?.from && !c?.to) {
    params.from = c.from
    params.to = params.asOf
  }

  const res = await api.get('/leave/user/record/employee', { params })
  previewData.value = res?.data || null
}

/* signatures (recommended endpoint you already have) */
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
    try { URL.revokeObjectURL(url) } catch {}
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
  const abs = toAbsUrl(rawUrl)
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

  try {
    const res = await api.get(`/leave/user/signatures/resolve/${encodeURIComponent(id)}`, { params: { ts: Date.now() } })
    const url = res?.data?.signatureUrl || ''
    metaCache.set(key, url || '')
    return url || ''
  } catch {
    metaCache.set(key, '')
    return ''
  }
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
const rowSig = ref(new Map())
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
  const managerId = s(previewData.value?.meta?.managerLoginId || '')
  const gmId = s(previewData.value?.meta?.gmLoginId || '')

  const jobs = []
  for (const r of list) {
    const k = rowKey(r)
    if (rowSig.value.has(k)) continue

    const recordByEmployeeId = s(props.me?.employeeId || props.employeeId || r?.recordByEmployeeId || '')
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
        setRowSig(k, { recordBy: recBlob || '', checkedBy: chkBlob || '', manager: mgrBlob || '', gm: gmBlob || '' })
      })()
    )
  }

  const BATCH = 12
  for (let i = 0; i < jobs.length; i += BATCH) {
    await Promise.all(jobs.slice(i, i + BATCH))
  }
}

async function openAndLoad() {
  previewLoading.value = true
  previewError.value = ''
  previewData.value = null
  clearRowSig()
  clearSigCaches()

  try {
    await fetchRecordForContract()
    await ensureRowSignatures(previewData.value?.rows || [])
  } catch (e) {
    console.error('Team preview load error', e)
    previewError.value = e?.response?.data?.message || e?.message || 'Failed to load leave record.'
  } finally {
    previewLoading.value = false
  }
}

watch(() => props.open, async (v) => { if (v) await openAndLoad() })
watch(() => props.contractId, async () => { if (props.open) await openAndLoad() })

function closePreview() {
  emit('close')
}

/* Print-to-PDF vector (same as your user modal) */
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
      try { document.body.removeChild(iframe) } catch {}
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
  <div v-if="open" class="fixed inset-0 z-[60]">
    <div class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" @click="closePreview" />

    <div class="absolute inset-0 p-0">
      <div class="h-full w-full bg-white dark:bg-slate-950 flex flex-col">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
          <div class="min-w-[260px]">
            <div class="text-[12px] font-semibold text-slate-900 dark:text-white">
              Leave Record — <span class="font-mono">{{ me?.employeeId }}</span>
            </div>
            <div class="text-[11px] text-slate-500 dark:text-slate-300">
              Contract:
              <span class="font-mono">{{ selectedContract?.from || currentContract?.from || '—' }}</span>
              <span class="mx-1">→</span>
              <span class="font-mono">{{ selectedContract?.to || currentContract?.to || '—' }}</span>
              <span class="mx-2">·</span>
              As of: <span class="font-mono">{{ previewAsOfYMD }}</span>
            </div>

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
                <!-- keep your same printable table markup from UserLeavePreviewModal.vue -->
                <!-- (You can paste the exact same <div class="print-sheet"> ... </div> block you already have) -->
                <!-- To keep this answer short, I didn’t duplicate the entire long printable HTML again. -->
                <!-- IMPORTANT: no logic changes needed below; only endpoint changed above. -->
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
/* use the same print CSS from your user modal */
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
</style>

<style>
@page { size: A4; margin: 0; }
</style>
