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

const loading = ref(false)
const rows = ref([])

const employeeId = ref(localStorage.getItem('bookingRoomEmployeeId') || '')
const employees = ref([])
const loadingEmployees = ref(false)

const roomOptions = ref([])
const materialOptions = ref([])
const loadingMasters = ref(false)

const todayYmd = dayjs().format('YYYY-MM-DD')

const search = ref('')
const overallStatus = ref('ALL')
const dateFrom = ref(todayYmd)
const dateTo = ref(todayYmd)

const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

const page = ref(1)
const perPage = ref(10)
const perPageOptions = [10, 20, 50, 'All']

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
  participantEstimate: 1,
  requirementNote: '',
  roomRequired: true,
  roomId: '',
  roomCode: '',
  roomName: '',
  needCoffeeBreak: false,
  needNameOnTable: false,
  needWifiPassword: false,
  materialRequired: false,
  materials: [],
})

const detailOpen = ref(false)
const detailItem = ref(null)

const cancelOpen = ref(false)
const cancelBusy = ref(false)
const cancelTarget = ref(null)
const cancelReason = ref('')

let availabilityRefreshTimer = null

const STATUS_OPTIONS = {
  ALL: 'All',
  PENDING: 'Pending',
  PARTIAL_APPROVED: 'Partial Approved',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
}

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

function requesterLabel(item) {
  if (!item) return '—'

  return (
    s(item.requesterName) ||
    s(item.employeeName) ||
    s(item.employee?.name) ||
    s(item.requesterLoginId) ||
    s(item.createdByLoginId) ||
    s(item.employeeId) ||
    '—'
  )
}

function roomServiceItems(item) {
  const list = []

  if (item?.needCoffeeBreak) {
    list.push({
      key: 'coffee',
      label: 'Coffee Break',
      icon: 'fa-mug-hot',
    })
  }

  if (item?.needNameOnTable) {
    list.push({
      key: 'name-table',
      label: 'Name on Table',
      icon: 'fa-id-card',
    })
  }

  if (item?.needWifiPassword) {
    list.push({
      key: 'wifi',
      label: 'WiFi Password',
      icon: 'fa-wifi',
    })
  }

  return list
}

function roomServiceText(item) {
  const list = roomServiceItems(item)
  return list.length ? list.map(x => x.label).join(', ') : 'None'
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

function normalizedMaterialCards(items = []) {
  return arr(items)
    .map((x) => {
      if (typeof x === 'string') {
        return {
          key: x,
          name: x,
          code: x,
          qty: 1,
        }
      }
      const name = s(x?.materialName) || s(x?.materialCode)
      const code = s(x?.materialCode)
      const qty = Math.max(1, Number(x?.qty || 1))
      return {
        key: `${code || name}-${qty}`,
        name: name || 'Unnamed Material',
        code: code || '—',
        qty,
      }
    })
    .filter(x => s(x.name))
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
      participantEstimate: Number(found.participantEstimate || 1),
      requirementNote: s(found.requirementNote || found.note),
      roomRequired: !!found.roomRequired,
      roomId: s(found.roomId || found.room?._id || ''),
      roomCode: s(found.roomCode || found.room?.roomCode || ''),
      roomName: s(found.roomName || found.room?.roomName || ''),
      needCoffeeBreak: !!found.needCoffeeBreak,
      needNameOnTable: !!found.needNameOnTable,
      needWifiPassword: !!found.needWifiPassword,
      materialRequired: !!found.materialRequired,
      materials: normalizeMaterialItems(found.materials),
    }
  }
}

const employeeQuery = ref('')
const employeePickerOpen = ref(false)

const filteredEmployees = computed(() => {
  const q = s(employeeQuery.value).toLowerCase()
  const list = Array.isArray(employees.value) ? employees.value : []

  const result = !q
    ? list
    : list.filter((emp) => {
        const hay = [
          emp.employeeId,
          emp.name,
          emp.department,
          emp.position,
        ]
          .map((x) => String(x || '').toLowerCase())
          .join(' ')
        return hay.includes(q)
      })

  return result.slice(0, 8)
})

const selectedEmployeeLabel = computed(() => {
  const found = employees.value.find((emp) => s(emp.employeeId) === s(employeeId.value))
  if (!found) return ''
  return `${found.employeeId} - ${found.name}`
})

watch(employeeId, (val) => {
  if (!s(val)) {
    employeeQuery.value = ''
    return
  }
  employeeQuery.value = selectedEmployeeLabel.value
})

function openEmployeePicker() {
  employeePickerOpen.value = true
}

function closeEmployeePicker() {
  setTimeout(() => {
    employeePickerOpen.value = false
  }, 120)
}

function onEmployeeInput() {
  employeePickerOpen.value = true
  if (!s(employeeQuery.value)) {
    employeeId.value = ''
  }
}

async function pickEmployee(emp) {
  employeeId.value = s(emp?.employeeId)
  employeeQuery.value = `${emp?.employeeId || ''} - ${emp?.name || ''}`
  employeePickerOpen.value = false
  await onEmployeeChanged()
}

function clearEmployeePick() {
  employeeId.value = ''
  employeeQuery.value = ''
  employeePickerOpen.value = false
  localStorage.setItem('bookingRoomEmployeeId', '')
  rows.value = []
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
    editForm.value.needCoffeeBreak = false
    editForm.value.needNameOnTable = false
    editForm.value.needWifiPassword = false
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

watch(
  () => editForm.value.roomRequired,
  (on) => {
    if (on) return
    editForm.value.roomId = ''
    editForm.value.roomCode = ''
    editForm.value.roomName = ''
    editForm.value.needCoffeeBreak = false
    editForm.value.needNameOnTable = false
    editForm.value.needWifiPassword = false
  }
)

watch(
  () => editForm.value.materialRequired,
  (on) => {
    if (on) return
    editForm.value.materials = []
  }
)

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
    const found = employees.value.find((emp) => s(emp.employeeId) === s(employeeId.value))
    if (found) {
      employeeQuery.value = `${found.employeeId} - ${found.name}`
    }
  }

  await fetchData()
}

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
        r.requesterName,
        r.employeeName,
        requesterLabel(r),
        r.employee?.department,
        r.bookingDate,
        r.timeStart,
        r.timeEnd,
        r.meetingTitle,
        r.requirementNote,
        r.note,
        r.roomName,
        r.roomCode,
        roomServiceText(r),
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

function openDetail(item) {
  detailItem.value = item
  detailOpen.value = true
}
function closeDetail() {
  detailOpen.value = false
  detailItem.value = null
}

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
    participantEstimate: Number(item.participantEstimate || 1),
    requirementNote: s(item.requirementNote || item.note),

    roomRequired: !!item.roomRequired,
    roomId: s(item.roomId || item.room?._id || ''),
    roomCode: s(item.roomCode || item.room?.roomCode || ''),
    roomName: s(item.roomName || item.room?.roomName || ''),

    needCoffeeBreak: !!item.needCoffeeBreak,
    needNameOnTable: !!item.needNameOnTable,
    needWifiPassword: !!item.needWifiPassword,

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
      participantEstimate: Number(editForm.value.participantEstimate || 1),
      note: compactText(editForm.value.requirementNote),

      roomRequired: !!editForm.value.roomRequired,
      roomId: editForm.value.roomRequired ? (editForm.value.roomId || null) : null,
      roomCode: editForm.value.roomRequired ? s(editForm.value.roomCode) : '',
      roomName: editForm.value.roomRequired ? s(editForm.value.roomName) : '',
      needCoffeeBreak: editForm.value.roomRequired ? !!editForm.value.needCoffeeBreak : false,
      needNameOnTable: editForm.value.roomRequired ? !!editForm.value.needNameOnTable : false,
      needWifiPassword: editForm.value.roomRequired ? !!editForm.value.needWifiPassword : false,

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
                    placeholder="Meeting title, room, material, requester..."
                    class="w-full bg-transparent text-[11px] text-white outline-none placeholder:text-white/70"
                  />
                </div>
              </div>

              <div class="relative">
                <label class="mb-1 block text-[11px] font-extrabold text-white/90">Requester</label>

                <div class="relative">
                  <input
                    v-model="employeeQuery"
                    type="text"
                    placeholder="Search employee ID or name..."
                    class="w-full rounded-xl border border-white/25 bg-white/10 px-2.5 py-2 pr-16 text-[11px] text-white outline-none placeholder:text-white/70"
                    @focus="openEmployeePicker"
                    @input="onEmployeeInput"
                    @blur="closeEmployeePicker"
                  />

                  <div class="absolute inset-y-0 right-2 flex items-center gap-1">
                    <button
                      v-if="employeeQuery"
                      type="button"
                      class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20"
                      @mousedown.prevent="clearEmployeePick"
                    >
                      <i class="fa-solid fa-xmark text-[10px]" />
                    </button>

                    <span class="text-white/70">
                      <i class="fa-solid fa-user text-[10px]" />
                    </span>
                  </div>
                </div>

                <div
                  v-if="employeePickerOpen"
                  class="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
                >
                  <div v-if="loadingEmployees" class="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400">
                    Loading employees...
                  </div>

                  <template v-else>
                    <button
                      v-for="emp in filteredEmployees"
                      :key="emp.employeeId"
                      type="button"
                      class="flex w-full items-start justify-between gap-2 border-b border-slate-100 px-3 py-2 text-left text-[11px] hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/70"
                      @mousedown.prevent="pickEmployee(emp)"
                    >
                      <div class="min-w-0">
                        <div class="truncate font-semibold text-slate-800 dark:text-slate-100">
                          {{ emp.employeeId }} - {{ emp.name }}
                        </div>
                        <div class="truncate text-[10px] text-slate-500 dark:text-slate-400">
                          {{ emp.department || '—' }}{{ emp.position ? ` • ${emp.position}` : '' }}
                        </div>
                      </div>

                      <i
                        v-if="employeeId === emp.employeeId"
                        class="fa-solid fa-check mt-0.5 text-slate-600 dark:text-slate-300"
                      />
                    </button>

                    <div
                      v-if="!filteredEmployees.length"
                      class="px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400"
                    >
                      No employee found.
                    </div>
                  </template>
                </div>
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
                    <div class="ui-label !mb-1">Requester</div>
                    <div class="text-[12px] font-bold text-slate-800 dark:text-slate-100">
                      {{ requesterLabel(item) }}
                    </div>
                  </div>

                  <div class="mt-2 ui-frame p-2">
                    <div class="ui-label !mb-2">Meeting Title</div>
                    <div class="text-[12px] font-bold text-slate-800 dark:text-slate-100">
                      {{ item.meetingTitle || '—' }}
                    </div>
                  </div>

                  <div class="mt-2 grid gap-2">
                    <div class="mini-resource-card">
                      <div class="mini-resource-head">
                        <div class="mini-resource-title-wrap">
                          <span class="mini-resource-icon mini-resource-icon-neutral">
                            <i class="fa-solid fa-door-open" />
                          </span>
                          <div>
                            <div class="mini-resource-title">Room</div>
                            <div class="mini-resource-sub">
                              {{ item.roomRequired ? (item.roomName || 'Unnamed Room') : 'Not Required' }}
                            </div>
                          </div>
                        </div>

                        <span :class="sectionBadgeUiClass(item.roomStatus)">
                          {{ item.roomStatus || '—' }}
                        </span>
                      </div>

                      <div v-if="item.roomRequired" class="mt-2 service-grid-1">
                        <span
                          v-for="service in roomServiceItems(item)"
                          :key="service.key"
                          class="mini-chip mini-chip-green mini-chip-block"
                        >
                          <i class="fa-solid" :class="service.icon" />
                          {{ service.label }}
                        </span>

                        <span
                          v-if="!roomServiceItems(item).length"
                          class="mini-chip mini-chip-green mini-chip-block"
                        >
                          <i class="fa-solid fa-minus" />
                          No extra service
                        </span>
                      </div>
                    </div>

                    <div class="mini-resource-card">
                      <div class="mini-resource-head">
                        <div class="mini-resource-title-wrap">
                          <span class="mini-resource-icon mini-resource-icon-neutral">
                            <i class="fa-solid fa-paperclip" />
                          </span>
                          <div>
                            <div class="mini-resource-title">Material</div>
                            <div class="mini-resource-sub">
                              {{ item.materialRequired ? 'Attached items' : 'Not Required' }}
                            </div>
                          </div>
                        </div>

                        <span :class="sectionBadgeUiClass(item.materialStatus)">
                          {{ item.materialStatus || '—' }}
                        </span>
                      </div>

                      <div v-if="item.materialRequired" class="mt-2 service-grid-1">
                        <span
                          v-for="material in normalizedMaterialCards(item.materials)"
                          :key="material.key"
                          class="mini-chip mini-chip-green mini-chip-block"
                        >
                          <i class="fa-solid fa-paperclip" />
                          {{ material.name }} x{{ material.qty }}
                        </span>

                        <span
                          v-if="!normalizedMaterialCards(item.materials).length"
                          class="mini-chip mini-chip-green mini-chip-block"
                        >
                          <i class="fa-solid fa-minus" />
                          No material selected
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else class="history-table-shell">
                <div class="history-table-scroll">
                  <table class="ui-table history-table">
                    <thead>
                      <tr>
                        <th class="ui-th col-date">Booking Date & Time</th>
                        <th class="ui-th col-requester">Requester</th>
                        <th class="ui-th col-title">Title</th>
                        <th class="ui-th col-type">Type</th>
                        <th class="ui-th col-room">Room</th>
                        <th class="ui-th col-material">Material</th>
                        <th class="ui-th col-status">Status</th>
                        <th class="ui-th col-actions text-center">Actions</th>
                      </tr>
                    </thead>

                    <tbody>
                      <tr v-if="!pagedRows.length">
                        <td colspan="8" class="ui-td py-8 text-slate-500 dark:text-slate-400">
                          No meeting room requests found.
                        </td>
                      </tr>

                      <tr v-for="item in pagedRows" :key="item._id" class="ui-tr-hover">
                        <td class="ui-td whitespace-nowrap align-top">
                          <div class="flex flex-col">
                            <span class="font-semibold text-slate-900 dark:text-slate-100">
                              {{ fmtDate(item.bookingDate) }}
                            </span>
                            <span class="text-[11px] text-slate-500 dark:text-slate-400">
                              {{ fmtTime(item.timeStart) }} - {{ fmtTime(item.timeEnd) }}
                            </span>
                          </div>
                        </td>

                        <td class="ui-td align-top">
                          <div class="min-w-0">
                            <div class="font-semibold text-slate-900 dark:text-slate-100 break-words">
                              {{ requesterLabel(item) }}
                            </div>
                            <div class="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                              {{ item.employeeId || '—' }}
                            </div>
                          </div>
                        </td>

                        <td class="ui-td align-top">
                          <div class="min-w-0">
                            <div
                              class="font-semibold text-slate-900 dark:text-slate-100 break-words"
                              :title="item.meetingTitle || '—'"
                            >
                              {{ item.meetingTitle || '—' }}
                            </div>
                            <div class="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                              {{ item.createdAt ? dayjs(item.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
                            </div>
                          </div>
                        </td>

                        <td class="ui-td align-top">
                          <span :class="typeBadgeUiClass(item)">
                            {{ bookingRoomTypeLabel(item) }}
                          </span>
                        </td>

                        <td class="ui-td align-top">
                          <div class="resource-cell-card">
                            <div class="resource-cell-head">
                              <div class="resource-cell-main">
                                <span class="resource-cell-icon resource-cell-icon-neutral">
                                  <i class="fa-solid fa-door-open" />
                                </span>
                                <div class="min-w-0 w-full">
                                  <div class="resource-cell-title">
                                    {{ item.roomRequired ? (item.roomName || 'Unnamed Room') : 'Not Required' }}
                                  </div>
                                  <div class="resource-cell-sub">Room</div>
                                </div>
                              </div>

                              <span :class="sectionBadgeUiClass(item.roomStatus)">
                                {{ item.roomStatus || '—' }}
                              </span>
                            </div>

                            <div v-if="item.roomRequired" class="mt-2 service-grid-1">
                              <span
                                v-for="service in roomServiceItems(item)"
                                :key="service.key"
                                class="mini-chip mini-chip-sm mini-chip-green mini-chip-block"
                              >
                                <i class="fa-solid" :class="service.icon" />
                                {{ service.label }}
                              </span>

                              <span
                                v-if="!roomServiceItems(item).length"
                                class="mini-chip mini-chip-sm mini-chip-green mini-chip-block"
                              >
                                <i class="fa-solid fa-minus" />
                                No extra service
                              </span>
                            </div>
                          </div>
                        </td>

                        <td class="ui-td align-top">
                          <div class="resource-cell-card">
                            <div class="resource-cell-head">
                              <div class="resource-cell-main">
                                <span class="resource-cell-icon resource-cell-icon-neutral">
                                  <i class="fa-solid fa-paperclip" />
                                </span>
                                <div class="min-w-0 w-full">
                                  <div class="resource-cell-title">
                                    {{ item.materialRequired ? 'Attached Items' : 'Not Required' }}
                                  </div>
                                  <div class="resource-cell-sub">Material</div>
                                </div>
                              </div>

                              <span :class="sectionBadgeUiClass(item.materialStatus)">
                                {{ item.materialStatus || '—' }}
                              </span>
                            </div>

                            <div v-if="item.materialRequired" class="mt-2 service-grid-1">
                              <span
                                v-for="material in normalizedMaterialCards(item.materials)"
                                :key="material.key"
                                class="mini-chip mini-chip-sm mini-chip-green mini-chip-block"
                              >
                                <i class="fa-solid fa-paperclip" />
                                {{ material.name }} x{{ material.qty }}
                              </span>

                              <span
                                v-if="!normalizedMaterialCards(item.materials).length"
                                class="mini-chip mini-chip-sm mini-chip-green mini-chip-block"
                              >
                                <i class="fa-solid fa-minus" />
                                No material selected
                              </span>
                            </div>
                          </div>
                        </td>

                        <td class="ui-td align-top">
                          <span :class="statusBadgeUiClass(item.overallStatus)">
                            {{ bookingRoomStatusLabel(item.overallStatus) }}
                          </span>
                        </td>

                        <td class="ui-td text-center align-top">
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
              </div>

              <div
                v-if="processedRows.length"
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
              <div class="grid gap-3 md:grid-cols-4">
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

                <div>
                  <div class="ui-label">Requester</div>
                  <div class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                    {{ requesterLabel(detailItem) }}
                  </div>
                </div>

                <div class="md:text-right">
                  <div class="ui-label">Booking Date</div>
                  <div class="text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                    {{ fmtDate(detailItem?.bookingDate) }}
                  </div>
                </div>
              </div>
            </div>

            <div class="ui-card p-4">
              <div class="ui-section-title text-[14px]">Meeting Info</div>
              <div class="mt-3 grid gap-3 md:grid-cols-2 text-[12px]">
                <div class="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60">
                  <div class="ui-label">Meeting Title</div>
                  <div class="text-[14px] font-extrabold text-slate-900 dark:text-slate-50">
                    {{ detailItem?.meetingTitle || '—' }}
                  </div>
                </div>

                <div class="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60">
                  <div class="ui-label">Time</div>
                  <div class="text-[14px] font-extrabold text-slate-900 dark:text-slate-50">
                    {{ fmtTime(detailItem?.timeStart) }} - {{ fmtTime(detailItem?.timeEnd) }}
                  </div>
                </div>

                <div class="rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/60">
                  <div class="ui-label">Participant Estimate</div>
                  <div class="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                    {{ detailItem?.participantEstimate || '—' }}
                  </div>
                </div>
              </div>
            </div>

            <div class="ui-card p-4">
              <div class="ui-section-title text-[14px]">Room & Material</div>

              <div class="mt-3 grid gap-3 md:grid-cols-2">
                <div class="resource-detail-card">
                  <div class="resource-detail-head">
                    <div class="resource-detail-title-wrap">
                      <span class="resource-detail-icon resource-detail-icon-neutral">
                        <i class="fa-solid fa-door-open" />
                      </span>
                      <div>
                        <div class="resource-detail-title">Room</div>
                        <div class="resource-detail-name">
                          {{ detailItem?.roomRequired ? (detailItem?.roomName || 'Unnamed Room') : 'Not Required' }}
                        </div>
                      </div>
                    </div>

                    <span :class="sectionBadgeUiClass(detailItem?.roomStatus)">
                      {{ detailItem?.roomStatus || '—' }}
                    </span>
                  </div>

                  <div v-if="detailItem?.roomRequired" class="mt-3">
                    <div class="ui-label">Room Services</div>

                    <div class="mt-2 service-grid-1">
                      <span
                        v-for="service in roomServiceItems(detailItem)"
                        :key="service.key"
                        class="mini-chip mini-chip-green mini-chip-block"
                      >
                        <i class="fa-solid" :class="service.icon" />
                        {{ service.label }}
                      </span>

                      <span
                        v-if="!roomServiceItems(detailItem).length"
                        class="mini-chip mini-chip-green mini-chip-block"
                      >
                        <i class="fa-solid fa-minus" />
                        No extra service
                      </span>
                    </div>
                  </div>

                  <div class="mt-3 rounded-xl bg-slate-50 p-2.5 text-[11px] text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
                    {{ detailItem?.roomApproval?.note || 'No room note.' }}
                  </div>
                </div>

                <div class="resource-detail-card">
                  <div class="resource-detail-head">
                    <div class="resource-detail-title-wrap">
                      <span class="resource-detail-icon resource-detail-icon-neutral">
                        <i class="fa-solid fa-paperclip" />
                      </span>
                      <div>
                        <div class="resource-detail-title">Material</div>
                        <div class="resource-detail-name">
                          {{ detailItem?.materialRequired ? 'Attached Items' : 'Not Required' }}
                        </div>
                      </div>
                    </div>

                    <span :class="sectionBadgeUiClass(detailItem?.materialStatus)">
                      {{ detailItem?.materialStatus || '—' }}
                    </span>
                  </div>

                  <div v-if="detailItem?.materialRequired" class="mt-3 service-grid-1">
                    <span
                      v-for="material in normalizedMaterialCards(detailItem?.materials)"
                      :key="material.key"
                      class="mini-chip mini-chip-green mini-chip-block"
                    >
                      <i class="fa-solid fa-paperclip" />
                      {{ material.name }} x{{ material.qty }}
                    </span>

                    <span
                      v-if="!normalizedMaterialCards(detailItem?.materials).length"
                      class="mini-chip mini-chip-green mini-chip-block"
                    >
                      <i class="fa-solid fa-minus" />
                      No material selected
                    </span>
                  </div>

                  <div class="mt-3 rounded-xl bg-slate-50 p-2.5 text-[11px] text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
                    {{ detailItem?.materialApproval?.note || 'No material note.' }}
                  </div>
                </div>
              </div>
            </div>

            <div class="ui-card p-3">
              <div class="ui-section-title">Note</div>
              <div class="mt-1 whitespace-pre-wrap text-[12px] text-slate-700 dark:text-slate-200">
                {{ detailItem?.requirementNote || detailItem?.note || '—' }}
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

      <div v-if="editOpen" class="ui-modal-backdrop">
        <div class="ui-modal ui-modal-xl p-0 overflow-hidden">
          <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div class="min-w-0">
              <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Edit Meeting Room Request</div>
              <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Update booking info, room, room services, and materials before approval is locked.
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

              <div class="ui-field">
                <label class="ui-label">Meeting Title</label>
                <input v-model="editForm.meetingTitle" type="text" class="ui-input" :disabled="editBusy" />
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

                  <div v-if="editForm.roomRequired" class="mt-3">
                    <label class="ui-label">Room Services</label>

                    <div class="mt-2 service-grid-1">
                      <button
                        type="button"
                        class="service-toggle-btn"
                        :class="editForm.needCoffeeBreak ? 'service-toggle-btn-on' : 'service-toggle-btn-off'"
                        :disabled="editBusy"
                        @click="editForm.needCoffeeBreak = !editForm.needCoffeeBreak"
                      >
                        <i class="fa-solid fa-mug-hot" />
                        Coffee Break
                      </button>

                      <button
                        type="button"
                        class="service-toggle-btn"
                        :class="editForm.needNameOnTable ? 'service-toggle-btn-on' : 'service-toggle-btn-off'"
                        :disabled="editBusy"
                        @click="editForm.needNameOnTable = !editForm.needNameOnTable"
                      >
                        <i class="fa-solid fa-id-card" />
                        Name on Table
                      </button>

                      <button
                        type="button"
                        class="service-toggle-btn"
                        :class="editForm.needWifiPassword ? 'service-toggle-btn-on' : 'service-toggle-btn-off'"
                        :disabled="editBusy"
                        @click="editForm.needWifiPassword = !editForm.needWifiPassword"
                      >
                        <i class="fa-solid fa-wifi" />
                        WiFi Password
                      </button>
                    </div>
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
                          ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/20'
                          : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/60'"
                      >
                        <div class="flex items-start justify-between gap-2">
                          <div class="min-w-0">
                            <div class="flex items-center gap-2">
                              <button
                                type="button"
                                class="inline-flex h-7 w-7 items-center justify-center rounded-full border text-[11px] transition"
                                :class="isEditMaterialOn(item.code)
                                  ? 'border-emerald-500 bg-emerald-500 text-white'
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
                      class="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2
                             dark:border-slate-700 dark:bg-slate-900/60"
                    >
                      <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-700 dark:text-slate-300">
                        Selected Materials
                      </div>

                      <div class="mt-2 service-grid-1">
                        <span
                          v-for="item in editForm.materials"
                          :key="item.materialCode"
                          class="mini-chip mini-chip-green mini-chip-block"
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
                <label class="ui-label">Note</label>
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

.history-table-shell {
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  border-radius: 18px;
}

.history-table-scroll {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 4px;
}

.history-table {
  width: max-content;
  min-width: 100%;
  table-layout: auto;
}

.col-date {
  width: 1%;
  white-space: nowrap;
}

.col-requester {
  min-width: 140px;
  width: 160px;
}

.col-title {
  min-width: 180px;
  width: auto;
}

.col-type {
  width: 150px;
  white-space: nowrap;
}

.col-room {
  width: auto;
  min-width: 170px;
}

.col-material {
  width: auto;
  min-width: 170px;
}

.col-status {
  width: 1%;
  white-space: nowrap;
}

.col-actions {
  width: 1%;
  white-space: nowrap;
}

.history-table-scroll::-webkit-scrollbar {
  height: 10px;
}

.history-table-scroll::-webkit-scrollbar-thumb {
  background: rgba(148, 163, 184, 0.55);
  border-radius: 999px;
}

.history-table-scroll::-webkit-scrollbar-track {
  background: rgba(226, 232, 240, 0.55);
  border-radius: 999px;
}

.dark .history-table-scroll::-webkit-scrollbar-thumb {
  background: rgba(100, 116, 139, 0.8);
}

.dark .history-table-scroll::-webkit-scrollbar-track {
  background: rgba(30, 41, 59, 0.85);
}

.mini-resource-card {
  border: 1px solid rgba(226, 232, 240, 1);
  background: rgba(248, 250, 252, 0.95);
  border-radius: 16px;
  padding: 12px;
}

.dark .mini-resource-card {
  border-color: rgba(51, 65, 85, 1);
  background: rgba(15, 23, 42, 0.72);
}

.mini-resource-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.mini-resource-title-wrap {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}

.mini-resource-icon {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  flex-shrink: 0;
}

.mini-resource-icon-neutral {
  background: rgb(241 245 249);
  color: rgb(71 85 105);
}

.dark .mini-resource-icon-neutral {
  background: rgba(51, 65, 85, 0.7);
  color: rgb(226 232 240);
}

.mini-resource-title {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgb(100 116 139);
}

.dark .mini-resource-title {
  color: rgb(148 163 184);
}

.mini-resource-sub {
  margin-top: 2px;
  font-size: 12px;
  font-weight: 700;
  color: rgb(15 23 42);
  line-height: 1.35;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.dark .mini-resource-sub {
  color: rgb(241 245 249);
}

.resource-cell-card {
  display: inline-block;
  width: auto;
  min-width: 150px;
  max-width: 100%;
  border: 1px solid rgba(226, 232, 240, 1);
  background: rgba(248, 250, 252, 0.95);
  border-radius: 16px;
  padding: 8px 10px;
}

.dark .resource-cell-card {
  border-color: rgba(51, 65, 85, 1);
  background: rgba(15, 23, 42, 0.7);
}

.resource-cell-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.resource-cell-main {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
  flex: 1 1 auto;
}

.resource-cell-icon {
  width: 30px;
  height: 30px;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.resource-cell-icon-neutral {
  background: rgb(241 245 249);
  color: rgb(71 85 105);
}

.dark .resource-cell-icon-neutral {
  background: rgba(51, 65, 85, 0.7);
  color: rgb(226 232 240);
}

.resource-cell-title {
  font-size: 12px;
  font-weight: 700;
  color: rgb(15 23 42);
  line-height: 1.35;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.dark .resource-cell-title {
  color: rgb(241 245 249);
}

.resource-cell-sub {
  margin-top: 2px;
  font-size: 10px;
  color: rgb(100 116 139);
}

.dark .resource-cell-sub {
  color: rgb(148 163 184);
}

.resource-detail-card {
  border: 1px solid rgba(226, 232, 240, 1);
  background: rgba(248, 250, 252, 0.95);
  border-radius: 18px;
  padding: 14px;
}

.dark .resource-detail-card {
  border-color: rgba(51, 65, 85, 1);
  background: rgba(15, 23, 42, 0.72);
}

.resource-detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.resource-detail-title-wrap {
  display: flex;
  gap: 10px;
  min-width: 0;
}

.resource-detail-icon {
  width: 38px;
  height: 38px;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.resource-detail-icon-neutral {
  background: rgb(241 245 249);
  color: rgb(71 85 105);
}

.dark .resource-detail-icon-neutral {
  background: rgba(51, 65, 85, 0.7);
  color: rgb(226 232 240);
}

.resource-detail-title {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgb(100 116 139);
}

.dark .resource-detail-title {
  color: rgb(148 163 184);
}

.resource-detail-name {
  margin-top: 2px;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.35;
  color: rgb(15 23 42);
  word-break: break-word;
  overflow-wrap: anywhere;
}

.dark .resource-detail-name {
  color: rgb(241 245 249);
}

.service-grid-1 {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  min-width: 0;
}

.mini-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  border-radius: 14px;
  border: 1px solid rgba(203, 213, 225, 1);
  background: white;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 700;
  color: rgb(51 65 85);
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.dark .mini-chip {
  border-color: rgba(71, 85, 105, 1);
  background: rgba(15, 23, 42, 1);
  color: rgb(226 232 240);
}

.mini-chip-sm {
  padding: 4px 8px;
  font-size: 10px;
}

.mini-chip-block {
  width: 100%;
  justify-content: flex-start;
  text-align: left;
}

.mini-chip-green {
  border-color: rgb(134 239 172);
  background: rgb(240 253 244);
  color: rgb(22 101 52);
}

.dark .mini-chip-green {
  border-color: rgba(34, 197, 94, 0.45);
  background: rgba(20, 83, 45, 0.45);
  color: rgb(187 247 208);
}

.service-toggle-btn {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  border-radius: 14px;
  border-width: 1px;
  padding: 10px 12px;
  font-size: 11px;
  font-weight: 700;
  transition: 0.2s ease;
}

.service-toggle-btn-on {
  border-color: rgb(34 197 94);
  background: rgb(34 197 94);
  color: white;
}

.service-toggle-btn-off {
  border-color: rgb(203 213 225);
  background: white;
  color: rgb(51 65 85);
}

.service-toggle-btn-off:hover {
  background: rgb(248 250 252);
}

.dark .service-toggle-btn-off {
  border-color: rgb(71 85 105);
  background: rgb(15 23 42);
  color: rgb(226 232 240);
}

.dark .service-toggle-btn-off:hover {
  background: rgb(30 41 59);
}

.dark .service-toggle-btn-on {
  border-color: rgba(34, 197, 94, 0.7);
  background: rgba(22, 163, 74, 0.95);
  color: white;
}

@media (max-width: 1279px) {
  .col-room,
  .col-material {
    min-width: 160px;
  }

  .resource-cell-card {
    min-width: 145px;
  }
}

@media (max-width: 1023px) {
  .history-table {
    min-width: 1060px;
  }
}
</style>