<!-- src/views/bookingRoom/user/PublicBookingRoomHistory.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import dayjs from 'dayjs'
import { useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'
import { useAuth } from '@/store/auth'

import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import socket, { subscribeEmployeeIfNeeded, subscribeUserIfNeeded } from '@/utils/socket'
import api from '@/utils/api'

import {
  getMyBookingRooms,
  updateBookingRoom,
  cancelBookingRoom,
  searchBookingRoomEmployees,
  canEditOrCancelBookingRoom,
  bookingRoomStatusLabel,
  bookingRoomTypeLabel,
} from '@/utils/bookingRoom.api'

defineOptions({ name: 'PublicBookingRoomHistory' })

const router = useRouter()
const { showToast } = useToast()
const auth = useAuth()

/* ───────────────── STATE ───────────────── */
const loading = ref(false)
const rows = ref([])

const employeeId = ref(localStorage.getItem('bookingRoomEmployeeId') || '')
const employees = ref([])
const loadingEmployees = ref(false)

const roomOptions = ref([])
const materialOptions = ref([])
const loadingMasters = ref(false)

const search = ref('')
const overallStatus = ref('ALL')
const dateFrom = ref('')
const dateTo = ref('')

const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* pagination */
const page = ref(1)
const perPage = ref(10)
const perPageOptions = [10, 20, 50, 'All']

/* edit modal */
const editOpen = ref(false)
const editBusy = ref(false)
const editItem = ref(null)
const editErrors = ref([])
const editForm = ref({
  employeeId: '',
  bookingDate: '',
  timeStart: '',
  timeEnd: '',
  meetingTitle: '',
  purpose: '',
  participantEstimate: 1,
  requirementNote: '',

  roomRequired: true,
  roomId: '',
  roomCode: '',
  roomName: '',

  materialRequired: false,
  materials: [],
})

/* detail modal */
const detailOpen = ref(false)
const detailItem = ref(null)

/* cancel */
const cancelOpen = ref(false)
const cancelBusy = ref(false)
const cancelTarget = ref(null)
const cancelReason = ref('')

/* throttled refresh flag */
let availabilityRefreshTimer = null

/* ───────────────── CONSTANTS ───────────────── */
const STATUS_OPTIONS = {
  ALL: 'All',
  PENDING: 'Pending',
  PARTIAL_APPROVED: 'Partial Approved',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
}

/* ───────────────── HELPERS ───────────────── */
function s(v) {
  return String(v ?? '').trim()
}

function up(v) {
  return s(v).toUpperCase()
}

function compactText(v) {
  return String(v || '').replace(/\s+/g, ' ').trim()
}

function arr(v) {
  return Array.isArray(v) ? v : []
}

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN
  return (h * 60) + m
}

function fmtDate(v) {
  if (!v) return '—'
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD') : String(v)
}

function fmtDateTime(v) {
  if (!v) return '—'
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : String(v)
}

function fmtTime(v) {
  return s(v) || '—'
}

function toYmdSafe(v) {
  if (!v) return ''
  const sv = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(sv)) return sv
  const d = dayjs(sv)
  return d.isValid() ? d.format('YYYY-MM-DD') : ''
}

function passDateFilter(date, from, to) {
  const d = toYmdSafe(date)
  const f1 = s(from)
  const f2 = s(to)
  if (!f1 && !f2) return true
  const start = f1 || f2
  const end = f2 || f1
  if (!d) return false
  return d >= start && d <= end
}

function statusBadgeUiClass(status) {
  const st = up(status)
  if (st === 'APPROVED') return 'ui-badge ui-badge-success'
  if (st === 'PARTIAL_APPROVED') return 'ui-badge ui-badge-info'
  if (st === 'REJECTED') return 'ui-badge ui-badge-danger'
  if (st === 'CANCELLED') return 'ui-badge'
  if (st.includes('PENDING')) return 'ui-badge ui-badge-warning'
  return 'ui-badge'
}

function sectionBadgeUiClass(status) {
  const st = up(status)
  if (st === 'APPROVED') return 'ui-badge ui-badge-success'
  if (st === 'REJECTED') return 'ui-badge ui-badge-danger'
  if (st === 'NOT_REQUIRED') return 'ui-badge'
  return 'ui-badge ui-badge-warning'
}

function typeBadgeUiClass(item) {
  const hasRoom = !!item?.roomRequired
  const hasMaterial = !!item?.materialRequired
  if (hasRoom && hasMaterial) return 'ui-badge ui-badge-info'
  if (hasRoom) return 'ui-badge ui-badge-success'
  if (hasMaterial) return 'ui-badge ui-badge-warning'
  return 'ui-badge'
}

function materialText(items = []) {
  return (
    arr(items)
      .map((x) => {
        if (typeof x === 'string') return x
        const name = s(x?.materialName) || s(x?.materialCode)
        const qty = Number(x?.qty || 0)
        return name ? `${name}${qty > 0 ? ` x${qty}` : ''}` : ''
      })
      .filter(Boolean)
      .join(', ') || '—'
  )
}

function normalizeMaterialItems(items = []) {
  return arr(items)
    .map((x) => {
      if (typeof x === 'string') {
        const found = materialOptions.value.find((m) => up(m.code) === up(x))
        return {
          materialId: found?._id || null,
          materialCode: up(found?.code || x),
          materialName: s(found?.name || x),
          qty: 1,
        }
      }

      const found = materialOptions.value.find(
        (m) => up(m.code) === up(x?.materialCode || x?.code || x?.name)
      )

      return {
        materialId: x?.materialId || x?._id || found?._id || null,
        materialCode: up(x?.materialCode || x?.code || found?.code || x?.name),
        materialName: s(x?.materialName || x?.name || found?.name || x?.materialCode),
        qty: Math.max(1, Number(x?.qty || 1)),
      }
    })
    .filter((x) => s(x.materialCode))
}

function canEdit(item) {
  return canEditOrCancelBookingRoom(item)
}

function canCancel(item) {
  return canEditOrCancelBookingRoom(item)
}

function syncDetailItem() {
  if (!detailItem.value?._id) return
  const found = rows.value.find((x) => String(x._id) === String(detailItem.value._id))
  if (found) detailItem.value = found
}

function syncEditItem() {
  if (!editItem.value?._id) return
  const found = rows.value.find((x) => String(x._id) === String(editItem.value._id))
  if (!found) return

  editItem.value = found

  if (editOpen.value) {
    editForm.value = {
      employeeId: s(found.employeeId),
      bookingDate: s(found.bookingDate),
      timeStart: s(found.timeStart),
      timeEnd: s(found.timeEnd),
      meetingTitle: s(found.meetingTitle),
      purpose: s(found.purpose),
      participantEstimate: Number(found.participantEstimate || 1),
      requirementNote: s(found.requirementNote),

      roomRequired: !!found.roomRequired,
      roomId: s(found.roomId || found.room?._id || ''),
      roomCode: s(found.roomCode || found.room?.roomCode || ''),
      roomName: s(found.roomName || found.room?.roomName || ''),

      materialRequired: !!found.materialRequired,
      materials: normalizeMaterialItems(found.materials),
    }
  }
}

function upsertRow(doc) {
  if (!doc?._id) return

  const id = String(doc._id)
  const idx = rows.value.findIndex((x) => String(x._id) === id)

  if (idx >= 0) rows.value[idx] = { ...rows.value[idx], ...doc }
  else rows.value.unshift(doc)

  syncDetailItem()
  syncEditItem()
}

function selectedEditRoomId() {
  return s(editForm.value.roomId)
}

function selectedEditMaterial(code) {
  return arr(editForm.value.materials).find((x) => up(x?.materialCode) === up(code)) || null
}

function isEditMaterialOn(code) {
  return !!selectedEditMaterial(code)
}

function onEditRoomChange(roomId) {
  const picked = roomOptions.value.find((x) => s(x._id) === s(roomId))

  if (!picked) {
    editForm.value.roomId = ''
    editForm.value.roomCode = ''
    editForm.value.roomName = ''
    return
  }

  editForm.value.roomId = s(picked._id)
  editForm.value.roomCode = up(picked.code)
  editForm.value.roomName = s(picked.name)
}

function toggleEditMaterial(item) {
  if (!editForm.value.materialRequired) return

  const code = up(item?.code)
  if (!code) return

  const next = [...arr(editForm.value.materials)]
  const idx = next.findIndex((x) => up(x?.materialCode) === code)

  if (idx >= 0) {
    next.splice(idx, 1)
  } else {
    next.push({
      materialId: item?._id || null,
      materialCode: up(item?.code),
      materialName: s(item?.name),
      qty: 1,
    })
  }

  editForm.value.materials = next
}

function increaseEditMaterialQty(item) {
  const found = selectedEditMaterial(item?.code)
  if (!found) return

  const stock = Math.max(0, Number(item?.totalQty || 0))
  const current = Math.max(0, Number(found.qty || 0))
  if (current >= stock) return

  found.qty = current + 1
}

function decreaseEditMaterialQty(item) {
  const found = selectedEditMaterial(item?.code)
  if (!found) return

  const current = Math.max(0, Number(found.qty || 0))
  if (current <= 1) {
    toggleEditMaterial(item)
    return
  }

  found.qty = current - 1
}

/* ───────────────── EMPLOYEE PICK ───────────────── */
async function loadEmployees(q = '') {
  try {
    loadingEmployees.value = true
    const data = await searchBookingRoomEmployees({ q, activeOnly: true })
    employees.value = Array.isArray(data) ? data : []
  } catch (e) {
    showToast({ type: 'error', message: e?.response?.data?.message || 'Failed to load employees.' })
  } finally {
    loadingEmployees.value = false
  }
}

async function onEmployeeChanged() {
  localStorage.setItem('bookingRoomEmployeeId', employeeId.value || '')

  if (s(employeeId.value)) {
    try {
      await subscribeEmployeeIfNeeded(employeeId.value)
    } catch {}
  }

  await fetchData()
}

/* ───────────────── MASTER DATA ───────────────── */
async function loadMasters({ silent = false } = {}) {
  try {
    if (!silent) loadingMasters.value = true

    const [roomRes, materialRes] = await Promise.all([
      api.get('/public/booking-room/rooms/active'),
      api.get('/public/booking-room/materials/active'),
    ])

    roomOptions.value = arr(roomRes?.data).map((x) => ({
      _id: x?._id || '',
      code: up(x?.code),
      name: s(x?.name),
      isActive: x?.isActive !== false,
    }))

    materialOptions.value = arr(materialRes?.data).map((x) => ({
      _id: x?._id || '',
      code: up(x?.code),
      name: s(x?.name),
      totalQty: Math.max(0, Number(x?.totalQty || 0)),
      isActive: x?.isActive !== false,
    }))

    syncEditItem()
  } catch (e) {
    roomOptions.value = []
    materialOptions.value = []
    showToast({
      type: 'error',
      message: e?.response?.data?.message || 'Failed to load room/material list.',
    })
  } finally {
    if (!silent) loadingMasters.value = false
  }
}

/* ───────────────── FETCH ───────────────── */
async function fetchData({ silent = false } = {}) {
  if (!s(employeeId.value)) {
    rows.value = []
    return
  }

  try {
    if (!silent) loading.value = true
    const data = await getMyBookingRooms(employeeId.value)
    rows.value = Array.isArray(data) ? data : []
    syncDetailItem()
    syncEditItem()
  } catch (e) {
    showToast({ type: 'error', message: e?.response?.data?.message || 'Failed to load booking history.' })
  } finally {
    if (!silent) loading.value = false
  }
}

/* ───────────────── FILTER ───────────────── */
const processedRows = computed(() => {
  let result = [...rows.value]

  if (overallStatus.value !== 'ALL') {
    result = result.filter((r) => up(r.overallStatus) === up(overallStatus.value))
  }

  result = result.filter((r) => passDateFilter(r?.bookingDate, dateFrom.value, dateTo.value))

  const q = s(search.value).toLowerCase()
  if (q) {
    result = result.filter((r) => {
      const hay = [
        r.employeeId,
        r.employee?.name,
        r.employee?.department,
        r.bookingDate,
        r.timeStart,
        r.timeEnd,
        r.meetingTitle,
        r.purpose,
        r.requirementNote,
        r.roomName,
        r.roomCode,
        materialText(r.materials),
        r.roomStatus,
        r.materialStatus,
        r.overallStatus,
        bookingRoomTypeLabel(r),
      ]
        .map((x) => String(x || '').toLowerCase())
        .join(' ')
      return hay.includes(q)
    })
  }

  result.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
  return result
})

const pagedRows = computed(() => {
  if (perPage.value === 'All') return processedRows.value
  const per = Number(perPage.value || 10)
  const start = (page.value - 1) * per
  return processedRows.value.slice(start, start + per)
})

const pageCount = computed(() => {
  if (perPage.value === 'All') return 1
  const per = Number(perPage.value || 10)
  return Math.ceil(processedRows.value.length / per) || 1
})

watch([search, overallStatus, dateFrom, dateTo, perPage], () => {
  page.value = 1
})

/* ───────────────── DETAIL ───────────────── */
function openDetail(item) {
  detailItem.value = item
  detailOpen.value = true
}
function closeDetail() {
  detailOpen.value = false
  detailItem.value = null
}

/* ───────────────── EDIT ───────────────── */
function openEdit(item) {
  if (!canEdit(item)) {
    showToast({ type: 'info', message: 'This request can no longer be edited.' })
    return
  }

  editItem.value = item
  editErrors.value = []
  editForm.value = {
    employeeId: s(item.employeeId),
    bookingDate: s(item.bookingDate),
    timeStart: s(item.timeStart),
    timeEnd: s(item.timeEnd),
    meetingTitle: s(item.meetingTitle),
    purpose: s(item.purpose),
    participantEstimate: Number(item.participantEstimate || 1),
    requirementNote: s(item.requirementNote),

    roomRequired: !!item.roomRequired,
    roomId: s(item.roomId || item.room?._id || ''),
    roomCode: s(item.roomCode || item.room?.roomCode || ''),
    roomName: s(item.roomName || item.room?.roomName || ''),

    materialRequired: !!item.materialRequired,
    materials: normalizeMaterialItems(item.materials),
  }
  editOpen.value = true
}

function closeEdit() {
  if (editBusy.value) return
  editOpen.value = false
  editItem.value = null
  editErrors.value = []
}

function validateEditForm() {
  const e = []
  const f = editForm.value

  if (!s(f.employeeId)) e.push('Requester is required.')
  if (!s(f.bookingDate)) e.push('Booking date is required.')
  if (!s(f.timeStart)) e.push('Start time is required.')
  if (!s(f.timeEnd)) e.push('End time is required.')

  const startMin = toMinutes(f.timeStart)
  const endMin = toMinutes(f.timeEnd)
  if (Number.isFinite(startMin) && Number.isFinite(endMin) && endMin <= startMin) {
    e.push('End time must be after start time.')
  }

  if (!f.roomRequired && !f.materialRequired) {
    e.push('Please choose at least room or material.')
  }

  if (f.roomRequired && !s(f.roomId) && !s(f.roomCode) && !s(f.roomName)) {
    e.push('Room name is required.')
  }

  if (f.materialRequired && !(Array.isArray(f.materials) && f.materials.length)) {
    e.push('Please choose at least one material.')
  }

  if (!compactText(f.meetingTitle)) e.push('Meeting title is required.')
  if (!compactText(f.purpose)) e.push('Purpose is required.')

  editErrors.value = e
  return e
}

async function submitEdit() {
  if (!editItem.value?._id) return

  const e = validateEditForm()
  if (e.length) {
    showToast({ type: 'warning', message: 'Please check the edit form.' })
    return
  }

  try {
    editBusy.value = true

    const payload = {
      employeeId: s(editForm.value.employeeId),
      bookingDate: s(editForm.value.bookingDate),
      timeStart: s(editForm.value.timeStart),
      timeEnd: s(editForm.value.timeEnd),
      meetingTitle: compactText(editForm.value.meetingTitle),
      purpose: compactText(editForm.value.purpose),
      participantEstimate: Number(editForm.value.participantEstimate || 1),
      requirementNote: compactText(editForm.value.requirementNote),

      roomRequired: !!editForm.value.roomRequired,
      roomId: editForm.value.roomRequired ? (editForm.value.roomId || null) : null,
      roomCode: editForm.value.roomRequired ? s(editForm.value.roomCode) : '',
      roomName: editForm.value.roomRequired ? s(editForm.value.roomName) : '',

      materialRequired: !!editForm.value.materialRequired,
      materials: editForm.value.materialRequired
        ? arr(editForm.value.materials).map((x) => ({
            materialId: x?.materialId || null,
            materialCode: s(x?.materialCode),
            materialName: s(x?.materialName),
            qty: Math.max(1, Number(x?.qty || 1)),
          }))
        : [],
    }

    const doc = await updateBookingRoom(editItem.value._id, payload)
    upsertRow(doc)

    showToast({ type: 'success', message: 'Request updated.' })
    closeEdit()
  } catch (e) {
    const msg = e?.response?.data?.message || 'Update failed.'
    showToast({ type: 'error', message: msg })
  } finally {
    editBusy.value = false
  }
}

/* ───────────────── CANCEL ───────────────── */
function askCancel(item) {
  if (!canCancel(item)) {
    showToast({ type: 'info', message: 'This request can no longer be cancelled.' })
    return
  }
  cancelTarget.value = item
  cancelReason.value = ''
  cancelOpen.value = true
}

async function confirmCancel() {
  if (!cancelTarget.value?._id) return

  try {
    cancelBusy.value = true
    await cancelBookingRoom(cancelTarget.value._id, {
      employeeId: employeeId.value,
      cancelReason: cancelReason.value,
    })

    const id = String(cancelTarget.value._id)
    const idx = rows.value.findIndex((x) => String(x._id) === id)
    if (idx >= 0) {
      rows.value[idx] = {
        ...rows.value[idx],
        overallStatus: 'CANCELLED',
        cancelReason: cancelReason.value,
      }
    }

    syncDetailItem()
    syncEditItem()

    showToast({ type: 'success', message: 'Request cancelled.' })
    cancelOpen.value = false
    cancelTarget.value = null
    cancelReason.value = ''
  } catch (e) {
    showToast({ type: 'error', message: e?.response?.data?.message || 'Cancel failed.' })
  } finally {
    cancelBusy.value = false
  }
}

/* ───────────────── REALTIME ───────────────── */
function currentUserLoginId() {
  return s(auth.user?.loginId || auth.user?.id || auth.user?.sub || '')
}

function isMine(doc) {
  if (!doc?._id) return false

  const rowEmpId = s(doc.employeeId)
  const rowRequester =
    s(doc.requesterLoginId) ||
    s(doc.createdByLoginId) ||
    s(doc.employeeLoginId)

  return (
    (rowEmpId && rowEmpId === s(employeeId.value)) ||
    (rowRequester && rowRequester === currentUserLoginId())
  )
}

function onReqCreated(doc) {
  if (!isMine(doc)) return
  upsertRow(doc)
}

function onReqUpdated(doc) {
  if (!isMine(doc)) return
  upsertRow(doc)
}

function onRoomMasterChanged() {
  loadMasters({ silent: true })
}

function onMaterialMasterChanged() {
  loadMasters({ silent: true })
}

function onMastersChanged() {
  loadMasters({ silent: true })
}

function onAvailabilityChanged(doc) {
  // Only refresh lightly when user is actively looking at detail/edit
  // and the change is likely relevant to editable resources.
  if (!(editOpen.value || detailOpen.value)) return

  clearTimeout(availabilityRefreshTimer)
  availabilityRefreshTimer = setTimeout(async () => {
    try {
      await Promise.all([
        loadMasters({ silent: true }),
        s(employeeId.value) ? fetchData({ silent: true }) : Promise.resolve(),
      ])

      if (doc && isMine(doc)) {
        upsertRow(doc)
      }
    } catch {}
  }, 250)
}

/* ───────────────── MODAL UX ───────────────── */
function lockBodyScroll(on) {
  if (typeof document === 'undefined') return
  const b = document.body
  if (on) b.classList.add('overflow-hidden')
  else b.classList.remove('overflow-hidden')
}

watch([detailOpen, editOpen, cancelOpen], ([d, e, c]) => {
  lockBodyScroll(!!(d || e || c))
})

function onKeydown(e) {
  if (e.key !== 'Escape') return
  if (editOpen.value) return closeEdit()
  if (detailOpen.value) return closeDetail()
  if (cancelOpen.value && !cancelBusy.value) cancelOpen.value = false
}

/* ───────────────── INIT ───────────────── */
onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateIsMobile)
    window.addEventListener('keydown', onKeydown)
  }

  await Promise.all([loadEmployees(), loadMasters()])

  const loginId = currentUserLoginId()
  if (loginId) {
    try {
      await subscribeUserIfNeeded(loginId)
    } catch {}
  }

  if (s(employeeId.value)) {
    try {
      await subscribeEmployeeIfNeeded(employeeId.value)
    } catch {}
    await fetchData()
  }

  socket.on('bookingroom:req:created', onReqCreated)
  socket.on('bookingroom:req:updated', onReqUpdated)

  socket.on('bookingroom:room-master:created', onRoomMasterChanged)
  socket.on('bookingroom:room-master:updated', onRoomMasterChanged)
  socket.on('bookingroom:room-master:deleted', onRoomMasterChanged)

  socket.on('bookingroom:material-master:created', onMaterialMasterChanged)
  socket.on('bookingroom:material-master:updated', onMaterialMasterChanged)
  socket.on('bookingroom:material-master:deleted', onMaterialMasterChanged)

  socket.on('bookingroom:masters:changed', onMastersChanged)
  socket.on('bookingroom:availability:changed', onAvailabilityChanged)
})

onBeforeUnmount(() => {
  lockBodyScroll(false)

  if (availabilityRefreshTimer) {
    clearTimeout(availabilityRefreshTimer)
    availabilityRefreshTimer = null
  }

  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', updateIsMobile)
    window.removeEventListener('keydown', onKeydown)
  }

  socket.off('bookingroom:req:created', onReqCreated)
  socket.off('bookingroom:req:updated', onReqUpdated)

  socket.off('bookingroom:room-master:created', onRoomMasterChanged)
  socket.off('bookingroom:room-master:updated', onRoomMasterChanged)
  socket.off('bookingroom:room-master:deleted', onRoomMasterChanged)

  socket.off('bookingroom:material-master:created', onMaterialMasterChanged)
  socket.off('bookingroom:material-master:updated', onMaterialMasterChanged)
  socket.off('bookingroom:material-master:deleted', onMaterialMasterChanged)

  socket.off('bookingroom:masters:changed', onMastersChanged)
  socket.off('bookingroom:availability:changed', onAvailabilityChanged)
})
</script>

<template>
  <div class="ui-page">
    <div class="ui-container py-2">
      <div class="ui-card overflow-hidden">
        <!-- Header -->
        <div class="ui-hero-gradient">
          <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div class="grid w-full gap-2 md:w-auto md:grid-cols-[220px_220px_150px_150px_150px_auto] md:items-end">
              <div>
                <label class="mb-1 block text-[11px] font-extrabold text-white/90">Search</label>
                <div class="flex items-center rounded-xl border border-white/25 bg-white/10 px-2.5 py-2 text-[11px]">
                  <i class="fa-solid fa-magnifying-glass mr-2 text-white/80" />
                  <input
                    v-model="search"
                    type="text"
                    placeholder="Title, room, material..."
                    class="w-full bg-transparent text-[11px] text-white outline-none placeholder:text-white/70"
                  />
                </div>
              </div>

              <div>
                <label class="mb-1 block text-[11px] font-extrabold text-white/90">Requester</label>
                <select
                  v-model="employeeId"
                  class="w-full rounded-xl border border-white/25 bg-white/10 px-2.5 py-2 text-[11px] text-white outline-none"
                  @change="onEmployeeChanged"
                >
                  <option value="">Select employee</option>
                  <option v-for="emp in employees" :key="emp.employeeId" :value="emp.employeeId">
                    {{ emp.employeeId }} - {{ emp.name }}
                  </option>
                </select>
              </div>

              <div>
                <label class="mb-1 block text-[11px] font-extrabold text-white/90">Status</label>
                <select
                  v-model="overallStatus"
                  class="w-full rounded-xl border border-white/25 bg-white/10 px-2.5 py-2 text-[11px] text-white outline-none"
                >
                  <option v-for="(label, key) in STATUS_OPTIONS" :key="key" :value="key">
                    {{ label }}
                  </option>
                </select>
              </div>

              <div>
                <label class="mb-1 block text-[11px] font-extrabold text-white/90">Date From</label>
                <input
                  v-model="dateFrom"
                  type="date"
                  class="w-full rounded-xl border border-white/25 bg-white/10 px-2.5 py-2 text-[11px] text-white outline-none"
                />
              </div>

              <div>
                <label class="mb-1 block text-[11px] font-extrabold text-white/90">Date To</label>
                <input
                  v-model="dateTo"
                  type="date"
                  class="w-full rounded-xl border border-white/25 bg-white/10 px-2.5 py-2 text-[11px] text-white outline-none"
                />
              </div>

              <div class="flex gap-2">
                <button
                  type="button"
                  class="ui-btn ui-btn-soft !border-white/25 !bg-white/10 !text-white hover:!bg-white/15"
                  :disabled="loading"
                  @click="fetchData()"
                >
                  <i class="fa-solid fa-rotate text-[11px]" :class="loading ? 'fa-spin' : ''" />
                  Refresh
                </button>

                <button
                  class="ui-btn ui-btn-soft !border-white/25 !bg-white/10 !text-white hover:!bg-white/15"
                  type="button"
                  @click="router.push({ name: 'public-booking-room-request' })"
                >
                  <i class="fa-solid fa-plus text-[11px]" />
                  New
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Body -->
        <div class="p-3">
          <div v-if="loading && !processedRows.length" class="space-y-2">
            <div class="ui-skeleton h-9 w-full" />
            <div v-for="i in 3" :key="'sk-' + i" class="ui-skeleton h-14 w-full" />
          </div>

          <div v-else>
            <div
              v-if="!employeeId"
              class="ui-frame p-4 text-center text-[12px] text-slate-500 dark:text-slate-400"
            >
              Please select a requester first.
            </div>

            <template v-else>
              <!-- Mobile -->
              <div v-if="isMobile" class="space-y-2">
                <div
                  v-if="!pagedRows.length"
                  class="ui-frame p-4 text-center text-[12px] text-slate-500 dark:text-slate-400"
                >
                  No meeting room requests found.
                </div>

                <div v-for="item in pagedRows" :key="item._id" class="ui-card p-3">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="text-[11px] text-slate-500 dark:text-slate-400">
                        {{ item.createdAt ? dayjs(item.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
                      </div>

                      <div class="mt-1 text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                        {{ item.meetingTitle || 'Meeting Request' }}
                      </div>

                      <div class="mt-1 flex flex-wrap items-center gap-2">
                        <span :class="typeBadgeUiClass(item)">{{ bookingRoomTypeLabel(item) }}</span>
                        <span :class="statusBadgeUiClass(item.overallStatus)">
                          {{ bookingRoomStatusLabel(item.overallStatus) }}
                        </span>
                      </div>
                    </div>

                    <div class="flex items-center gap-2">
                      <button class="ui-btn ui-btn-xs ui-btn-soft" type="button" @click="openDetail(item)">
                        Detail
                      </button>

                      <button
                        v-if="canEdit(item)"
                        class="ui-btn ui-btn-primary ui-btn-xs"
                        type="button"
                        @click="openEdit(item)"
                      >
                        Edit
                      </button>

                      <button
                        v-if="canCancel(item)"
                        class="ui-btn ui-btn-rose ui-btn-xs"
                        type="button"
                        @click="askCancel(item)"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>

                  <div class="mt-2 ui-divider" />

                  <div class="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                    <div class="ui-frame p-2">
                      <div class="ui-label !mb-1">Booking Date</div>
                      <div>{{ fmtDate(item.bookingDate) }}</div>
                    </div>

                    <div class="ui-frame p-2">
                      <div class="ui-label !mb-1">Time</div>
                      <div class="font-extrabold">{{ fmtTime(item.timeStart) }} - {{ fmtTime(item.timeEnd) }}</div>
                    </div>
                  </div>

                  <div class="mt-2 ui-frame p-2">
                    <div class="flex items-start justify-between gap-2">
                      <div class="min-w-0">
                        <div class="ui-label !mb-1">Room</div>
                        <div class="text-[11px] text-slate-700 dark:text-slate-200">
                          {{ item.roomRequired ? (item.roomName || '—') : 'Not Required' }}
                        </div>
                      </div>
                      <span :class="sectionBadgeUiClass(item.roomStatus)">
                        {{ item.roomStatus || '—' }}
                      </span>
                    </div>
                  </div>

                  <div class="mt-2 ui-frame p-2">
                    <div class="flex items-start justify-between gap-2">
                      <div class="min-w-0">
                        <div class="ui-label !mb-1">Material</div>
                        <div class="text-[11px] text-slate-700 dark:text-slate-200">
                          {{ item.materialRequired ? materialText(item.materials) : 'Not Required' }}
                        </div>
                      </div>
                      <span :class="sectionBadgeUiClass(item.materialStatus)">
                        {{ item.materialStatus || '—' }}
                      </span>
                    </div>
                  </div>

                  <div class="mt-2 ui-frame p-2">
                    <div class="ui-label !mb-1">Purpose</div>
                    <div class="text-[11px] text-slate-700 dark:text-slate-200">{{ item.purpose || '—' }}</div>
                  </div>
                </div>
              </div>

              <!-- Desktop -->
              <div v-else class="ui-table-wrap">
                <table class="ui-table">
                  <thead>
                    <tr>
                      <th class="ui-th">Created</th>
                      <th class="ui-th">Booking Date</th>
                      <th class="ui-th">Time</th>
                      <th class="ui-th">Title</th>
                      <th class="ui-th">Type</th>
                      <th class="ui-th">Room</th>
                      <th class="ui-th">Material</th>
                      <th class="ui-th">Status</th>
                      <th class="ui-th text-center">Actions</th>
                    </tr>
                  </thead>

                  <tbody>
                    <tr v-if="!pagedRows.length">
                      <td colspan="9" class="ui-td py-8 text-slate-500 dark:text-slate-400">
                        No meeting room requests found.
                      </td>
                    </tr>

                    <tr v-for="item in pagedRows" :key="item._id" class="ui-tr-hover">
                      <td class="ui-td whitespace-nowrap">
                        {{ fmtDateTime(item.createdAt) }}
                      </td>

                      <td class="ui-td whitespace-nowrap">
                        {{ fmtDate(item.bookingDate) }}
                      </td>

                      <td class="ui-td whitespace-nowrap">
                        {{ fmtTime(item.timeStart) }} - {{ fmtTime(item.timeEnd) }}
                      </td>

                      <td class="ui-td">
                        <div class="min-w-0">
                          <div class="truncate font-semibold" :title="item.meetingTitle || item.purpose">
                            {{ item.meetingTitle || '—' }}
                          </div>
                          <div class="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                            {{ item.purpose || '—' }}
                          </div>
                        </div>
                      </td>

                      <td class="ui-td">
                        <span :class="typeBadgeUiClass(item)">
                          {{ bookingRoomTypeLabel(item) }}
                        </span>
                      </td>

                      <td class="ui-td">
                        <div class="flex flex-col gap-1">
                          <span class="truncate">{{ item.roomRequired ? (item.roomName || '—') : 'Not Required' }}</span>
                          <span :class="sectionBadgeUiClass(item.roomStatus)">{{ item.roomStatus }}</span>
                        </div>
                      </td>

                      <td class="ui-td">
                        <div class="flex flex-col gap-1">
                          <span class="truncate" :title="item.materialRequired ? materialText(item.materials) : 'Not Required'">
                            {{ item.materialRequired ? materialText(item.materials) : 'Not Required' }}
                          </span>
                          <span :class="sectionBadgeUiClass(item.materialStatus)">{{ item.materialStatus }}</span>
                        </div>
                      </td>

                      <td class="ui-td">
                        <span :class="statusBadgeUiClass(item.overallStatus)">
                          {{ bookingRoomStatusLabel(item.overallStatus) }}
                        </span>
                      </td>

                      <td class="ui-td text-center">
                        <div class="flex items-center justify-center gap-2">
                          <button class="ui-btn ui-btn-soft ui-btn-xs" type="button" @click="openDetail(item)">
                            <i class="fa-solid fa-eye text-[11px]" />
                          </button>

                          <button
                            v-if="canEdit(item)"
                            class="ui-btn ui-btn-primary ui-btn-xs"
                            type="button"
                            @click="openEdit(item)"
                          >
                            Edit
                          </button>

                          <button
                            v-if="canCancel(item)"
                            class="ui-btn ui-btn-rose ui-btn-xs"
                            type="button"
                            @click="askCancel(item)"
                          >
                            Cancel
                          </button>

                          <span
                            v-if="!canEdit(item) && !canCancel(item)"
                            class="text-[11px] text-slate-400 dark:text-slate-500"
                          >
                            —
                          </span>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- Pagination -->
              <div
                v-if="processedRows.length"
                class="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-2 text-[11px] text-slate-600
                       dark:border-slate-700 dark:text-slate-300 sm:flex-row sm:items-center sm:justify-between"
              >
                <div class="flex items-center gap-2">
                  <select v-model="perPage" class="ui-select !py-1.5 !text-[11px] !rounded-full">
                    <option v-for="opt in perPageOptions" :key="'per-' + opt" :value="opt">{{ opt }}</option>
                  </select>

                  <span class="text-[11px] text-slate-500 dark:text-slate-400">
                    {{ processedRows.length }} request(s)
                  </span>
                </div>

                <div class="flex items-center justify-end gap-1">
                  <button type="button" class="ui-pagebtn" :disabled="page <= 1" @click="page = 1">«</button>
                  <button type="button" class="ui-pagebtn" :disabled="page <= 1" @click="page = Math.max(1, page - 1)">
                    Prev
                  </button>
                  <span class="px-2 font-extrabold">Page {{ page }} / {{ pageCount }}</span>
                  <button
                    type="button"
                    class="ui-pagebtn"
                    :disabled="page >= pageCount"
                    @click="page = Math.min(pageCount, page + 1)"
                  >
                    Next
                  </button>
                  <button type="button" class="ui-pagebtn" :disabled="page >= pageCount" @click="page = pageCount">»</button>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- Detail Modal -->
      <div v-if="detailOpen" class="ui-modal-backdrop" @click.self="closeDetail">
        <div class="ui-modal ui-modal-lg p-0 overflow-hidden">
          <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div class="min-w-0">
              <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Meeting Room Request Detail</div>
              <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                Created: {{ fmtDateTime(detailItem?.createdAt) }}
              </div>
            </div>

            <button class="ui-btn ui-btn-ghost ui-btn-xs" type="button" @click="closeDetail">
              <i class="fa-solid fa-xmark text-[11px]" />
              Close
            </button>
          </div>

          <div class="p-4 space-y-3">
            <div class="ui-frame p-3">
              <div class="grid gap-3 md:grid-cols-3">
                <div>
                  <div class="ui-label">Overall Status</div>
                  <span :class="statusBadgeUiClass(detailItem?.overallStatus)">
                    {{ bookingRoomStatusLabel(detailItem?.overallStatus) }}
                  </span>
                </div>

                <div>
                  <div class="ui-label">Request Type</div>
                  <span :class="typeBadgeUiClass(detailItem)">
                    {{ bookingRoomTypeLabel(detailItem) }}
                  </span>
                </div>

                <div class="md:text-right">
                  <div class="ui-label">Booking Date</div>
                  <div class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                    {{ fmtDate(detailItem?.bookingDate) }}
                  </div>
                </div>
              </div>
            </div>

            <div class="ui-card p-3">
              <div class="ui-section-title">Meeting Info</div>
              <div class="mt-2 grid gap-3 md:grid-cols-2 text-[12px]">
                <div>
                  <div class="ui-label">Meeting Title</div>
                  <div class="font-extrabold">{{ detailItem?.meetingTitle || '—' }}</div>
                </div>
                <div>
                  <div class="ui-label">Time</div>
                  <div class="font-extrabold">{{ fmtTime(detailItem?.timeStart) }} - {{ fmtTime(detailItem?.timeEnd) }}</div>
                </div>
                <div>
                  <div class="ui-label">Purpose</div>
                  <div>{{ detailItem?.purpose || '—' }}</div>
                </div>
                <div>
                  <div class="ui-label">Participant Estimate</div>
                  <div>{{ detailItem?.participantEstimate || '—' }}</div>
                </div>
              </div>
            </div>

            <div class="ui-card p-3">
              <div class="ui-section-title">Resource Status</div>
              <div class="mt-2 grid gap-3 md:grid-cols-2 text-[12px]">
                <div class="ui-frame p-3">
                  <div class="flex items-center justify-between gap-2">
                    <div class="font-extrabold">Room</div>
                    <span :class="sectionBadgeUiClass(detailItem?.roomStatus)">
                      {{ detailItem?.roomStatus || '—' }}
                    </span>
                  </div>
                  <div class="mt-2 text-slate-700 dark:text-slate-200">
                    {{ detailItem?.roomRequired ? (detailItem?.roomName || '—') : 'Not Required' }}
                  </div>
                  <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                    {{ detailItem?.roomApproval?.note || '—' }}
                  </div>
                </div>

                <div class="ui-frame p-3">
                  <div class="flex items-center justify-between gap-2">
                    <div class="font-extrabold">Material</div>
                    <span :class="sectionBadgeUiClass(detailItem?.materialStatus)">
                      {{ detailItem?.materialStatus || '—' }}
                    </span>
                  </div>
                  <div class="mt-2 text-slate-700 dark:text-slate-200">
                    {{ detailItem?.materialRequired ? materialText(detailItem?.materials) : 'Not Required' }}
                  </div>
                  <div class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                    {{ detailItem?.materialApproval?.note || '—' }}
                  </div>
                </div>
              </div>
            </div>

            <div class="ui-card p-3">
              <div class="ui-section-title">Requirement Note</div>
              <div class="mt-1 whitespace-pre-wrap text-[12px] text-slate-700 dark:text-slate-200">
                {{ detailItem?.requirementNote || '—' }}
              </div>
            </div>

            <div class="flex justify-end gap-2 pt-1">
              <button class="ui-btn ui-btn-ghost" type="button" @click="closeDetail">Close</button>

              <button v-if="canEdit(detailItem)" class="ui-btn ui-btn-primary" type="button" @click="openEdit(detailItem)">
                Edit
              </button>

              <button v-if="canCancel(detailItem)" class="ui-btn ui-btn-rose" type="button" @click="askCancel(detailItem)">
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Edit Modal -->
      <div v-if="editOpen" class="ui-modal-backdrop">
        <div class="ui-modal ui-modal-xl p-0 overflow-hidden">
          <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div class="min-w-0">
              <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Edit Meeting Room Request</div>
              <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Update booking info, room, and materials before approval is locked.
              </div>
            </div>

            <button class="ui-btn ui-btn-ghost ui-btn-xs" type="button" :disabled="editBusy" @click="closeEdit">
              <i class="fa-solid fa-xmark text-[11px]" />
              Close
            </button>
          </div>

          <div class="p-4 space-y-3">
            <div
              v-if="editErrors.length"
              class="rounded-xl border border-rose-300 bg-rose-50 p-3 text-[11px] text-rose-700 dark:border-rose-700/60 dark:bg-rose-950/30 dark:text-rose-200"
            >
              <div class="mb-1 font-extrabold">Please check the following:</div>
              <ul class="list-disc space-y-0.5 pl-4">
                <li v-for="(e, idx) in editErrors" :key="idx">{{ e }}</li>
              </ul>
            </div>

            <div class="ui-card p-3 space-y-3">
              <div class="grid gap-3 md:grid-cols-4">
                <div class="ui-field">
                  <label class="ui-label">Booking Date</label>
                  <input type="date" v-model="editForm.bookingDate" class="ui-date" :disabled="editBusy" />
                </div>

                <div class="ui-field">
                  <label class="ui-label">Start Time</label>
                  <input type="time" v-model="editForm.timeStart" class="ui-input" :disabled="editBusy" />
                </div>

                <div class="ui-field">
                  <label class="ui-label">End Time</label>
                  <input type="time" v-model="editForm.timeEnd" class="ui-input" :disabled="editBusy" />
                </div>

                <div class="ui-field">
                  <label class="ui-label">Participant Estimate</label>
                  <input
                    type="number"
                    min="1"
                    v-model.number="editForm.participantEstimate"
                    class="ui-input"
                    :disabled="editBusy"
                  />
                </div>
              </div>

              <div class="grid gap-3 md:grid-cols-2">
                <div class="ui-field">
                  <label class="ui-label">Meeting Title</label>
                  <input v-model="editForm.meetingTitle" type="text" class="ui-input" :disabled="editBusy" />
                </div>

                <div class="ui-field">
                  <label class="ui-label">Purpose</label>
                  <input v-model="editForm.purpose" type="text" class="ui-input" :disabled="editBusy" />
                </div>
              </div>

              <div class="grid gap-3 md:grid-cols-2">
                <div class="ui-frame p-3">
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <div class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50">Meeting Room</div>
                    </div>

                    <button
                      type="button"
                      class="ui-pill"
                      :class="editForm.roomRequired ? 'ui-pill-on' : ''"
                      :disabled="editBusy"
                      @click="editForm.roomRequired = !editForm.roomRequired"
                    >
                      <i class="fa-solid" :class="editForm.roomRequired ? 'fa-toggle-on' : 'fa-toggle-off'" />
                      {{ editForm.roomRequired ? 'Required' : 'Not Required' }}
                    </button>
                  </div>

                  <div class="mt-3 ui-field">
                    <label class="ui-label">Room Name</label>
                    <select
                      :value="selectedEditRoomId()"
                      class="ui-select"
                      :disabled="editBusy || !editForm.roomRequired"
                      @change="onEditRoomChange($event.target.value)"
                    >
                      <option value="">Select room</option>
                      <option v-for="room in roomOptions" :key="room._id" :value="room._id">
                        {{ room.name }} {{ room.code ? `(${room.code})` : '' }}
                      </option>
                    </select>
                  </div>
                </div>

                <div class="ui-frame p-3">
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <div class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50">IT Material</div>
                    </div>

                    <button
                      type="button"
                      class="ui-pill"
                      :class="editForm.materialRequired ? 'ui-pill-on' : ''"
                      :disabled="editBusy"
                      @click="editForm.materialRequired = !editForm.materialRequired"
                    >
                      <i class="fa-solid" :class="editForm.materialRequired ? 'fa-toggle-on' : 'fa-toggle-off'" />
                      {{ editForm.materialRequired ? 'Required' : 'Not Required' }}
                    </button>
                  </div>

                  <div class="mt-3 ui-field">
                    <label class="ui-label">Materials</label>

                    <div class="grid gap-2 sm:grid-cols-2">
                      <div
                        v-for="item in materialOptions"
                        :key="item._id"
                        class="rounded-xl border p-2.5 transition"
                        :class="isEditMaterialOn(item.code)
                          ? 'border-sky-400 bg-sky-50 dark:border-sky-700 dark:bg-sky-950/20'
                          : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/60'"
                      >
                        <div class="flex items-start justify-between gap-2">
                          <div class="min-w-0">
                            <div class="flex items-center gap-2">
                              <button
                                type="button"
                                class="inline-flex h-7 w-7 items-center justify-center rounded-full border text-[11px] transition"
                                :class="isEditMaterialOn(item.code)
                                  ? 'border-sky-500 bg-sky-500 text-white'
                                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200'"
                                :disabled="editBusy || !editForm.materialRequired"
                                @click="toggleEditMaterial(item)"
                              >
                                <i class="fa-solid" :class="isEditMaterialOn(item.code) ? 'fa-check' : 'fa-plus'" />
                              </button>

                              <div class="min-w-0">
                                <div class="truncate text-[12px] font-semibold text-slate-800 dark:text-slate-100">
                                  {{ item.name || item.code }}
                                </div>
                                <div class="text-[11px] text-slate-500 dark:text-slate-400">
                                  {{ item.code }} • Stock {{ Number(item.totalQty || 0) }}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div
                            v-if="isEditMaterialOn(item.code)"
                            class="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-1.5 py-1
                                   dark:border-slate-700 dark:bg-slate-950"
                          >
                            <button
                              type="button"
                              class="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-[11px]
                                     text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                              :disabled="editBusy"
                              @click="decreaseEditMaterialQty(item)"
                            >
                              <i class="fa-solid fa-minus" />
                            </button>

                            <span class="min-w-[24px] text-center text-[12px] font-semibold text-slate-800 dark:text-slate-100">
                              {{ selectedEditMaterial(item.code)?.qty || 0 }}
                            </span>

                            <button
                              type="button"
                              class="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 text-[11px]
                                     text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50
                                     dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                              :disabled="editBusy || (selectedEditMaterial(item.code)?.qty || 0) >= Number(item.totalQty || 0)"
                              @click="increaseEditMaterialQty(item)"
                            >
                              <i class="fa-solid fa-plus" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div
                      v-if="editForm.materialRequired && editForm.materials?.length"
                      class="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2
                             dark:border-emerald-900/40 dark:bg-emerald-950/20"
                    >
                      <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
                        Selected Materials
                      </div>

                      <div class="mt-2 flex flex-wrap gap-2">
                        <span
                          v-for="item in editForm.materials"
                          :key="item.materialCode"
                          class="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[11px]
                                 font-medium text-emerald-800 dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-200"
                        >
                          <i class="fa-solid fa-paperclip text-[10px]" />
                          {{ item.materialName || item.materialCode }} x{{ Number(item.qty || 0) }}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="ui-field">
                <label class="ui-label">Requirement Note</label>
                <textarea
                  v-model="editForm.requirementNote"
                  rows="4"
                  class="ui-textarea"
                  placeholder="Optional note..."
                  :disabled="editBusy"
                />
              </div>
            </div>

            <div class="flex justify-end gap-2">
              <button class="ui-btn ui-btn-ghost" type="button" :disabled="editBusy" @click="closeEdit">
                Cancel
              </button>

              <button class="ui-btn ui-btn-primary" type="button" :disabled="editBusy || loadingMasters" @click="submitEdit">
                <i v-if="editBusy" class="fa-solid fa-spinner animate-spin text-[11px]" />
                Save Changes
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Cancel Dialog -->
      <ConfirmDialog
        v-model="cancelOpen"
        tone="danger"
        :busy="cancelBusy"
        title="Cancel this request?"
        message="Are you sure you want to cancel this meeting room request?"
        confirm-text="Yes, cancel"
        cancel-text="No"
        @confirm="confirmCancel"
      >
        <template #default>
          <div class="ui-field mt-2">
            <label class="ui-label">Cancel Reason (optional)</label>
            <textarea
              v-model="cancelReason"
              rows="3"
              class="ui-textarea"
              placeholder="Why are you cancelling this request?"
              :disabled="cancelBusy"
            />
          </div>
        </template>
      </ConfirmDialog>
    </div>
  </div>
</template>

<style scoped>
.ui-pill {
  min-width: 124px;
  justify-content: center;
}

.ui-modal-xl {
  width: min(1100px, calc(100vw - 16px));
  max-height: calc(100vh - 16px);
}

.ui-modal-lg {
  width: min(900px, calc(100vw - 16px));
  max-height: calc(100vh - 16px);
}
</style>