<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import { useRouter } from 'vue-router'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import socket from '@/utils/socket'

import { searchBookingRoomEmployees } from '@/utils/bookingRoom.api'

import BookingRoomRequesterSection from './sections/BookingRoomRequesterSection.vue'
import BookingRoomDetailSection from './sections/BookingRoomDetailSection.vue'
import BookingRoomRequestTypeSection from './sections/BookingRoomRequestTypeSection.vue'
import BookingRoomRecurringSection from './sections/BookingRoomRecurringSection.vue'

defineOptions({ name: 'PublicBookingRoomRequest' })

const router = useRouter()
const { showToast } = useToast()

const loadingEmployees = ref(false)
const loadingAvailability = ref(false)
const submitting = ref(false)

const employees = ref([])
const selectedEmployee = ref(null)

const activeRooms = ref([])
const activeMaterials = ref([])
const holidayDates = ref([])

let availabilityRefreshTimer = null

const form = ref({
  employeeId: '',
  name: '',
  department: '',
  position: '',
  contactNumber: '',

  bookingDate: dayjs().format('YYYY-MM-DD'),
  endDate: dayjs().format('YYYY-MM-DD'),
  recurring: false,
  skipHoliday: true,

  timeStart: '',
  timeEnd: '',
  timeStartHour: '',
  timeStartMinute: '00',
  timeEndHour: '',
  timeEndMinute: '00',

  meetingTitle: '',
  participantEstimate: 1,
  note: '',

  roomRequired: false,
  roomId: '',
  roomCode: '',
  roomName: '',

  materialRequired: false,
  materials: [],

  needCoffeeBreak: false,
  needNameOnTable: false,
  needWifiPassword: false,
})

function s(v) {
  return String(v ?? '').trim()
}

function up(v) {
  return s(v).toUpperCase()
}

function compactText(v) {
  return String(v || '').replace(/\s+/g, ' ').trim()
}

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN
  return (h * 60) + m
}

function formatLines(list = [], title = 'Please check:') {
  const rows = Array.isArray(list)
    ? list.map((x) => s(x)).filter(Boolean)
    : []

  if (!rows.length) return title
  return `${title}\n• ${rows.join('\n• ')}`
}

function extractBackendMessage(error, fallback = 'Unable to process request.') {
  const data = error?.response?.data || {}

  const lines = []

  if (Array.isArray(data?.errors)) {
    for (const item of data.errors) {
      if (typeof item === 'string') {
        const text = s(item)
        if (text) lines.push(text)
      } else if (item && typeof item === 'object') {
        const text = s(item.message || item.msg || item.reason)
        if (text) lines.push(text)
      }
    }
  }

  if (Array.isArray(data?.details)) {
    for (const item of data.details) {
      if (typeof item === 'string') {
        const text = s(item)
        if (text) lines.push(text)
      } else if (item && typeof item === 'object') {
        const text = s(item.message || item.msg || item.reason)
        if (text) lines.push(text)
      }
    }
  }

  const mainMessage =
    s(data?.message) ||
    s(data?.error) ||
    s(data?.reason) ||
    s(error?.message)

  const unique = []
  const seen = new Set()

  for (const line of lines) {
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(line)
  }

  if (mainMessage && unique.length) {
    const mainKey = mainMessage.toLowerCase()
    const filtered = unique.filter((x) => x.toLowerCase() !== mainKey)
    if (filtered.length) {
      return `${mainMessage}\n• ${filtered.join('\n• ')}`
    }
    return mainMessage
  }

  if (mainMessage) return mainMessage
  if (unique.length === 1) return unique[0]
  if (unique.length > 1) return `• ${unique.join('\n• ')}`
  return fallback
}

function syncLegacyTimeParts() {
  const start = s(form.value.timeStart)
  const end = s(form.value.timeEnd)

  if (start.includes(':')) {
    const [h, m] = start.split(':')
    form.value.timeStartHour = h || ''
    form.value.timeStartMinute = m || '00'
  } else {
    form.value.timeStartHour = ''
    form.value.timeStartMinute = '00'
  }

  if (end.includes(':')) {
    const [h, m] = end.split(':')
    form.value.timeEndHour = h || ''
    form.value.timeEndMinute = m || '00'
  } else {
    form.value.timeEndHour = ''
    form.value.timeEndMinute = '00'
  }
}

function resetForm({ keepEmployee = true } = {}) {
  const current = selectedEmployee.value

  form.value = {
    employeeId: keepEmployee ? s(current?.employeeId) : '',
    name: keepEmployee ? s(current?.name) : '',
    department: keepEmployee ? s(current?.department) : '',
    position: keepEmployee ? s(current?.position) : '',
    contactNumber: keepEmployee ? s(current?.contactNumber) : '',

    bookingDate: dayjs().format('YYYY-MM-DD'),
    endDate: dayjs().format('YYYY-MM-DD'),
    recurring: false,
    skipHoliday: true,

    timeStart: '',
    timeEnd: '',
    timeStartHour: '',
    timeStartMinute: '00',
    timeEndHour: '',
    timeEndMinute: '00',

    meetingTitle: '',
    participantEstimate: 1,
    note: '',

    roomRequired: false,
    roomId: '',
    roomCode: '',
    roomName: '',

    materialRequired: false,
    materials: [],

    needCoffeeBreak: false,
    needNameOnTable: false,
    needWifiPassword: false,    
  }

  activeRooms.value = []
  activeMaterials.value = []
}

async function loadEmployees(q = '') {
  try {
    loadingEmployees.value = true

    const rows = await searchBookingRoomEmployees({ q, activeOnly: true })

    employees.value = (Array.isArray(rows) ? rows : []).map((x) => ({
      employeeId: s(x.employeeId),
      name: s(x.name),
      department: s(x.department),
      position: s(x.position),
      contactNumber: s(x.contactNumber),
      isActive: !!x.isActive,
    }))
  } catch (e) {
    showToast({
      type: 'error',
      message: extractBackendMessage(e, 'Failed to load employee list.'),
    })
  } finally {
    loadingEmployees.value = false
  }
}

async function loadHolidayDates() {
  try {
    const res = await api.get('/public/holidays')
    holidayDates.value = Array.isArray(res?.data?.holidays)
      ? res.data.holidays.map((x) => s(x)).filter(Boolean)
      : []
  } catch (e) {
    holidayDates.value = []
    console.error('Failed to load holidays:', e)
  }
}

function selectEmployee(emp) {
  const data = emp || {}

  selectedEmployee.value = s(data.employeeId)
    ? {
        employeeId: s(data.employeeId),
        name: s(data.name),
        department: s(data.department),
        position: s(data.position),
        contactNumber: s(data.contactNumber),
      }
    : null

  form.value.employeeId = s(data.employeeId)
  form.value.name = s(data.name)
  form.value.department = s(data.department)
  form.value.position = s(data.position)
  form.value.contactNumber = s(data.contactNumber)

  if (form.value.employeeId) {
    localStorage.setItem('bookingRoomEmployeeId', form.value.employeeId)
  } else {
    localStorage.removeItem('bookingRoomEmployeeId')
  }
}

async function loadActiveMastersOnly({ silent = false } = {}) {
  try {
    if (!silent) loadingAvailability.value = true

    const [roomRes, materialRes] = await Promise.all([
      api.get('/public/booking-room/rooms/active'),
      api.get('/public/booking-room/materials/active'),
    ])

    activeRooms.value = (Array.isArray(roomRes?.data) ? roomRes.data : []).map((x) => ({
      _id: x?._id || '',
      code: s(x?.code),
      name: s(x?.name),
      capacity: Math.max(0, Number(x?.capacity || 0)),
      imageUrl: s(x?.imageUrl),
      isActive: x?.isActive !== false,
      isAvailable: true,
      status: 'AVAILABLE',
    }))

    activeMaterials.value = (Array.isArray(materialRes?.data) ? materialRes.data : []).map((x) => ({
      _id: x?._id || '',
      code: up(x?.code),
      name: s(x?.name),
      totalQty: Math.max(0, Number(x?.totalQty || 0)),
      usedQty: 0,
      availableQty: Math.max(0, Number(x?.totalQty || 0)),
      isActive: x?.isActive !== false,
      isAvailable: Math.max(0, Number(x?.totalQty || 0)) > 0,
      status: Math.max(0, Number(x?.totalQty || 0)) > 0 ? 'AVAILABLE' : 'OUT_OF_STOCK',
    }))
  } catch (e) {
    activeRooms.value = []
    activeMaterials.value = []

    showToast({
      type: 'error',
      message: extractBackendMessage(e, 'Failed to load room/material list.'),
    })
  } finally {
    if (!silent) loadingAvailability.value = false
  }
}

async function loadAvailability({ silent = false } = {}) {
  try {
    const date = s(form.value.bookingDate)
    const timeStart = s(form.value.timeStart)
    const timeEnd = s(form.value.timeEnd)

    if (!date) {
      activeRooms.value = []
      activeMaterials.value = []
      return
    }

    if (!timeStart || !timeEnd || toMinutes(timeEnd) <= toMinutes(timeStart)) {
      await loadActiveMastersOnly({ silent: true })
      return
    }

    if (!silent) loadingAvailability.value = true

    const res = await api.get('/public/booking-room/availability', {
      params: {
        date,
        timeStart,
        timeEnd,
      },
    })

    activeRooms.value = (Array.isArray(res?.data?.rooms) ? res.data.rooms : []).map((x) => ({
      _id: x?._id || '',
      code: s(x?.code),
      name: s(x?.name),
      capacity: Math.max(0, Number(x?.capacity || 0)),
      imageUrl: s(x?.imageUrl),
      isActive: true,
      isAvailable: x?.isAvailable !== false,
      status: s(x?.status || 'AVAILABLE'),
    }))

    activeMaterials.value = (Array.isArray(res?.data?.materials) ? res.data.materials : []).map((x) => ({
      _id: x?._id || '',
      code: up(x?.code),
      name: s(x?.name),
      totalQty: Math.max(0, Number(x?.totalQty || 0)),
      usedQty: Math.max(0, Number(x?.usedQty || 0)),
      availableQty: Math.max(0, Number(x?.availableQty || 0)),
      isActive: true,
      isAvailable: x?.isAvailable !== false,
      status: s(x?.status || 'AVAILABLE'),
    }))
  } catch (e) {
    if (!silent) {
      showToast({
        type: 'error',
        message: extractBackendMessage(e, 'Failed to check availability.'),
      })
    }
    activeRooms.value = []
    activeMaterials.value = []
  } finally {
    if (!silent) loadingAvailability.value = false
  }
}

const requestTypeLabel = computed(() => {
  if (form.value.roomRequired && form.value.materialRequired) return 'Room + Material'
  if (form.value.roomRequired) return 'Room Only'
  if (form.value.materialRequired) return 'Material Only'
  return '—'
})

function validateForm() {
  const e = []
  const f = form.value

  if (!s(f.employeeId)) e.push('Requester is required.')
  if (!s(f.bookingDate)) e.push('Booking date is required.')
  if (!s(f.timeStart)) e.push('Start time is required.')
  if (!s(f.timeEnd)) e.push('End time is required.')

  if (s(f.timeStart) && s(f.timeEnd) && toMinutes(f.timeEnd) <= toMinutes(f.timeStart)) {
    e.push('End time must be after start time.')
  }

  if (f.recurring) {
    if (!s(f.endDate)) e.push('End date is required for recurring booking.')
    if (s(f.endDate) && dayjs(f.endDate).isBefore(dayjs(f.bookingDate), 'day')) {
      e.push('End date must be the same or after booking date.')
    }
  }

  if (!f.roomRequired && !f.materialRequired) {
    e.push('Please choose at least room or material.')
  }

  if (f.roomRequired && !s(f.roomId) && !s(f.roomCode) && !s(f.roomName)) {
    e.push('Please select a meeting room.')
  }

  if (f.materialRequired && !(Array.isArray(f.materials) && f.materials.length)) {
    e.push('Please choose at least one material.')
  }

  if (!compactText(f.meetingTitle)) e.push('Meeting title is required.')

  if (Number(f.participantEstimate || 0) <= 0) {
    e.push('Participant estimate must be greater than 0.')
  }

  return e
}

async function submit() {
  syncLegacyTimeParts()

  const e = validateForm()
  if (e.length) {
    showToast({
      type: 'warning',
      message: formatLines(e, 'Please check the following:'),
    })
    return
  }

  try {
    submitting.value = true

    const payload = {
      employeeId: s(form.value.employeeId),
      bookingDate: s(form.value.bookingDate),
      endDate: form.value.recurring ? s(form.value.endDate) : '',
      skipHoliday: !!form.value.skipHoliday,
      timeStart: s(form.value.timeStart),
      timeEnd: s(form.value.timeEnd),
      meetingTitle: compactText(form.value.meetingTitle),
      participantEstimate: Number(form.value.participantEstimate || 1),
      note: compactText(form.value.note),
      needCoffeeBreak: form.value.roomRequired ? !!form.value.needCoffeeBreak : false,
      needNameOnTable: form.value.roomRequired ? !!form.value.needNameOnTable : false,
      needWifiPassword: form.value.roomRequired ? !!form.value.needWifiPassword : false,

      roomRequired: !!form.value.roomRequired,
      roomId: form.value.roomRequired ? (form.value.roomId || null) : null,
      roomCode: form.value.roomRequired ? s(form.value.roomCode) : '',
      roomName: form.value.roomRequired ? s(form.value.roomName) : '',

      materialRequired: !!form.value.materialRequired,
      materials: form.value.materialRequired
        ? (Array.isArray(form.value.materials) ? form.value.materials : []).map((x) => ({
            materialId: x?.materialId || null,
            materialCode: s(x?.materialCode),
            materialName: s(x?.materialName),
            qty: Math.max(1, Number(x?.qty || 1)),
          }))
        : [],
    }

    if (form.value.recurring) {
      await api.post('/public/booking-room/recurring', payload)
    } else {
      await api.post('/public/booking-room', payload)
    }

    showToast({
      type: 'success',
      title: 'Submitted',
      message: form.value.recurring
        ? 'Your recurring meeting room request has been submitted.'
        : 'Your meeting room request has been submitted.',
    })

    resetForm({ keepEmployee: true })

    if (router.hasRoute('public-booking-room-history')) {
      router.push({ name: 'public-booking-room-history' })
    }
  } catch (e) {
    showToast({
      type: 'error',
      title: 'Submit failed',
      message: extractBackendMessage(e, 'Unable to submit request.'),
    })
  } finally {
    submitting.value = false
  }
}

function queueAvailabilityRefresh() {
  if (availabilityRefreshTimer) clearTimeout(availabilityRefreshTimer)
  availabilityRefreshTimer = setTimeout(() => {
    loadAvailability({ silent: true })
  }, 250)
}

function onRoomMasterChanged() {
  queueAvailabilityRefresh()
}

function onMaterialMasterChanged() {
  queueAvailabilityRefresh()
}

function onMastersChanged() {
  queueAvailabilityRefresh()
}

function onAvailabilityChanged() {
  queueAvailabilityRefresh()
}

function onReqCreated() {
  queueAvailabilityRefresh()
}

function onReqUpdated() {
  queueAvailabilityRefresh()
}

onMounted(async () => {
  await Promise.all([
    loadEmployees(),
    loadActiveMastersOnly(),
    loadHolidayDates(),
  ])

  const savedId = localStorage.getItem('bookingRoomEmployeeId') || ''
  if (savedId) {
    const found = employees.value.find((x) => s(x.employeeId) === s(savedId))
    if (found) selectEmployee(found)
  }

  socket.on('bookingroom:room-master:created', onRoomMasterChanged)
  socket.on('bookingroom:room-master:updated', onRoomMasterChanged)
  socket.on('bookingroom:room-master:deleted', onRoomMasterChanged)

  socket.on('bookingroom:material-master:created', onMaterialMasterChanged)
  socket.on('bookingroom:material-master:updated', onMaterialMasterChanged)
  socket.on('bookingroom:material-master:deleted', onMaterialMasterChanged)

  socket.on('bookingroom:masters:changed', onMastersChanged)
  socket.on('bookingroom:availability:changed', onAvailabilityChanged)

  socket.on('bookingroom:req:created', onReqCreated)
  socket.on('bookingroom:req:updated', onReqUpdated)
})

onBeforeUnmount(() => {
  if (availabilityRefreshTimer) {
    clearTimeout(availabilityRefreshTimer)
    availabilityRefreshTimer = null
  }

  socket.off('bookingroom:room-master:created', onRoomMasterChanged)
  socket.off('bookingroom:room-master:updated', onRoomMasterChanged)
  socket.off('bookingroom:room-master:deleted', onRoomMasterChanged)

  socket.off('bookingroom:material-master:created', onMaterialMasterChanged)
  socket.off('bookingroom:material-master:updated', onMaterialMasterChanged)
  socket.off('bookingroom:material-master:deleted', onMaterialMasterChanged)

  socket.off('bookingroom:masters:changed', onMastersChanged)
  socket.off('bookingroom:availability:changed', onAvailabilityChanged)

  socket.off('bookingroom:req:created', onReqCreated)
  socket.off('bookingroom:req:updated', onReqUpdated)
})
</script>

<template>
  <div class="ui-page">
    <div class="ui-container py-2">
      <div class="ui-card overflow-hidden">
        <div class="ui-hero-gradient">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div class="text-sm font-extrabold">Meeting Room Booking</div>
            </div>

            <div class="flex gap-2">
              <button
                class="ui-btn ui-btn-primary"
                type="button"
                :disabled="submitting || loadingAvailability"
                @click="submit"
              >
                <i v-if="submitting" class="fa-solid fa-spinner animate-spin text-[11px]" />
                Submit Request
              </button>
            </div>
          </div>
        </div>

        <div class="space-y-3 p-3">
          <div class="grid gap-3 xl:grid-cols-12">
            <div class="xl:col-span-4">
              <BookingRoomRequesterSection
                :employees="employees"
                :form="form"
                :loading-employees="loadingEmployees"
                @select-employee="selectEmployee"
              />
            </div>

            <div class="xl:col-span-8">
              <BookingRoomDetailSection
                :form="form"
                @load-availability="loadAvailability"
              />
            </div>
          </div>

          <div>
            <BookingRoomRequestTypeSection
              :form="form"
              :BOOKING_ROOM_NAMES="activeRooms"
              :BOOKING_ROOM_MATERIALS="activeMaterials"
              :loading-availability="loadingAvailability"
            />
          </div>

                    <div>
            <BookingRoomRecurringSection
              :form="form"
              :holiday-dates="holidayDates"
            />
          </div>

          <div
            class="flex items-center justify-between gap-3 border-t border-slate-200 pt-3 text-[11px] dark:border-slate-800"
          >
            <div class="text-slate-500 dark:text-slate-400">
              Please review requester, booking detail, and request type before submitting.
            </div>

            <div class="flex items-center gap-2">
              <span
                class="hidden rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 sm:inline-flex"
              >
                {{ requestTypeLabel }}
              </span>

              <button
                class="ui-btn ui-btn-primary"
                type="button"
                :disabled="submitting || loadingAvailability"
                @click="submit"
              >
                <i v-if="submitting" class="fa-solid fa-spinner animate-spin text-[11px]" />
                Submit Request
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>