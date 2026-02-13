<!-- src/views/expat/MyRequests.vue
  ✅ Responsive: mobile cards + desktop table
  ✅ Click Files => instantly preview inside modal (PDF iframe or image)
  ✅ Fullscreen preview overlay
  ✅ No "Clear previews", no per-file eye icon
  ✅ Delete attachment confirm modal
  ✅ Edit request (only before any approval happened)
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

function canCancel(item) {
  // keep your policy: cancel only before manager approves
  return String(item?.status || '').toUpperCase() === 'PENDING_MANAGER'
}

/**
 * ✅ Edit allowed only if NO one approved yet
 * We check approvals array: none actedAt, none APPROVED/REJECTED, and still PENDING_*
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
    showToast({ type: 'info', title: 'Cannot cancel', message: 'You can only cancel before manager approval.' })
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
const filesRequest = ref(null) // whole request
const filesLoading = ref(false)
const filesError = ref('')
const filesItems = ref([]) // {attId, filename, contentType, size, uploadedAt, uploadedBy, note}
const selectedAttId = ref('')
const previewUrlMap = ref({}) // attId -> objectUrl
const previewLoadingMap = ref({}) // attId -> bool
const previewErrorMap = ref({}) // attId -> string

function isImageType(ct = '') {
  return String(ct || '').toLowerCase().startsWith('image/')
}
function isPdfType(ct = '') {
  return String(ct || '').toLowerCase().includes('pdf')
}
function revokeUrl(url) {
  try { if (url) URL.revokeObjectURL(url) } catch {}
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

    // ✅ auto select first file
    selectedAttId.value = filesItems.value[0]?.attId || ''
    if (selectedAttId.value) {
      await ensurePreview(requestId, selectedAttId.value)
    }
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
    const blob = res?.data
    const url = URL.createObjectURL(blob)
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

  // reset previews each open (clean)
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

  deleting.value = true
  try {
    await api.delete(`/leave/requests/${requestId}/attachments/${attId}`)
    showToast({ type: 'success', title: 'Deleted', message: 'Attachment removed.' })

    // remove preview url if exists
    const url = previewUrlMap.value?.[attId]
    revokeUrl(url)
    const next = { ...(previewUrlMap.value || {}) }
    delete next[attId]
    previewUrlMap.value = next

    closeDeleteAttachment()

    // refresh list
    await fetchFiles(requestId)

    // select first again if needed
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
  useHalf: false,
  singleHalf: '', // AM|PM for single day
  halfStartEnabled: false,
  halfStartPart: '', // AM|PM
  halfEndEnabled: false,
  halfEndPart: '', // AM|PM
})

const newEvidence = ref([]) // {id,file}
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

const isMultiDayEdit = computed(() => {
  if (!editForm.value.startDate || !editForm.value.endDate) return false
  return editForm.value.endDate > editForm.value.startDate
})

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

  // map existing request into UI form
  const start = String(item.startDate || '')
  const end = String(item.endDate || start)
  const isHalf = !!item.isHalfDay || (!!item.startHalf || !!item.endHalf)

  editForm.value = {
    leaveTypeCode: String(item.leaveTypeCode || '').toUpperCase(),
    startDate: start,
    endDate: end,
    reason: String(item.reason || ''),
    useHalf: isHalf,

    singleHalf: (!isMultiDay(start, end) && item.startHalf) ? String(item.startHalf || '').toUpperCase() : '',
    halfStartEnabled: isMultiDay(start, end) ? !!item.startHalf : false,
    halfStartPart: isMultiDay(start, end) ? String(item.startHalf || '').toUpperCase() : '',
    halfEndEnabled: isMultiDay(start, end) ? !!item.endHalf : false,
    halfEndPart: isMultiDay(start, end) ? String(item.endHalf || '').toUpperCase() : '',
  }
}

function closeEdit() {
  editOpen.value = false
  editItem.value = null
  editError.value = ''
  newEvidence.value = []
}

function isMultiDay(a, b) {
  if (!a || !b) return false
  return b > a
}

watch(
  () => editForm.value.useHalf,
  (on) => {
    if (!on) {
      editForm.value.singleHalf = ''
      editForm.value.halfStartEnabled = false
      editForm.value.halfStartPart = ''
      editForm.value.halfEndEnabled = false
      editForm.value.halfEndPart = ''
      return
    }
    if (isMultiDayEdit.value && !editForm.value.halfStartEnabled && !editForm.value.halfEndEnabled) {
      editForm.value.halfStartEnabled = true
    }
  }
)

watch(
  () => [editForm.value.startDate, editForm.value.endDate],
  () => {
    if (!editForm.value.startDate) return
    if (!editForm.value.endDate) editForm.value.endDate = editForm.value.startDate
    if (editForm.value.endDate < editForm.value.startDate) editForm.value.endDate = editForm.value.startDate

    if (!editForm.value.useHalf) return
    if (isMultiDayEdit.value) {
      editForm.value.singleHalf = ''
      if (!editForm.value.halfStartEnabled && !editForm.value.halfEndEnabled) editForm.value.halfStartEnabled = true
    } else {
      editForm.value.halfStartEnabled = false
      editForm.value.halfStartPart = ''
      editForm.value.halfEndEnabled = false
      editForm.value.halfEndPart = ''
    }
  }
)

function pickEditPart(target, val) {
  const v = String(val || '').toUpperCase()
  if (target === 'single') editForm.value.singleHalf = v
  if (target === 'start') editForm.value.halfStartPart = v
  if (target === 'end') editForm.value.halfEndPart = v
}
function toggleEditStartEdge() {
  editForm.value.halfStartEnabled = !editForm.value.halfStartEnabled
  if (!editForm.value.halfStartEnabled) editForm.value.halfStartPart = ''
}
function toggleEditEndEdge() {
  editForm.value.halfEndEnabled = !editForm.value.halfEndEnabled
  if (!editForm.value.halfEndEnabled) editForm.value.halfEndPart = ''
}

const canSaveEdit = computed(() => {
  if (savingEdit.value) return false
  if (!editItem.value?._id) return false
  if (!editForm.value.leaveTypeCode) return false
  if (!editForm.value.startDate) return false
  if (!editForm.value.endDate) return false
  if (editForm.value.endDate < editForm.value.startDate) return false

  if (!editForm.value.useHalf) return true
  if (!isMultiDayEdit.value) return !!editForm.value.singleHalf
  if (!editForm.value.halfStartEnabled && !editForm.value.halfEndEnabled) return false
  if (editForm.value.halfStartEnabled && !editForm.value.halfStartPart) return false
  if (editForm.value.halfEndEnabled && !editForm.value.halfEndPart) return false
  return true
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

    if (editForm.value.useHalf) {
      if (!isMultiDayEdit.value) {
        const part = String(editForm.value.singleHalf || '').toUpperCase()
        payload.isHalfDay = true
        payload.dayPart = part
        payload.startHalf = part
        payload.endHalf = null
      } else {
        payload.isHalfDay = false
        payload.dayPart = ''
        payload.startHalf = editForm.value.halfStartEnabled ? String(editForm.value.halfStartPart || '').toUpperCase() : null
        payload.endHalf = editForm.value.halfEndEnabled ? String(editForm.value.halfEndPart || '').toUpperCase() : null
      }
    } else {
      payload.isHalfDay = false
      payload.dayPart = ''
      payload.startHalf = null
      payload.endHalf = null
    }

    // ✅ PATCH request
    await api.patch(`/leave/requests/${editItem.value._id}`, payload)

    // ✅ upload new evidence (optional)
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

/* ───────── COMPUTED ───────── */
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

watch([search, statusFilter, perPage], () => { page.value = 1 })

/* ───────── API ───────── */
async function fetchMyRequests(silent = false) {
  try {
    loadingMyRequests.value = true
    loadError.value = ''
    const res = await api.get('/leave/requests/my')
    myRequests.value = Array.isArray(res.data) ? res.data : []
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
  refreshTimer = setTimeout(() => { fetchMyRequests(true) }, 150)
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

/* cleanup previews on unmount */
onBeforeUnmount(() => {
  clearAllPreviews()
})

/* ───────── lifecycle ───────── */
onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)

  await fetchLeaveTypes()        // ✅ add this
  await fetchMyRequests(true)
  setupRealtime()
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
  if (refreshTimer) clearTimeout(refreshTimer)
  offHandlers.forEach((off) => { try { off && off() } catch {} })
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
              <div class="text-sm font-extrabold">My Leave Requests</div>
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
              <div
                v-if="!pagedRequests.length"
                class="ui-frame p-4 text-center text-[12px] text-slate-500 dark:text-slate-400"
              >
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
                    <button class="ui-btn ui-btn-ghost ui-btn-xs" type="button" @click="openFiles(item)">
                      <i class="fa-solid fa-paperclip text-[11px]" />
                      Files
                    </button>

                    <button v-if="canEdit(item)" class="ui-btn ui-btn-soft ui-btn-xs" type="button" @click="openEdit(item)">
                      <i class="fa-solid fa-pen-to-square text-[11px]" />
                      Edit
                    </button>

                    <button
                      v-if="canCancel(item)"
                      type="button"
                      class="ui-btn ui-btn-rose ui-btn-xs"
                      @click="openCancel(item)"
                    >
                      <i class="fa-solid fa-xmark text-[11px]" />
                      Cancel
                    </button>
                  </div>
                </div>

                <div class="mt-2 ui-divider" />

                <div class="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                  <div class="ui-frame p-2">
                    <div class="ui-label !mb-1">Leave Date</div>
                    <div class="font-mono text-[11px]">{{ item.startDate }} → {{ item.endDate }}</div>
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
                    <th class="ui-th">Actions</th>
                    <th class="ui-th">Files</th>
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

                    <td class="ui-td whitespace-nowrap font-mono">
                      {{ item.startDate }} → {{ item.endDate }}
                    </td>

                    <td class="ui-td font-extrabold tabular-nums">
                      {{ Number(item.totalDays || 0).toLocaleString() }}
                    </td>

                    <td class="ui-td">
                      <span :class="statusBadgeUiClass(item.status)">{{ statusLabel(item.status) }}</span>
                    </td>

                    <td class="ui-td">
                      <span class="block w-full truncate text-left">
                        {{ item.reason || '—' }}
                      </span>
                    </td>

                    <td class="ui-td">
                      <div class="flex items-center gap-2">
                        <button
                          v-if="canEdit(item)"
                          type="button"
                          class="ui-btn ui-btn-soft ui-btn-xs"
                          @click="openEdit(item)"
                        >
                          <i class="fa-solid fa-pen-to-square text-[11px]" />
                          Edit
                        </button>

                        <button
                          v-if="canCancel(item)"
                          type="button"
                          class="ui-btn ui-btn-rose ui-btn-xs"
                          @click="openCancel(item)"
                        >
                          <i class="fa-solid fa-xmark text-[11px]" />
                          Cancel
                        </button>

                        <span v-if="!canEdit(item) && !canCancel(item)" class="text-[11px] text-slate-400 dark:text-slate-500">—</span>
                      </div>
                    </td>

                    <td class="ui-td">
                      <button type="button" class="ui-btn ui-btn-ghost ui-btn-xs" @click="openFiles(item)">
                        <i class="fa-solid fa-paperclip text-[11px]" />
                        View
                      </button>
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
                You can only cancel <span class="font-extrabold">before manager approval</span>.
              </div>

              <div class="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
                <span class="ui-badge ui-badge-info">{{ cancelItem?.leaveTypeCode }}</span>
                <span class="mx-1 opacity-60">•</span>
                <span class="font-mono">{{ cancelItem?.startDate }} → {{ cancelItem?.endDate }}</span>
              </div>
            </div>
          </div>

          <div class="mt-4 flex justify-end gap-2">
            <button type="button" class="ui-btn ui-btn-ghost" :disabled="cancelling" @click="closeCancel">
              Close
            </button>
            <button type="button" class="ui-btn ui-btn-rose" :disabled="cancelling" @click="confirmCancel">
              <i v-if="cancelling" class="fa-solid fa-spinner animate-spin text-[11px]" />
              Confirm Cancel
            </button>
          </div>
        </div>
      </div>

      <!-- Files Preview Modal -->
      <div v-if="filesOpen" class="ui-modal-backdrop">
        <div class="ui-modal ui-modal-xl p-0 overflow-hidden">
          <div class="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
            <div class="min-w-0">
              <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">
                Attachments
              </div>
              <div class="text-[11px] text-slate-500 dark:text-slate-400">
                {{ filesRequest?.leaveTypeCode }} • {{ filesRequest?.startDate }} → {{ filesRequest?.endDate }}
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

          <div class="grid md:grid-cols-[320px_1fr] gap-0">
            <!-- left list -->
            <div class="border-r border-slate-200 dark:border-slate-800 p-3">
              <div v-if="filesLoading" class="text-[11px] text-slate-500 dark:text-slate-400">Loading…</div>
              <div v-else-if="filesError" class="text-[11px] font-semibold text-rose-600 dark:text-rose-300">
                {{ filesError }}
              </div>
              <div v-else-if="!filesItems.length" class="text-[11px] text-slate-500 dark:text-slate-400">
                No files attached.
              </div>

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
                      <div class="truncate text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                        {{ f.filename }}
                      </div>
                      <div class="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                        {{ f.uploadedAt ? dayjs(f.uploadedAt).format('YYYY-MM-DD HH:mm') : '' }}
                      </div>
                    </div>

                    <button
                      class="ui-btn ui-btn-ghost ui-btn-xs"
                      type="button"
                      title="Delete"
                      @click.stop="askDeleteAttachment(filesRequest?._id, f.attId, f.filename)"
                    >
                      <i class="fa-solid fa-trash text-[11px]" />
                    </button>
                  </div>
                </button>
              </div>
            </div>

            <!-- right preview -->
            <div class="p-3">
              <div v-if="!selectedAttId" class="h-[420px] grid place-items-center text-[12px] text-slate-500 dark:text-slate-400">
                Select a file
              </div>

              <template v-else>
                <div v-if="previewLoadingMap[selectedAttId]" class="h-[520px] grid place-items-center text-[12px] text-slate-500 dark:text-slate-400">
                  Loading preview…
                </div>

                <div v-else-if="previewErrorMap[selectedAttId]" class="h-[520px] grid place-items-center text-[12px] text-rose-500">
                  {{ previewErrorMap[selectedAttId] }}
                </div>

                <template v-else>
                  <div class="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/40 overflow-hidden">
                    <iframe
                      v-if="isPdfType(filesItems.find(x => x.attId === selectedAttId)?.contentType) && previewUrlMap[selectedAttId]"
                      :src="previewUrlMap[selectedAttId]"
                      class="w-full h-[520px]"
                      style="border: 0;"
                    />
                    <img
                      v-else-if="isImageType(filesItems.find(x => x.attId === selectedAttId)?.contentType) && previewUrlMap[selectedAttId]"
                      :src="previewUrlMap[selectedAttId]"
                      class="w-full h-[520px] object-contain bg-white dark:bg-slate-950/40"
                    />
                    <div v-else class="h-[520px] grid place-items-center text-[12px] text-slate-500 dark:text-slate-400">
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
      <div v-if="fullOpen" class="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm">
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
            </div>
          </div>

          <div class="mt-4 flex justify-end gap-2">
            <button type="button" class="ui-btn ui-btn-ghost" :disabled="deleting" @click="closeDeleteAttachment">
              Close
            </button>
            <button type="button" class="ui-btn ui-btn-rose" :disabled="deleting" @click="confirmDeleteAttachment">
              <i v-if="deleting" class="fa-solid fa-spinner animate-spin text-[11px]" />
              Delete
            </button>
          </div>
        </div>
      </div>

      <!-- Edit modal -->
      <div v-if="editOpen" class="ui-modal-backdrop">
        <div class="ui-modal ui-modal-lg p-4">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Edit request</div>
              <div class="mt-1 text-[11px] text-slate-600 dark:text-slate-300">
                Allowed only before any approval.
              </div>
            </div>
            <button class="ui-btn ui-btn-ghost ui-btn-xs" type="button" @click="closeEdit">
              <i class="fa-solid fa-xmark text-[11px]" />
            </button>
          </div>

          <div class="mt-3 space-y-2.5">
            <div class="ui-card p-3">
              <div class="ui-label">Leave Type</div>

              <select
                v-model="editForm.leaveTypeCode"
                :disabled="loadingTypes || !leaveTypes.length"
                class="ui-select"
              >
                <option value="" disabled>
                  {{ loadingTypes ? 'Loading…' : 'Select leave type' }}
                </option>

                <!-- ✅ show ONLY clean name -->
                <option v-for="t in leaveTypes" :key="t.code" :value="t.code">
                  {{ t.name }}
                </option>
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

              <div class="mt-3 flex items-center justify-between gap-2">
                <div class="text-[12px] font-extrabold text-slate-800 dark:text-slate-100">Half-day</div>
                <label class="inline-flex items-center gap-2 text-[11px] font-extrabold text-slate-700 dark:text-slate-200">
                  <input v-model="editForm.useHalf" type="checkbox" class="h-4 w-4 rounded border-slate-300 dark:border-slate-700 dark:bg-slate-900" />
                  Enable
                </label>
              </div>

              <div v-if="editForm.useHalf" class="mt-2 space-y-2">
                <!-- single-day -->
                <div v-if="!isMultiDayEdit" class="flex justify-end gap-2">
                  <button type="button" class="sq-chip" :class="editForm.singleHalf === 'AM' ? 'sq-chip-on' : ''" @click="pickEditPart('single','AM')">AM</button>
                  <button type="button" class="sq-chip" :class="editForm.singleHalf === 'PM' ? 'sq-chip-on' : ''" @click="pickEditPart('single','PM')">PM</button>
                </div>

                <!-- multi-day -->
                <div v-else class="grid gap-2 sm:grid-cols-2">
                  <div class="ui-frame p-2">
                    <div class="text-[11px] font-extrabold text-slate-700 dark:text-slate-200">Start day half</div>
                    <div class="mt-2 flex justify-end gap-2">
                      <button type="button" class="sq-edge" :class="editForm.halfStartEnabled ? 'sq-edge-on' : ''" @click="toggleEditStartEdge">½</button>
                      <button type="button" class="sq-chip" :class="editForm.halfStartPart === 'AM' ? 'sq-chip-on' : ''" :disabled="!editForm.halfStartEnabled" @click="pickEditPart('start','AM')">AM</button>
                      <button type="button" class="sq-chip" :class="editForm.halfStartPart === 'PM' ? 'sq-chip-on' : ''" :disabled="!editForm.halfStartEnabled" @click="pickEditPart('start','PM')">PM</button>
                    </div>
                  </div>

                  <div class="ui-frame p-2">
                    <div class="text-[11px] font-extrabold text-slate-700 dark:text-slate-200">End day half</div>
                    <div class="mt-2 flex justify-end gap-2">
                      <button type="button" class="sq-edge" :class="editForm.halfEndEnabled ? 'sq-edge-on' : ''" @click="toggleEditEndEdge">½</button>
                      <button type="button" class="sq-chip" :class="editForm.halfEndPart === 'AM' ? 'sq-chip-on' : ''" :disabled="!editForm.halfEndEnabled" @click="pickEditPart('end','AM')">AM</button>
                      <button type="button" class="sq-chip" :class="editForm.halfEndPart === 'PM' ? 'sq-chip-on' : ''" :disabled="!editForm.halfEndEnabled" @click="pickEditPart('end','PM')">PM</button>
                    </div>
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
                  type="file"
                  multiple
                  accept=".png,.jpg,.jpeg,.webp,.pdf,.doc,.docx,.xls,.xlsx"
                  class="block w-full text-[12px]
                        file:mr-3 file:rounded-xl file:border-0 file:bg-sky-50 file:px-4 file:py-2
                        file:text-[12px] file:font-semibold file:text-slate-800 hover:file:bg-sky-100
                        dark:file:bg-white/10 dark:file:text-white dark:hover:file:bg-white/15"
                  @change="onPickNewEvidence"
                />
              </div>

              <div v-if="newEvidence.length" class="mt-2 space-y-2">
                <div
                  v-for="e in newEvidence"
                  :key="e.id"
                  class="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2
                        dark:border-slate-800 dark:bg-slate-900/40"
                >
                  <div class="min-w-0">
                    <div class="truncate text-[12px] font-semibold text-slate-900 dark:text-slate-50">
                      {{ e.file.name }}
                    </div>
                    <div class="text-[10px] text-slate-500 dark:text-slate-400">
                      {{ (e.file.size / 1024).toFixed(1) }} KB
                    </div>
                  </div>
                  <button class="ui-btn ui-btn-ghost ui-btn-xs" type="button" @click="removeNewEvidence(e.id)">
                    <i class="fa-solid fa-xmark text-[11px]" />
                  </button>
                </div>
              </div>
            </div>

            <div v-if="editError" class="text-[11px] font-extrabold text-rose-600 dark:text-rose-400">{{ editError }}</div>

            <div class="mt-2 flex justify-end gap-2">
              <button class="ui-btn ui-btn-ghost" type="button" :disabled="savingEdit" @click="closeEdit">
                Close
              </button>
              <button class="ui-btn ui-btn-primary" type="button" :disabled="!canSaveEdit" @click="saveEdit">
                <i v-if="savingEdit" class="fa-solid fa-spinner animate-spin text-[11px]" />
                Save changes
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
/* small square chips reused */
.sq-chip{
  @apply grid place-items-center rounded-xl border border-slate-200 bg-white text-[11px] font-extrabold text-slate-700
         hover:bg-slate-50 active:translate-y-[0.5px] disabled:opacity-40 disabled:cursor-not-allowed
         dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200 dark:hover:bg-slate-900/40;
  width: 42px;
  height: 42px;
}
.sq-chip-on{
  @apply border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700/60 dark:bg-sky-950/40 dark:text-sky-200;
}
.sq-edge{
  @apply grid place-items-center rounded-xl border border-slate-200 bg-white text-[13px] font-black text-slate-700
         hover:bg-slate-50 active:translate-y-[0.5px]
         dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200 dark:hover:bg-slate-900/40;
  width: 42px;
  height: 42px;
}
.sq-edge-on{
  @apply border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-200;
}

/* optional size variants for modal if your global css doesn't include */
.ui-modal-xl{
  width: min(1100px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
}
.ui-modal-lg{
  width: min(860px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
}
</style>