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

defineOptions({ name: 'PublicBookingRoomRequest' })

const router = useRouter()
const { showToast } = useToast()

/* ───────────────── STATE ───────────────── */
const loadingEmployees = ref(false)
const loadingMasters = ref(false)
const submitting = ref(false)

const employees = ref([])
const selectedEmployee = ref(null)

const activeRooms = ref([])
const activeMaterials = ref([])
const scheduleRows = ref([])

const form = ref({
  employeeId: '',
  name: '',
  department: '',
  position: '',
  contactNumber: '',

  bookingDate: dayjs().format('YYYY-MM-DD'),
  timeStart: '',
  timeEnd: '',
  timeStartHour: '',
  timeStartMinute: '00',
  timeEndHour: '',
  timeEndMinute: '00',

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

const errors = ref([])

let mastersRefreshTimer = null
let scheduleRefreshTimer = null

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

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number)
  return (h * 60) + m
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
    timeStart: '',
    timeEnd: '',
    timeStartHour: '',
    timeStartMinute: '00',
    timeEndHour: '',
    timeEndMinute: '00',

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
  }

  scheduleRows.value = []
  errors.value = []
}

/* ───────────────── EMPLOYEE SEARCH ───────────────── */
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
      message: e?.response?.data?.message || 'Failed to load employee list.',
    })
  } finally {
    loadingEmployees.value = false
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

/* ───────────────── PUBLIC MASTER DATA ───────────────── */
async function loadMasters({ silent = false } = {}) {
  try {
    if (!silent) loadingMasters.value = true

    const [roomRes, materialRes] = await Promise.all([
      api.get('/public/booking-room/rooms/active'),
      api.get('/public/booking-room/materials/active'),
    ])

    activeRooms.value = (Array.isArray(roomRes?.data) ? roomRes.data : []).map((x) => ({
      _id: x?._id || '',
      code: s(x?.code),
      name: s(x?.name),
      isActive: x?.isActive !== false,
    }))

    activeMaterials.value = (Array.isArray(materialRes?.data) ? materialRes.data : []).map((x) => ({
      _id: x?._id || '',
      code: up(x?.code),
      name: s(x?.name),
      totalQty: Math.max(0, Number(x?.totalQty || 0)),
      isActive: x?.isActive !== false,
    }))
  } catch (e) {
    activeRooms.value = []
    activeMaterials.value = []

    showToast({
      type: 'error',
      message: e?.response?.data?.message || 'Failed to load room/material list.',
    })
  } finally {
    if (!silent) loadingMasters.value = false
  }
}

/* ───────────────── SCHEDULE / AVAILABILITY ───────────────── */
async function loadSchedule({ silent = false } = {}) {
  try {
    const date = s(form.value.bookingDate)
    if (!date) {
      scheduleRows.value = []
      return
    }

    const res = await api.get('/public/booking-room/schedule', {
      params: { date },
    })

    scheduleRows.value = Array.isArray(res?.data) ? res.data : []
  } catch (e) {
    if (!silent) {
      showToast({
        type: 'error',
        message: e?.response?.data?.message || 'Failed to load schedule.',
      })
    }
    scheduleRows.value = []
  }
}

/* ───────────────── COMPUTED ───────────────── */
const timeRangeLabel = computed(() => {
  if (!form.value.timeStart || !form.value.timeEnd) return '—'
  return `${form.value.timeStart} - ${form.value.timeEnd}`
})

const selectedMaterialsLabel = computed(() => {
  const rows = Array.isArray(form.value.materials) ? form.value.materials : []
  if (!rows.length) return '—'

  return rows
    .map((x) => {
      const name = s(x?.materialName) || s(x?.materialCode)
      const qty = Math.max(0, Number(x?.qty || 0))
      return name ? `${name}${qty > 0 ? ` x${qty}` : ''}` : ''
    })
    .filter(Boolean)
    .join(', ')
})

const requestTypeLabel = computed(() => {
  if (form.value.roomRequired && form.value.materialRequired) return 'Room + Material'
  if (form.value.roomRequired) return 'Room Only'
  if (form.value.materialRequired) return 'Material Only'
  return '—'
})

/* ───────────────── VALIDATION ───────────────── */
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

  errors.value = e
  return e
}

/* ───────────────── SUBMIT ───────────────── */
async function submit() {
  syncLegacyTimeParts()

  const e = validateForm()
  if (e.length) {
    showToast({
      type: 'warning',
      title: 'Please check the form',
      message: 'Some required fields are missing or invalid.',
    })
    return
  }

  try {
    submitting.value = true

    const payload = {
      employeeId: s(form.value.employeeId),
      bookingDate: s(form.value.bookingDate),
      timeStart: s(form.value.timeStart),
      timeEnd: s(form.value.timeEnd),
      meetingTitle: compactText(form.value.meetingTitle),
      purpose: compactText(form.value.purpose),
      participantEstimate: Number(form.value.participantEstimate || 1),
      requirementNote: compactText(form.value.requirementNote),

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

    await api.post('/public/booking-room', payload)

    showToast({
      type: 'success',
      title: 'Submitted',
      message: 'Your meeting room request has been submitted.',
    })

    resetForm({ keepEmployee: true })

    if (router.hasRoute('public-booking-room-history')) {
      router.push({ name: 'public-booking-room-history' })
    }
  } catch (e) {
    showToast({
      type: 'error',
      title: 'Submit failed',
      message: e?.response?.data?.message || 'Unable to submit request.',
    })
  } finally {
    submitting.value = false
  }
}

/* ───────────────── REALTIME ───────────────── */
function queueMastersRefresh() {
  if (mastersRefreshTimer) clearTimeout(mastersRefreshTimer)
  mastersRefreshTimer = setTimeout(() => {
    loadMasters({ silent: true })
  }, 250)
}

function queueScheduleRefresh() {
  if (scheduleRefreshTimer) clearTimeout(scheduleRefreshTimer)
  scheduleRefreshTimer = setTimeout(() => {
    loadSchedule({ silent: true })
  }, 250)
}

function onRoomMasterChanged() {
  queueMastersRefresh()
}

function onMaterialMasterChanged() {
  queueMastersRefresh()
}

function onMastersChanged() {
  queueMastersRefresh()
}

function onAvailabilityChanged() {
  queueScheduleRefresh()
}

function onReqCreated() {
  queueScheduleRefresh()
}

function onReqUpdated() {
  queueScheduleRefresh()
}

/* ───────────────── INIT ───────────────── */
onMounted(async () => {
  await Promise.all([loadEmployees(), loadMasters()])

  const savedId = localStorage.getItem('bookingRoomEmployeeId') || ''
  if (savedId) {
    const found = employees.value.find((x) => s(x.employeeId) === s(savedId))
    if (found) selectEmployee(found)
  }

  await loadSchedule()

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
  if (mastersRefreshTimer) {
    clearTimeout(mastersRefreshTimer)
    mastersRefreshTimer = null
  }
  if (scheduleRefreshTimer) {
    clearTimeout(scheduleRefreshTimer)
    scheduleRefreshTimer = null
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
        <!-- HERO -->
        <div class="ui-hero-gradient">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div class="text-sm font-extrabold">Meeting Room Booking</div>
            </div>

            <div class="flex gap-2">
              <button
                class="ui-btn ui-btn-primary"
                type="button"
                :disabled="submitting || loadingMasters"
                @click="submit"
              >
                <i v-if="submitting" class="fa-solid fa-spinner animate-spin text-[11px]" />
                Submit Request
              </button>
            </div>
          </div>
        </div>

        <!-- BODY -->
        <div class="space-y-3 p-3">
          <!-- Errors -->
          <div
            v-if="errors.length"
            class="rounded-xl border border-rose-300 bg-rose-50 p-3 text-[11px] text-rose-700 dark:border-rose-700/70 dark:bg-rose-950/30 dark:text-rose-200"
          >
            <div class="mb-1 font-extrabold">Please check the following:</div>
            <ul class="list-disc space-y-0.5 pl-4">
              <li v-for="(e, idx) in errors" :key="idx">{{ e }}</li>
            </ul>
          </div>

          <!-- Row 1: Requester + Booking Detail -->
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
                :schedule-rows="scheduleRows"
                :time-range-label="timeRangeLabel"
                @load-schedule="loadSchedule"
              />
            </div>
          </div>

          <!-- Row 2: Request Type only -->
          <div>
            <BookingRoomRequestTypeSection
              :form="form"
              :BOOKING_ROOM_NAMES="activeRooms"
              :BOOKING_ROOM_MATERIALS="activeMaterials"
            />
          </div>

          <!-- FOOT -->
          <div class="flex items-center justify-between gap-3 border-t border-slate-200 pt-3 text-[11px] dark:border-slate-800">
            <div class="text-slate-500 dark:text-slate-400">
              Please review requester, booking detail, and request type before submitting.
            </div>
            <div class="flex gap-2">
              <button
                class="ui-btn ui-btn-primary"
                type="button"
                :disabled="submitting || loadingMasters"
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