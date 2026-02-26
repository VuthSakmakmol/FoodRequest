<!-- src/views/expat/MyRequests.vue
  ✅ Responsive: mobile cards + desktop table
  ✅ Files column SAME style as UserMySwapDay:
     - show paperclip icon + 1/2/3… when attachments exist
     - show — when none
     - centered column (desktop)
     - mobile shows file button only when exist
  ✅ Click Files => instantly preview inside modal (PDF iframe or image)
  ✅ Fullscreen preview overlay
  ✅ No "Clear previews", no per-file eye icon
  ✅ Delete attachment confirm modal (locked after approval started)
  ✅ Edit request (only before any approval happened)

  ✅ EDIT MODAL UPDATED (FIXED):
     - Single-day can be FULL or HALF (AM/PM)
     - Multi-day: Start day AM/PM optional, End day AM/PM optional (at least one edge required)
     - Hint text shows what user is selecting

  ✅ Cancel FIX:
     - allow cancel while pending at ANY level (PENDING_MANAGER / PENDING_GM / PENDING_COO)
     - supports new modes like GM_ONLY (starts at PENDING_GM)

  ✅ Dialog/Modal improvements:
     - ESC closes top-most modal
     - backdrop click closes (files/fullscreen)
     - body scroll lock when any modal open
     - responsive heights + scroll areas (no overflow on mobile)
-->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/store/auth'
import { subscribeEmployeeIfNeeded, subscribeUserIfNeeded, onSocket } from '@/utils/socket'

defineOptions({ name: 'MyRequests' })

const { showToast } = useToast()
const auth = useAuth()

/* ───────── Identity for realtime ───────── */
const employeeId = computed(() => String(auth.user?.employeeId || localStorage.getItem('employeeId') || '').trim())
const loginId = computed(() => String(auth.user?.id || localStorage.getItem('loginId') || '').trim())

/* ───────── responsive flag ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────── STATE ───────── */
const loadingMyRequests = ref(false)
const loadError = ref('')
const myRequests = ref([])

const search = ref('')
const statusFilter = ref('ALL')

// pagination
const page = ref(1)
const perPage = ref(10)
const perPageOptions = [10, 20, 50, 'All']

const STATUS_LABEL = {
  ALL: 'All',
  PENDING_MANAGER: 'Pending (Mgr)',
  PENDING_GM: 'Pending (GM)',
  PENDING_COO: 'Pending (COO)',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
}
function statusLabel(s) {
  const key = String(s || '').toUpperCase()
  return STATUS_LABEL[key] || key || '—'
}
function statusBadgeUiClass(s) {
  const st = String(s || '').toUpperCase()
  if (st === 'APPROVED') return 'ui-badge ui-badge-success'
  if (st === 'REJECTED') return 'ui-badge ui-badge-danger'
  if (st === 'CANCELLED') return 'ui-badge'
  if (st === 'PENDING_MANAGER' || st === 'PENDING_GM' || st === 'PENDING_COO') return 'ui-badge ui-badge-warning'
  return 'ui-badge'
}

/**
 * ✅ Cancel allowed while pending at any level
 * (supports GM_ONLY which starts at PENDING_GM)
 */
function canCancel(item) {
  const st = String(item?.status || '').toUpperCase()
  return ['PENDING_MANAGER', 'PENDING_GM', 'PENDING_COO'].includes(st)
}

/**
 * ✅ Edit allowed only if NO one approved/acted yet
 */
function canEdit(item) {
  const st = String(item?.status || '').toUpperCase()
  if (!['PENDING_MANAGER', 'PENDING_GM', 'PENDING_COO'].includes(st)) return false
  const approvals = Array.isArray(item?.approvals) ? item.approvals : []
  const anyApproved = approvals.some((a) => String(a?.status || '').toUpperCase() === 'APPROVED')
  const anyRejected = approvals.some((a) => String(a?.status || '').toUpperCase() === 'REJECTED')
  const anyActed = approvals.some((a) => !!a?.actedAt)
  return !(anyApproved || anyRejected || anyActed)
}

/* ───────── Cancel modal ───────── */
const cancelOpen = ref(false)
const cancelItem = ref(null)
const cancelling = ref(false)

function openCancel(item) {
  cancelItem.value = item
  cancelOpen.value = true
}
function closeCancel() {
  cancelOpen.value = false
  cancelItem.value = null
}
async function confirmCancel() {
  if (!cancelItem.value?._id) return
  if (!canCancel(cancelItem.value)) {
    showToast({ type: 'info', title: 'Cannot cancel', message: 'You can only cancel while request is still pending.' })
    closeCancel()
    return
  }

  cancelling.value = true
  try {
    await api.post(`/leave/requests/${cancelItem.value._id}/cancel`)
    showToast({ type: 'success', title: 'Cancelled', message: 'Your request has been cancelled.' })
    closeCancel()
    await fetchMyRequests(true)
  } catch (e) {
    const msg = e?.response?.data?.message || 'Failed to cancel request.'
    showToast({ type: 'error', title: 'Cancel failed', message: msg })
  } finally {
    cancelling.value = false
  }
}

/* ───────── Leave types (for Edit dropdown) ───────── */
const loadingTypes = ref(false)
const leaveTypes = ref([])
const typesError = ref('')

function cleanTypeName(name, code) {
  const n = String(name || '').trim()
  const c = String(code || '').trim().toUpperCase()
  if (!n) return c || ''
  if (!c) return n
  const re = new RegExp(`\\s*\\(\\s*${c}\\s*\\)\\s*$`, 'i')
  return n.replace(re, '').trim() || n
}

async function fetchLeaveTypes() {
  try {
    loadingTypes.value = true
    typesError.value = ''
    const res = await api.get('/leave/types')
    let data = Array.isArray(res.data) ? res.data : []
    data = data.filter((t) => t.isActive !== false)

    data = data.map((t) => {
      const code = String(t?.code || '').trim().toUpperCase()
      const name = cleanTypeName(t?.name, code)
      return { ...t, code, name }
    })

    leaveTypes.value = data
    if (!data.length) typesError.value = 'No leave types configured.'
  } catch (e) {
    typesError.value = e?.response?.data?.message || 'Unable to load leave types.'
    leaveTypes.value = []
  } finally {
    loadingTypes.value = false
  }
}

/* ─────────────────────────────────────────────────────────────
   Attachments Preview Modal (instant preview)
───────────────────────────────────────────────────────────── */
const filesOpen = ref(false)
const filesRequest = ref(null)
const filesLoading = ref(false)
const filesError = ref('')
const filesItems = ref([])
const selectedAttId = ref('')
const previewUrlMap = ref({})
const previewLoadingMap = ref({})
const previewErrorMap = ref({})

function isImageType(ct = '') {
  return String(ct || '').toLowerCase().startsWith('image/')
}
function isPdfType(ct = '') {
  return String(ct || '').toLowerCase().includes('pdf')
}
function revokeUrl(url) {
  try {
    if (url) URL.revokeObjectURL(url)
  } catch {}
}
function clearAllPreviews() {
  const m = previewUrlMap.value || {}
  Object.keys(m).forEach((k) => revokeUrl(m[k]))
  previewUrlMap.value = {}
  previewLoadingMap.value = {}
  previewErrorMap.value = {}
}

async function fetchFiles(requestId) {
  filesLoading.value = true
  filesError.value = ''
  filesItems.value = []
  try {
    const res = await api.get(`/leave/requests/${requestId}/attachments`)
    const items = Array.isArray(res.data?.items) ? res.data.items : Array.isArray(res.data) ? res.data : []
    filesItems.value = items
      .map((x) => ({
        attId: String(x?.attId || '').trim(),
        filename: String(x?.filename || 'file').trim(),
        contentType: String(x?.contentType || '').trim(),
        size: Number(x?.size || 0),
        uploadedAt: x?.uploadedAt || null,
        uploadedBy: String(x?.uploadedBy || '').trim(),
        note: String(x?.note || '').trim(),
      }))
      .filter((x) => x.attId)

    selectedAttId.value = filesItems.value[0]?.attId || ''
    if (selectedAttId.value) await ensurePreview(requestId, selectedAttId.value)
  } catch (e) {
    filesError.value = e?.response?.data?.message || 'Failed to load attachments.'
  } finally {
    filesLoading.value = false
  }
}

async function ensurePreview(requestId, attId) {
  if (!attId) return ''
  if (previewUrlMap.value?.[attId]) return previewUrlMap.value[attId]
  if (previewLoadingMap.value?.[attId]) return ''

  previewLoadingMap.value = { ...previewLoadingMap.value, [attId]: true }
  previewErrorMap.value = { ...previewErrorMap.value, [attId]: '' }

  try {
    const res = await api.get(`/leave/requests/${requestId}/attachments/${attId}/content`, { responseType: 'blob' })
    const url = URL.createObjectURL(res?.data)
    previewUrlMap.value = { ...previewUrlMap.value, [attId]: url }
    return url
  } catch (e) {
    previewErrorMap.value = { ...previewErrorMap.value, [attId]: e?.response?.data?.message || 'Preview failed.' }
    return ''
  } finally {
    previewLoadingMap.value = { ...previewLoadingMap.value, [attId]: false }
  }
}

async function openFiles(item) {
  if (!item?._id) return
  filesRequest.value = item
  filesOpen.value = true
  clearAllPreviews()
  selectedAttId.value = ''
  await fetchFiles(item._id)
}
function closeFiles() {
  filesOpen.value = false
  filesRequest.value = null
  filesItems.value = []
  selectedAttId.value = ''
  filesError.value = ''
  clearAllPreviews()
}
async function selectFile(attId) {
  selectedAttId.value = attId
  if (!filesRequest.value?._id) return
  await ensurePreview(filesRequest.value._id, attId)
}

/* ───────── Fullscreen Preview Overlay ───────── */
const fullOpen = ref(false)
function openFullscreen() {
  if (!selectedAttId.value) return
  fullOpen.value = true
}
function closeFullscreen() {
  fullOpen.value = false
}

/* ───────── Delete attachment confirm ───────── */
const delOpen = ref(false)
const delTarget = ref({ requestId: '', attId: '', filename: '' })
const deleting = ref(false)

const canDeleteFiles = computed(() => {
  // delete only if edit allowed (no approval started)
  return canEdit(filesRequest.value)
})

function askDeleteAttachment(requestId, attId, filename) {
  delTarget.value = { requestId, attId, filename }
  delOpen.value = true
}
function closeDeleteAttachment() {
  delOpen.value = false
  delTarget.value = { requestId: '', attId: '', filename: '' }
}
async function confirmDeleteAttachment() {
  const { requestId, attId } = delTarget.value || {}
  if (!requestId || !attId) return

  if (!canDeleteFiles.value) {
    showToast({ type: 'info', title: 'Locked', message: 'Attachments are locked after approval started.' })
    closeDeleteAttachment()
    return
  }

  deleting.value = true
  try {
    await api.delete(`/leave/requests/${requestId}/attachments/${attId}`)
    showToast({ type: 'success', title: 'Deleted', message: 'Attachment removed.' })

    const url = previewUrlMap.value?.[attId]
    revokeUrl(url)
    const next = { ...(previewUrlMap.value || {}) }
    delete next[attId]
    previewUrlMap.value = next

    closeDeleteAttachment()
    await fetchFiles(requestId)

    if (!filesItems.value.find((x) => x.attId === selectedAttId.value)) {
      selectedAttId.value = filesItems.value[0]?.attId || ''
      if (selectedAttId.value) await ensurePreview(requestId, selectedAttId.value)
    }
  } catch (e) {
    const msg = e?.response?.data?.message || 'Delete failed.'
    showToast({ type: 'error', title: 'Error', message: msg })
  } finally {
    deleting.value = false
  }
}

/* ─────────────────────────────────────────────────────────────
   EDIT REQUEST modal
   ✅ Single-day can be FULL or HALF (AM/PM)
   ✅ Multi-day edges optional (at least one required)
───────────────────────────────────────────────────────────── */
const editOpen = ref(false)
const editItem = ref(null)
const savingEdit = ref(false)
const editError = ref('')

const editForm = ref({
  leaveTypeCode: '',
  startDate: '',
  endDate: '',
  reason: '',

  // single-day: '' = FULL, 'AM'/'PM' = half-day
  singleHalf: '',

  // multi-day edges (optional but at least 1 edge required)
  startHalfPart: '', // AM/PM or ''
  endHalfPart: '', // AM/PM or ''
})

/* ───────── Holidays (for working-day calculation) ───────── */
const holidaySet = ref(new Set())

async function fetchHolidays() {
  try {
    const res = await api.get('/leave/holidays')
    const items = Array.isArray(res.data?.items) ? res.data.items : Array.isArray(res.data) ? res.data : []
    holidaySet.value = new Set(items.map((x) => String(x || '').trim()).filter(Boolean))
  } catch {
    holidaySet.value = new Set()
  }
}

function isWorkingDay(ymd) {
  if (!ymd) return false
  const d = dayjs(ymd)
  if (!d.isValid()) return false
  if (d.day() === 0) return false
  if (holidaySet.value?.has(String(ymd).trim())) return false
  return true
}

function countWorkingDaysInclusive(startYmd, endYmd) {
  if (!startYmd || !endYmd) return 0
  const a = dayjs(startYmd)
  const b = dayjs(endYmd)
  if (!a.isValid() || !b.isValid()) return 0
  if (b.isBefore(a, 'day')) return 0

  let count = 0
  let cur = a.startOf('day')
  const end = b.startOf('day')
  while (cur.isSame(end, 'day') || cur.isBefore(end, 'day')) {
    const ymd = cur.format('YYYY-MM-DD')
    if (isWorkingDay(ymd)) count += 1
    cur = cur.add(1, 'day')
  }
  return count
}

const isMultiDayEdit = computed(() => {
  if (!editForm.value.startDate || !editForm.value.endDate) return false
  return editForm.value.endDate > editForm.value.startDate
})

const baseWorkingDaysEdit = computed(() => {
  const s = editForm.value.startDate
  const e = editForm.value.endDate
  if (!s || !e) return 0
  return countWorkingDaysInclusive(s, e)
})

const requestedDaysEdit = computed(() => {
  const s = editForm.value.startDate
  const e = editForm.value.endDate
  if (!s || !e) return 0

  const work = baseWorkingDaysEdit.value
  if (!work) return 0

  // single-day: FULL = 1, AM/PM = 0.5
  if (!isMultiDayEdit.value) return editForm.value.singleHalf ? 0.5 : 1

  // multi-day edges
  let total = work
  if (editForm.value.startHalfPart) total -= 0.5
  if (editForm.value.endHalfPart) total -= 0.5
  return Math.max(0, total)
})

const editBreakdownText = computed(() => {
  const s = editForm.value.startDate
  const e = editForm.value.endDate
  if (!editForm.value.leaveTypeCode) return ''
  if (!s || !e) return ''

  const total = requestedDaysEdit.value
  if (!total) return '—'
  const totalStr = Number.isInteger(total) ? String(total) : String(total)

  if (!isMultiDayEdit.value) {
    if (!editForm.value.singleHalf) return `You request ${totalStr} day (FULL)`
    return `You request ${totalStr} day (half day: ${String(editForm.value.singleHalf).toUpperCase()})`
  }

  const parts = []
  if (editForm.value.startHalfPart) parts.push(`Start (${String(editForm.value.startHalfPart).toUpperCase()})`)
  if (editForm.value.endHalfPart) parts.push(`End (${String(editForm.value.endHalfPart).toUpperCase()})`)
  if (!parts.length) return `You request ${totalStr} days`
  return `You request ${totalStr} days (half edges: ${parts.join(' + ')})`
})

const halfHintText = computed(() => {
  const s = editForm.value.startDate
  const e = editForm.value.endDate
  if (!s || !e) return 'Select dates, then choose FULL / AM / PM (or edges for multi-day).'

  if (!isMultiDayEdit.value) {
    const part = editForm.value.singleHalf
    if (!part) return `Single-day: FULL day on ${s}.`
    return `Single-day: 0.5 day on ${s} (${part}).`
  }

  const a = editForm.value.startHalfPart
  const b = editForm.value.endHalfPart
  if (a && b) return `Multi-day: start ${s} (${a}) → end ${e} (${b}).`
  if (a) return `Multi-day: start ${s} (${a}) → end ${e} (FULL DAY).`
  if (b) return `Multi-day: start ${s} (FULL DAY) → end ${e} (${b}).`
  return 'Choose AM/PM for Start and/or End day (at least one).'
})

/* new evidence */
const newEvidence = ref([]) // {id,file}
const editEvidenceInputEl = ref(null)

function cryptoId() {
  return Math.random().toString(36).slice(2)
}
function isAllowedEvidence(file) {
  const t = String(file?.type || '').toLowerCase()
  return [
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ].includes(t)
}
function onPickNewEvidence(ev) {
  const files = Array.from(ev?.target?.files || [])
  for (const f of files) {
    if (!isAllowedEvidence(f)) {
      showToast({ type: 'error', title: 'File type not allowed', message: f.type || 'unknown' })
      continue
    }
    if (f.size > 5 * 1024 * 1024) {
      showToast({ type: 'error', title: 'File too large', message: `${f.name} (max 5MB)` })
      continue
    }
    newEvidence.value.push({ id: cryptoId(), file: f })
  }
  ev.target.value = ''
}
function removeNewEvidence(id) {
  const idx = newEvidence.value.findIndex((x) => x.id === id)
  if (idx >= 0) newEvidence.value.splice(idx, 1)
}

/* existing attachments list in edit modal */
const existingEditFiles = ref([])
const existingEditLoading = ref(false)

async function fetchExistingEditFiles(requestId) {
  existingEditLoading.value = true
  try {
    const res = await api.get(`/leave/requests/${requestId}/attachments`)
    const items = Array.isArray(res.data?.items) ? res.data.items : Array.isArray(res.data) ? res.data : []
    existingEditFiles.value = items
      .map((x) => ({
        attId: String(x?.attId || '').trim(),
        filename: String(x?.filename || 'file').trim(),
        contentType: String(x?.contentType || '').trim(),
        size: Number(x?.size || 0),
      }))
      .filter((x) => x.attId)
  } catch {
    existingEditFiles.value = []
  } finally {
    existingEditLoading.value = false
  }
}

async function previewExistingEditFile(file) {
  if (!editItem.value?._id || !file?.attId) return
  await openFiles(editItem.value)
  await selectFile(file.attId)
}

function openEdit(item) {
  if (!item?._id) return
  if (!canEdit(item)) {
    showToast({ type: 'info', title: 'Cannot edit', message: 'This request is already processed.' })
    return
  }

  editItem.value = item
  editOpen.value = true
  editError.value = ''
  newEvidence.value = []
  existingEditFiles.value = []

  const start = String(item.startDate || '')
  const end = String(item.endDate || start)

  const startHalf = item?.startHalf ? String(item.startHalf).toUpperCase() : ''
  const endHalf = item?.endHalf ? String(item.endHalf).toUpperCase() : ''

  const legacyHalf = !!item?.isHalfDay
  const legacyPart = item?.dayPart ? String(item.dayPart).toUpperCase() : ''

  const isMulti = end > start
  const partForSingle = startHalf || legacyPart || ''

  editForm.value = {
    leaveTypeCode: String(item.leaveTypeCode || '').toUpperCase(),
    startDate: start,
    endDate: end,
    reason: String(item.reason || ''),

    // single-day: FULL if not half-day
    singleHalf: !isMulti ? (legacyHalf ? (partForSingle || 'AM') : '') : '',

    // multi-day: allow edges based on existing data
    startHalfPart: isMulti ? (startHalf || '') : '',
    endHalfPart: isMulti ? (endHalf || '') : '',
  }

  fetchExistingEditFiles(item._id)
}

function closeEdit() {
  editOpen.value = false
  editItem.value = null
  editError.value = ''
  newEvidence.value = []
  existingEditFiles.value = []
  if (editEvidenceInputEl.value) editEvidenceInputEl.value.value = ''
}

/* keep dates valid */
watch(
  () => [editForm.value.startDate, editForm.value.endDate],
  () => {
    if (!editForm.value.startDate) return
    if (!editForm.value.endDate) editForm.value.endDate = editForm.value.startDate
    if (editForm.value.endDate < editForm.value.startDate) editForm.value.endDate = editForm.value.startDate

    // when switching from multi -> single
    if (!isMultiDayEdit.value) {
      // single day: clear edges
      editForm.value.startHalfPart = ''
      editForm.value.endHalfPart = ''
    } else {
      // multi-day: singleHalf irrelevant
      if (!editForm.value.singleHalf) editForm.value.singleHalf = ''
    }
  }
)

const canSaveEdit = computed(() => {
  if (savingEdit.value) return false
  if (!editItem.value?._id) return false
  if (!editForm.value.leaveTypeCode) return false
  if (!editForm.value.startDate) return false
  if (!editForm.value.endDate) return false
  if (editForm.value.endDate < editForm.value.startDate) return false

  // single-day: FULL or half allowed
  if (!isMultiDayEdit.value) return true

  // multi-day: at least one edge required
  return !!(editForm.value.startHalfPart || editForm.value.endHalfPart)
})

async function saveEdit() {
  if (!canSaveEdit.value) {
    editError.value = 'Please complete required fields.'
    return
  }

  savingEdit.value = true
  editError.value = ''

  try {
    const payload = {
      leaveTypeCode: editForm.value.leaveTypeCode,
      startDate: editForm.value.startDate,
      endDate: editForm.value.endDate,
      reason: editForm.value.reason || '',
    }

    if (!isMultiDayEdit.value) {
      const part = String(editForm.value.singleHalf || '').toUpperCase()
      if (part) {
        payload.isHalfDay = true
        payload.dayPart = part
        payload.startHalf = part
        payload.endHalf = null
      } else {
        payload.isHalfDay = false
        payload.dayPart = ''
        payload.startHalf = null
        payload.endHalf = null
      }
    } else {
      payload.isHalfDay = false
      payload.dayPart = ''
      payload.startHalf = editForm.value.startHalfPart ? String(editForm.value.startHalfPart).toUpperCase() : null
      payload.endHalf = editForm.value.endHalfPart ? String(editForm.value.endHalfPart).toUpperCase() : null
    }

    await api.patch(`/leave/requests/${editItem.value._id}`, payload)

    if (newEvidence.value.length) {
      const fd = new FormData()
      newEvidence.value.forEach((x) => fd.append('files', x.file))
      await api.post(`/leave/requests/${editItem.value._id}/attachments`, fd)
    }

    showToast({ type: 'success', title: 'Updated', message: 'Your request has been updated.' })
    closeEdit()
    await fetchMyRequests(true)
  } catch (e) {
    const msg = e?.response?.data?.message || 'Failed to update request.'
    editError.value = msg
    showToast({ type: 'error', title: 'Update failed', message: msg })
  } finally {
    savingEdit.value = false
  }
}

/* ───────── COMPUTED: list/pagination ───────── */
const processedRequests = computed(() => {
  const items = [...myRequests.value]
  items.sort((a, b) => (b.createdAt ? dayjs(b.createdAt).valueOf() : 0) - (a.createdAt ? dayjs(a.createdAt).valueOf() : 0))

  let result = items

  if (statusFilter.value !== 'ALL') {
    const st = String(statusFilter.value || '').toUpperCase()
    result = result.filter((r) => String(r.status || '').toUpperCase() === st)
  }

  const q = search.value.trim().toLowerCase()
  if (q) {
    result = result.filter((r) => {
      const code = String(r.leaveTypeCode || '').toLowerCase()
      const period = `${r.startDate || ''} ${r.endDate || ''}`.toLowerCase()
      const reason = String(r.reason || '').toLowerCase()
      const st = statusLabel(r.status || '').toLowerCase()
      return code.includes(q) || period.includes(q) || reason.includes(q) || st.includes(q)
    })
  }

  return result
})

const pagedRequests = computed(() => {
  if (perPage.value === 'All') return processedRequests.value
  const per = Number(perPage.value || 10)
  const start = (page.value - 1) * per
  return processedRequests.value.slice(start, start + per)
})

const pageCount = computed(() => {
  if (perPage.value === 'All') return 1
  const per = Number(perPage.value || 10)
  return Math.ceil(processedRequests.value.length / per) || 1
})

watch([search, statusFilter, perPage], () => {
  page.value = 1
})

/* ───────── API ───────── */
async function fetchMyRequests(silent = false) {
  try {
    loadingMyRequests.value = true
    loadError.value = ''
    const res = await api.get('/leave/requests/my')
    const list = Array.isArray(res.data) ? res.data : []

    // ✅ ensure attachments array exists so Files column can show count safely
    myRequests.value = list.map((r) => ({
      ...r,
      attachments: Array.isArray(r.attachments) ? r.attachments : [],
    }))
  } catch (e) {
    loadError.value = e?.response?.data?.message || 'Unable to load your leave requests.'
    if (!silent) showToast({ type: 'error', title: 'Failed to load', message: loadError.value })
  } finally {
    loadingMyRequests.value = false
  }
}

/* ───────── Realtime helpers ───────── */
function isMyDoc(payload = {}) {
  const emp = String(payload.employeeId || '').trim()
  const requester = String(payload.requesterLoginId || '').trim()
  const currentEmp = String(employeeId.value || '').trim()
  const currentLogin = String(loginId.value || '').trim()
  return (currentEmp && emp === currentEmp) || (currentLogin && requester === currentLogin)
}

let refreshTimer = null
function triggerRealtimeRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    fetchMyRequests(true)
  }, 150)
}

const offHandlers = []
function setupRealtime() {
  if (employeeId.value) subscribeEmployeeIfNeeded(employeeId.value)
  if (loginId.value) subscribeUserIfNeeded(loginId.value)

  offHandlers.push(
    onSocket('leave:req:created', (payload = {}) => {
      if (!isMyDoc(payload)) return
      triggerRealtimeRefresh()
    }),
    onSocket('leave:req:updated', (payload = {}) => {
      if (!isMyDoc(payload)) return
      triggerRealtimeRefresh()
    })
  )
}

/* ───────── modal UX: body scroll lock + ESC ───────── */
function lockBodyScroll(on) {
  if (typeof document === 'undefined') return
  const b = document.body
  if (on) b.classList.add('overflow-hidden')
  else b.classList.remove('overflow-hidden')
}

watch([cancelOpen, filesOpen, delOpen, editOpen, fullOpen], ([c, f, d, e, full]) => {
  lockBodyScroll(!!(c || f || d || e || full))
})

function onKeydown(e) {
  if (e.key !== 'Escape') return
  if (fullOpen.value) return closeFullscreen()
  if (delOpen.value) return closeDeleteAttachment()
  if (filesOpen.value) return closeFiles()
  if (editOpen.value) return closeEdit()
  if (cancelOpen.value) return closeCancel()
}

/* ───────── lifecycle ───────── */
onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateIsMobile)
    window.addEventListener('keydown', onKeydown)
  }
  await fetchHolidays()
  await fetchLeaveTypes()
  await fetchMyRequests(true)
  setupRealtime()
})

onBeforeUnmount(() => {
  clearAllPreviews()
  lockBodyScroll(false)
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateIsMobile)
    window.removeEventListener('keydown', onKeydown)
  }
  if (refreshTimer) clearTimeout(refreshTimer)
  offHandlers.forEach((off) => {
    try {
      off && off()
    } catch {}
  })
})
</script>

<template>
  <div class="ui-page">
    <div class="ui-container py-2">
      <div class="ui-card overflow-hidden">
        <!-- Header -->
        <div class="ui-hero-gradient">
          <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div class="min-w-[220px]">
              <div class="text-sm font-extrabold">History Leave Requested</div>
            </div>

            <!-- Controls -->
            <div class="grid w-full gap-2 md:w-auto md:grid-cols-[260px_220px_auto] md:items-end">
              <div>
                <label class="mb-1 block text-[11px] font-extrabold text-white/90">Search</label>
                <div class="flex items-center rounded-xl border border-white/25 bg-white/10 px-2.5 py-2 text-[11px]">
                  <i class="fa-solid fa-magnifying-glass mr-2 text-white/80" />
                  <input
                    v-model="search"
                    type="text"
                    placeholder="Type, status or reason..."
                    class="w-full bg-transparent text-[11px] text-white outline-none placeholder:text-white/70"
                  />
                </div>
              </div>

              <div>
                <label class="mb-1 block text-[11px] font-extrabold text-white/90">Status</label>
                <select
                  v-model="statusFilter"
                  class="w-full rounded-xl border border-white/25 bg-white/10 px-2.5 py-2 text-[11px] text-white outline-none"
                >
                  <option value="ALL">All</option>
                  <option value="PENDING_MANAGER">Pending (Mgr)</option>
                  <option value="PENDING_GM">Pending (GM)</option>
                  <option value="PENDING_COO">Pending (COO)</option>
                  <option value="APPROVED">Approved</option>
                  <option value="REJECTED">Rejected</option>
                  <option value="CANCELLED">Cancelled</option>
                </select>
              </div>

              <button
                type="button"
                class="ui-btn ui-btn-soft !border-white/25 !bg-white/10 !text-white hover:!bg-white/15"
                :disabled="loadingMyRequests"
                @click="fetchMyRequests()"
              >
                <i class="fa-solid fa-rotate text-[11px]" :class="loadingMyRequests ? 'fa-spin' : ''" />
                Refresh
              </button>
            </div>
          </div>
        </div>

        <!-- Body -->
        <div class="p-3">
          <div
            v-if="loadError"
            class="mb-2 rounded-2xl border border-rose-400 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700
                   dark:border-rose-500/70 dark:bg-rose-950/40 dark:text-rose-100"
          >
            {{ loadError }}
          </div>

          <div v-if="loadingMyRequests && !processedRequests.length" class="space-y-2">
            <div class="ui-skeleton h-9 w-full" />
            <div v-for="i in 3" :key="'sk-' + i" class="ui-skeleton h-14 w-full" />
          </div>

          <div v-else>
            <!-- ✅ Mobile cards -->
            <div v-if="isMobile" class="space-y-2">
              <div v-if="!pagedRequests.length" class="ui-frame p-4 text-center text-[12px] text-slate-500 dark:text-slate-400">
                You have not submitted any leave requests yet.
              </div>

              <div v-for="item in pagedRequests" :key="item._id" class="ui-card p-3">
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <div class="text-[11px] text-slate-500 dark:text-slate-400">
                      {{ item.createdAt ? dayjs(item.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
                    </div>
                    <div class="mt-1 flex flex-wrap items-center gap-2">
                      <span class="ui-badge ui-badge-info">{{ item.leaveTypeCode || '—' }}</span>
                      <span :class="statusBadgeUiClass(item.status)">{{ statusLabel(item.status) }}</span>
                    </div>
                  </div>

                  <div class="flex items-center gap-2">
                    <button
                      v-if="item.attachments?.length"
                      class="ui-btn ui-btn-xs ui-btn-soft ui-icon-btn"
                      type="button"
                      title="Attachments"
                      @click="openFiles(item)"
                    >
                      <i class="fa-solid fa-paperclip text-[11px]" />
                      <span class="ml-1">{{ item.attachments.length }}</span>
                    </button>

                    <button v-if="canEdit(item)" class="ui-btn ui-btn-soft ui-btn-xs" type="button" @click="openEdit(item)">
                      Edit
                    </button>

                    <button v-if="canCancel(item)" type="button" class="ui-btn ui-btn-rose ui-btn-xs" @click="openCancel(item)">
                      Cancel
                    </button>
                  </div>
                </div>

                <div class="mt-2 ui-divider" />

                <div class="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                  <div class="ui-frame p-2">
                    <div class="ui-label !mb-1">Leave Date</div>
                    <div class="text-[11px]">{{ item.startDate }} → {{ item.endDate }}</div>
                  </div>
                  <div class="ui-frame p-2">
                    <div class="ui-label !mb-1">Days</div>
                    <div class="font-extrabold tabular-nums">{{ Number(item.totalDays || 0).toLocaleString() }}</div>
                  </div>
                </div>

                <div class="mt-2 ui-frame p-2">
                  <div class="ui-label !mb-1">Reason</div>
                  <div class="text-[11px] text-slate-700 dark:text-slate-200">{{ item.reason || '—' }}</div>
                </div>
              </div>
            </div>

            <!-- ✅ Desktop table -->
            <div v-else class="ui-table-wrap">
              <table class="ui-table">
                <thead>
                  <tr>
                    <th class="ui-th">Created</th>
                    <th class="ui-th">Type</th>
                    <th class="ui-th">Leave Date</th>
                    <th class="ui-th">Days</th>
                    <th class="ui-th">Status</th>
                    <th class="ui-th">Reason</th>
                    <th class="ui-th text-center">File</th>
                    <th class="ui-th">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  <tr v-if="!pagedRequests.length">
                    <td colspan="8" class="ui-td py-8 text-slate-500 dark:text-slate-400">
                      You have not submitted any leave requests yet.
                    </td>
                  </tr>

                  <tr v-for="item in pagedRequests" :key="item._id" class="ui-tr-hover">
                    <td class="ui-td whitespace-nowrap">
                      {{ item.createdAt ? dayjs(item.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
                    </td>

                    <td class="ui-td">
                      <span class="ui-badge ui-badge-info">{{ item.leaveTypeCode || '—' }}</span>
                    </td>

                    <td class="ui-td whitespace-nowrap">
                      {{ item.startDate }} → {{ item.endDate }}
                    </td>

                    <td class="ui-td font-extrabold tabular-nums">
                      {{ Number(item.totalDays || 0).toLocaleString() }}
                    </td>

                    <td class="ui-td">
                      <span :class="statusBadgeUiClass(item.status)">{{ statusLabel(item.status) }}</span>
                    </td>

                    <td class="ui-td">
                      <span class="block w-full truncate text-left">{{ item.reason || '—' }}</span>
                    </td>

                    <!-- ✅ File column (SwapDay style) -->
                    <td class="ui-td text-center">
                      <button
                        v-if="item.attachments?.length"
                        class="ui-btn ui-btn-soft ui-btn-xs"
                        type="button"
                        @click="openFiles(item)"
                        title="Preview attachments"
                      >
                        <i class="fa-solid fa-paperclip text-[11px]" />
                        <span class="ml-1">{{ item.attachments.length }}</span>
                      </button>
                      <span v-else class="text-[11px] text-slate-400">—</span>
                    </td>

                    <td class="ui-td">
                      <div class="flex items-center gap-2">
                        <button v-if="canEdit(item)" type="button" class="ui-btn ui-btn-soft ui-btn-xs" @click="openEdit(item)">
                          Edit
                        </button>

                        <button v-if="canCancel(item)" type="button" class="ui-btn ui-btn-rose ui-btn-xs" @click="openCancel(item)">
                          Cancel
                        </button>

                        <span v-if="!canEdit(item) && !canCancel(item)" class="text-[11px] text-slate-400 dark:text-slate-500">—</span>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Pagination -->
            <div
              v-if="processedRequests.length"
              class="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-2 text-[11px] text-slate-600
                     dark:border-slate-700 dark:text-slate-300 sm:flex-row sm:items-center sm:justify-between"
            >
              <div class="flex items-center gap-2">
                <select v-model="perPage" class="ui-select !py-1.5 !text-[11px] !rounded-full">
                  <option v-for="opt in perPageOptions" :key="'per-' + opt" :value="opt">{{ opt }}</option>
                </select>
              </div>

              <div class="flex items-center justify-end gap-1">
                <button type="button" class="ui-pagebtn" :disabled="page <= 1" @click="page = 1">«</button>
                <button type="button" class="ui-pagebtn" :disabled="page <= 1" @click="page = Math.max(1, page - 1)">Prev</button>
                <span class="px-2 font-extrabold">Page {{ page }} / {{ pageCount }}</span>
                <button type="button" class="ui-pagebtn" :disabled="page >= pageCount" @click="page = Math.min(pageCount, page + 1)">Next</button>
                <button type="button" class="ui-pagebtn" :disabled="page >= pageCount" @click="page = pageCount">»</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Confirm Cancel Modal -->
      <div v-if="cancelOpen" class="ui-modal-backdrop">
        <div class="ui-modal p-4">
          <div class="flex items-start gap-3">
            <div
              class="grid h-10 w-10 place-items-center rounded-2xl border"
              style="border-color: rgb(var(--ui-danger) / 0.25); background: rgb(var(--ui-danger) / 0.10); color: rgb(var(--ui-danger));"
            >
              <i class="fa-solid fa-triangle-exclamation" />
            </div>

            <div class="flex-1">
              <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Cancel this request?</div>
              <div class="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                You can only cancel while request is still <span class="font-extrabold">pending</span>.
              </div>

              <div class="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
                <span class="ui-badge ui-badge-info">{{ cancelItem?.leaveTypeCode }}</span>
                <span class="mx-1 opacity-60">•</span>
                <span class="">{{ cancelItem?.startDate }} → {{ cancelItem?.endDate }}</span>
              </div>
            </div>
          </div>

          <div class="mt-4 flex justify-end gap-2">
            <button type="button" class="ui-btn ui-btn-ghost" :disabled="cancelling" @click="closeCancel">Close</button>
            <button type="button" class="ui-btn ui-btn-rose" :disabled="cancelling" @click="confirmCancel">
              <i v-if="cancelling" class="fa-solid fa-spinner animate-spin text-[11px]" />
              Confirm Cancel
            </button>
          </div>
        </div>
      </div>

      <!-- Files Preview Modal -->
      <div v-if="filesOpen" class="ui-modal-backdrop" @click.self="closeFiles">
        <div class="ui-modal ui-modal-xl p-0 overflow-hidden">
          <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <div class="min-w-0">
              <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Attachments</div>
              <div class="text-[11px] text-slate-500 dark:text-slate-400">
                {{ filesRequest?.leaveTypeCode }} • {{ filesRequest?.startDate }} → {{ filesRequest?.endDate }}
              </div>
              <div v-if="filesRequest && !canEdit(filesRequest)" class="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                Attachments are locked because approval has started.
              </div>
            </div>

            <div class="flex items-center gap-2">
              <button class="ui-btn ui-btn-ghost ui-btn-xs" type="button" @click="openFullscreen" :disabled="!selectedAttId">
                <i class="fa-solid fa-expand text-[11px]" />
                Fullscreen
              </button>
              <button class="ui-btn ui-btn-ghost ui-btn-xs" type="button" @click="closeFiles">
                <i class="fa-solid fa-xmark text-[11px]" />
                Close
              </button>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-[320px_1fr] gap-0">
            <!-- left list -->
            <div class="md:border-r border-slate-200 dark:border-slate-800 p-3 max-h-[40vh] md:max-h-[calc(100vh-140px)] overflow-auto">
              <div v-if="filesLoading" class="text-[11px] text-slate-500 dark:text-slate-400">Loading…</div>
              <div v-else-if="filesError" class="text-[11px] font-semibold text-rose-600 dark:text-rose-300">{{ filesError }}</div>
              <div v-else-if="!filesItems.length" class="text-[11px] text-slate-500 dark:text-slate-400">No files attached.</div>

              <div v-else class="space-y-2">
                <button
                  v-for="f in filesItems"
                  :key="f.attId"
                  type="button"
                  class="w-full text-left rounded-2xl border px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-900/40"
                  :class="selectedAttId === f.attId
                    ? 'border-sky-300 bg-sky-50 dark:border-sky-700/60 dark:bg-sky-950/40'
                    : 'border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-950/30'"
                  @click="selectFile(f.attId)"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="truncate text-[12px] font-extrabold text-slate-900 dark:text-slate-50">{{ f.filename }}</div>
                      <div class="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                        {{ f.uploadedAt ? dayjs(f.uploadedAt).format('YYYY-MM-DD HH:mm') : '' }}
                      </div>
                    </div>

                    <button
                      class="ui-btn ui-btn-ghost ui-btn-xs"
                      type="button"
                      :disabled="!canDeleteFiles"
                      :title="canDeleteFiles ? 'Delete' : 'Locked after approval'"
                      @click.stop="canDeleteFiles && askDeleteAttachment(filesRequest?._id, f.attId, f.filename)"
                    >
                      <i class="fa-solid fa-trash text-[11px]" />
                    </button>
                  </div>
                </button>
              </div>
            </div>

            <!-- right preview -->
            <div class="p-3">
              <div v-if="!selectedAttId" class="h-[45vh] md:h-[520px] grid place-items-center text-[12px] text-slate-500 dark:text-slate-400">
                Select a file
              </div>

              <template v-else>
                <div
                  v-if="previewLoadingMap[selectedAttId]"
                  class="h-[55vh] md:h-[520px] grid place-items-center text-[12px] text-slate-500 dark:text-slate-400"
                >
                  Loading preview…
                </div>

                <div v-else-if="previewErrorMap[selectedAttId]" class="h-[55vh] md:h-[520px] grid place-items-center text-[12px] text-rose-500">
                  {{ previewErrorMap[selectedAttId] }}
                </div>

                <template v-else>
                  <div class="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/40 overflow-hidden">
                    <iframe
                      v-if="isPdfType(filesItems.find(x => x.attId === selectedAttId)?.contentType) && previewUrlMap[selectedAttId]"
                      :src="previewUrlMap[selectedAttId]"
                      class="w-full h-[55vh] md:h-[520px]"
                      style="border: 0;"
                    />
                    <img
                      v-else-if="isImageType(filesItems.find(x => x.attId === selectedAttId)?.contentType) && previewUrlMap[selectedAttId]"
                      :src="previewUrlMap[selectedAttId]"
                      class="w-full h-[55vh] md:h-[520px] object-contain bg-white dark:bg-slate-950/40"
                    />
                    <div v-else class="h-[55vh] md:h-[520px] grid place-items-center text-[12px] text-slate-500 dark:text-slate-400">
                      Preview not available
                    </div>
                  </div>

                  <div class="mt-2">
                    <button class="ui-btn ui-btn-soft w-full" type="button" @click="openFullscreen" :disabled="!previewUrlMap[selectedAttId]">
                      <i class="fa-solid fa-expand text-[11px]" />
                      Fullscreen preview
                    </button>
                  </div>
                </template>
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- Fullscreen overlay -->
      <div v-if="fullOpen" class="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm" @click.self="closeFullscreen">
        <div class="absolute inset-0 p-3">
          <div class="h-full w-full rounded-2xl bg-white dark:bg-slate-950 overflow-hidden border border-white/10">
            <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
              <div class="min-w-0">
                <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Fullscreen preview</div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {{ filesItems.find(x => x.attId === selectedAttId)?.filename || '' }}
                </div>
              </div>
              <button class="ui-btn ui-btn-ghost ui-btn-xs" type="button" @click="closeFullscreen">
                <i class="fa-solid fa-xmark text-[11px]" />
                Close
              </button>
            </div>

            <iframe
              v-if="isPdfType(filesItems.find(x => x.attId === selectedAttId)?.contentType) && previewUrlMap[selectedAttId]"
              :src="previewUrlMap[selectedAttId]"
              class="w-full h-[calc(100%-52px)]"
              style="border:0;"
            />
            <img
              v-else-if="isImageType(filesItems.find(x => x.attId === selectedAttId)?.contentType) && previewUrlMap[selectedAttId]"
              :src="previewUrlMap[selectedAttId]"
              class="w-full h-[calc(100%-52px)] object-contain bg-white dark:bg-slate-950"
            />
            <div v-else class="h-[calc(100%-52px)] grid place-items-center text-[12px] text-slate-500 dark:text-slate-400">
              No preview
            </div>
          </div>
        </div>
      </div>

      <!-- Delete attachment confirm -->
      <div v-if="delOpen" class="ui-modal-backdrop">
        <div class="ui-modal p-4">
          <div class="flex items-start gap-3">
            <div
              class="grid h-10 w-10 place-items-center rounded-2xl border"
              style="border-color: rgb(var(--ui-danger) / 0.25); background: rgb(var(--ui-danger) / 0.10); color: rgb(var(--ui-danger));"
            >
              <i class="fa-solid fa-trash" />
            </div>

            <div class="flex-1">
              <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Delete this file?</div>
              <div class="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                Are you sure you want to delete:
                <span class="font-extrabold">{{ delTarget.filename }}</span>
              </div>
              <div v-if="!canDeleteFiles" class="mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                Locked after approval started.
              </div>
            </div>
          </div>

          <div class="mt-4 flex justify-end gap-2">
            <button type="button" class="ui-btn ui-btn-ghost" :disabled="deleting" @click="closeDeleteAttachment">Close</button>
            <button type="button" class="ui-btn ui-btn-rose" :disabled="deleting || !canDeleteFiles" @click="confirmDeleteAttachment">
              <i v-if="deleting" class="fa-solid fa-spinner animate-spin text-[11px]" />
              Delete
            </button>
          </div>
        </div>
      </div>

      <!-- Edit modal -->
      <div v-if="editOpen" class="ui-modal-backdrop">
        <div class="ui-modal ui-modal-lg p-4 overflow-auto">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Edit request</div>
              <div class="mt-1 text-[11px] text-slate-600 dark:text-slate-300">Allowed only before any approval.</div>
            </div>
            <button class="ui-btn ui-btn-ghost ui-btn-xs" type="button" @click="closeEdit">
              <i class="fa-solid fa-xmark text-[11px]" />
            </button>
          </div>

          <div class="mt-3 space-y-2.5">
            <div class="ui-card p-3">
              <div class="ui-label">Leave Type</div>
              <select v-model="editForm.leaveTypeCode" :disabled="loadingTypes || !leaveTypes.length" class="ui-select">
                <option value="" disabled>{{ loadingTypes ? 'Loading…' : 'Select leave type' }}</option>
                <option v-for="t in leaveTypes" :key="t.code" :value="t.code">{{ t.name }}</option>
              </select>
              <div v-if="typesError" class="mt-1 text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                {{ typesError }}
              </div>
            </div>

            <div class="ui-card p-3">
              <div class="grid gap-2 sm:grid-cols-2">
                <div>
                  <div class="ui-label">Start Date</div>
                  <input v-model="editForm.startDate" type="date" class="ui-date" />
                </div>
                <div>
                  <div class="ui-label">End Date</div>
                  <input v-model="editForm.endDate" type="date" class="ui-date" />
                </div>
              </div>

              <div
                class="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700
                       dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200"
              >
                <div class="font-extrabold text-[11px]">Calculation</div>
                <div class="mt-0.5">{{ editBreakdownText }}</div>
              </div>

              <div class="mt-3">
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <div class="text-[12px] font-extrabold text-slate-800 dark:text-slate-100">Half-day (FULL / AM / PM)</div>
                    <div class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{{ halfHintText }}</div>
                  </div>
                </div>

                <div class="mt-2 space-y-2">
                  <!-- single day -->
                  <div v-if="!isMultiDayEdit" class="flex justify-end gap-2">
                    <button type="button" class="sq-chip" :class="!editForm.singleHalf ? 'sq-chip-on' : ''" @click="editForm.singleHalf=''">
                      FULL
                    </button>
                    <button type="button" class="sq-chip" :class="editForm.singleHalf === 'AM' ? 'sq-chip-on' : ''" @click="editForm.singleHalf='AM'">
                      AM
                    </button>
                    <button type="button" class="sq-chip" :class="editForm.singleHalf === 'PM' ? 'sq-chip-on' : ''" @click="editForm.singleHalf='PM'">
                      PM
                    </button>
                  </div>

                  <!-- multi day edges -->
                  <div v-else class="grid gap-2 sm:grid-cols-2">
                    <div class="ui-frame p-2">
                      <div class="text-[11px] font-extrabold text-slate-700 dark:text-slate-200">Start day</div>
                      <div class="mt-2 flex justify-end gap-2">
                        <button
                          type="button"
                          class="sq-chip"
                          :class="editForm.startHalfPart === 'AM' ? 'sq-chip-on' : ''"
                          @click="editForm.startHalfPart = (editForm.startHalfPart === 'AM' ? '' : 'AM')"
                        >
                          AM
                        </button>
                        <button
                          type="button"
                          class="sq-chip"
                          :class="editForm.startHalfPart === 'PM' ? 'sq-chip-on' : ''"
                          @click="editForm.startHalfPart = (editForm.startHalfPart === 'PM' ? '' : 'PM')"
                        >
                          PM
                        </button>
                      </div>
                      <div class="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Click again to clear.</div>
                    </div>

                    <div class="ui-frame p-2">
                      <div class="text-[11px] font-extrabold text-slate-700 dark:text-slate-200">End day</div>
                      <div class="mt-2 flex justify-end gap-2">
                        <button
                          type="button"
                          class="sq-chip"
                          :class="editForm.endHalfPart === 'AM' ? 'sq-chip-on' : ''"
                          @click="editForm.endHalfPart = (editForm.endHalfPart === 'AM' ? '' : 'AM')"
                        >
                          AM
                        </button>
                        <button
                          type="button"
                          class="sq-chip"
                          :class="editForm.endHalfPart === 'PM' ? 'sq-chip-on' : ''"
                          @click="editForm.endHalfPart = (editForm.endHalfPart === 'PM' ? '' : 'PM')"
                        >
                          PM
                        </button>
                      </div>
                      <div class="mt-1 text-[10px] text-slate-500 dark:text-slate-400">Click again to clear.</div>
                    </div>
                  </div>

                  <div v-if="isMultiDayEdit && !editForm.startHalfPart && !editForm.endHalfPart" class="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                    Choose AM/PM for Start and/or End day (at least one).
                  </div>
                </div>
              </div>
            </div>

            <div class="ui-card p-3">
              <div class="ui-label">Reason</div>
              <textarea v-model="editForm.reason" class="ui-textarea" rows="2" placeholder="Optional…" />
            </div>

            <div class="ui-card p-3">
              <div class="text-[12px] font-extrabold text-slate-800 dark:text-slate-100">Add evidence (optional)</div>

              <div class="mt-2">
                <input
                  id="editEvidenceInput"
                  ref="editEvidenceInputEl"
                  type="file"
                  multiple
                  accept=".png,.jpg,.jpeg,.webp,.pdf,.doc,.docx,.xls,.xlsx"
                  class="hidden"
                  @change="onPickNewEvidence"
                />

                <div class="flex items-center justify-between gap-2">
                  <label for="editEvidenceInput" class="ui-btn ui-btn-soft" role="button" tabindex="0">
                    <i class="fa-solid fa-upload" />
                    Upload Files
                  </label>

                  <div v-if="newEvidence.length" class="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    {{ newEvidence.length }} file(s) selected
                  </div>
                </div>
              </div>

              <div v-if="newEvidence.length" class="mt-2 space-y-2">
                <div
                  v-for="e in newEvidence"
                  :key="e.id"
                  class="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2
                         dark:border-slate-800 dark:bg-slate-900/40"
                >
                  <div class="min-w-0">
                    <div class="truncate text-[12px] font-semibold text-slate-900 dark:text-slate-50">{{ e.file.name }}</div>
                    <div class="text-[10px] text-slate-500 dark:text-slate-400">{{ (e.file.size / 1024).toFixed(1) }} KB</div>
                  </div>
                  <button class="ui-btn ui-btn-ghost ui-btn-xs" type="button" @click="removeNewEvidence(e.id)">
                    <i class="fa-solid fa-xmark text-[11px]" />
                  </button>
                </div>
              </div>
            </div>

            <div class="ui-card p-3">
              <div class="flex items-center justify-between gap-2">
                <div class="text-[12px] font-extrabold text-slate-800 dark:text-slate-100">Existing attachments</div>
                <span class="ui-badge ui-badge-info text-[10px]">{{ existingEditFiles.length }} file(s)</span>
              </div>

              <div v-if="existingEditLoading" class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">Loading…</div>
              <div v-else-if="!existingEditFiles.length" class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">No files attached.</div>

              <div v-else class="mt-2 space-y-2">
                <button
                  v-for="f in existingEditFiles"
                  :key="f.attId"
                  type="button"
                  class="w-full text-left rounded-xl border border-slate-200 bg-slate-50 px-3 py-2
                         hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900/40 dark:hover:bg-slate-900/60"
                  @click="previewExistingEditFile(f)"
                >
                  <div class="truncate text-[12px] font-semibold text-slate-900 dark:text-slate-50">{{ f.filename }}</div>
                  <div class="text-[10px] text-slate-500 dark:text-slate-400">Click to preview</div>
                </button>
              </div>
            </div>

            <div v-if="editError" class="text-[11px] font-extrabold text-rose-600 dark:text-rose-400">{{ editError }}</div>

            <div class="mt-2 flex justify-end gap-2">
              <button class="ui-btn ui-btn-ghost" type="button" :disabled="savingEdit" @click="closeEdit">Close</button>
              <button class="ui-btn ui-btn-primary" type="button" :disabled="!canSaveEdit" @click="saveEdit">
                <i v-if="savingEdit" class="fa-solid fa-spinner animate-spin text-[11px]" />
                Save changes
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- end -->
    </div>
  </div>
</template>

<style scoped>
/* small square chips reused */
.sq-chip {
  @apply grid place-items-center rounded-xl border border-slate-200 bg-white text-[11px] font-extrabold text-slate-700
         hover:bg-slate-50 active:translate-y-[0.5px] disabled:opacity-40 disabled:cursor-not-allowed
         dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200 dark:hover:bg-slate-900/40;
  width: 42px;
  height: 42px;
}
.sq-chip-on {
  @apply border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700/60 dark:bg-sky-950/40 dark:text-sky-200;
}

/* icon btn padding same as your standard */
.ui-icon-btn {
  padding-left: 0.55rem !important;
  padding-right: 0.55rem !important;
}

/* modal width helpers (safe on mobile) */
.ui-modal-xl {
  width: min(1100px, calc(100vw - 16px));
  max-height: calc(100vh - 16px);
}
.ui-modal-lg {
  width: min(860px, calc(100vw - 16px));
  max-height: calc(100vh - 16px);
}
</style>