<!-- src/views/bookingRoom/user/PublicBookingRoomRequest.vue -->
<script setup>
import { ref, computed, onMounted } from 'vue'
import dayjs from 'dayjs'
import { useRouter } from 'vue-router'
import { useToast } from '@/composables/useToast'

import {
  BOOKING_ROOM_NAMES,
  BOOKING_ROOM_MATERIALS,
  searchBookingRoomEmployees,
  createBookingRoom,
  getBookingRoomSchedule,
} from '@/utils/bookingRoom.api'

import BookingRoomRequesterSection from './sections/BookingRoomRequesterSection.vue'
import BookingRoomDetailSection from './sections/BookingRoomDetailSection.vue'
import BookingRoomRequestTypeSection from './sections/BookingRoomRequestTypeSection.vue'

defineOptions({ name: 'PublicBookingRoomRequest' })

const router = useRouter()
const { showToast } = useToast()

/* ───────────────── STATE ───────────────── */
const loadingEmployees = ref(false)
const submitting = ref(false)

const employees = ref([])
const selectedEmployee = ref(null)

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
  roomName: '',

  materialRequired: false,
  materials: [],
})

const errors = ref([])

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

function materialText(arr = []) {
  return Array.isArray(arr) && arr.length ? arr.join(', ') : '—'
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
    roomName: '',

    materialRequired: false,
    materials: [],
  }

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

/* ───────────────── FORM CHIPS ───────────────── */
function toggleMaterial(material) {
  const key = up(material)
  const arr = Array.isArray(form.value.materials) ? [...form.value.materials] : []
  const idx = arr.findIndex((x) => up(x) === key)

  if (idx >= 0) arr.splice(idx, 1)
  else arr.push(key)

  form.value.materials = ['PROJECTOR', 'TV'].filter((x) => arr.includes(x))
}

function isMaterialOn(material) {
  return (form.value.materials || []).some((x) => up(x) === up(material))
}

/* ───────────────── COMPUTED ───────────────── */
const timeRangeLabel = computed(() => {
  if (!form.value.timeStart || !form.value.timeEnd) return '—'
  return `${form.value.timeStart} - ${form.value.timeEnd}`
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

  if (f.roomRequired && !s(f.roomName)) {
    e.push('Please select a meeting room.')
  }

  if (f.materialRequired && !(Array.isArray(f.materials) && f.materials.length)) {
    e.push('Please choose at least one material.')
  }

  if (!compactText(f.meetingTitle)) e.push('Meeting title is required.')
  errors.value = e
  return e
}

/* ───────────────── SUBMIT ───────────────── */
async function submit() {
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
      participantEstimate: Number(form.value.participantEstimate || 1),
      requirementNote: compactText(form.value.requirementNote),
      roomRequired: !!form.value.roomRequired,
      roomName: form.value.roomRequired ? s(form.value.roomName) : '',
      materialRequired: !!form.value.materialRequired,
      materials: form.value.materialRequired ? form.value.materials : [],
    }

    await createBookingRoom(payload)

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

/* ───────────────── INIT ───────────────── */
onMounted(async () => {
  await loadEmployees()

  const savedId = localStorage.getItem('bookingRoomEmployeeId') || ''
  if (savedId) {
    const found = employees.value.find((x) => s(x.employeeId) === s(savedId))
    if (found) selectEmployee(found)
  }
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
                class="ui-btn ui-btn-soft border-white/25 bg-white/10 text-white"
                type="button"
                :disabled="submitting"
                @click="resetForm()"
              >
                <i class="fa-solid fa-rotate-left text-[11px]" />
                Reset
              </button>

              <button
                class="ui-btn ui-btn-primary"
                type="button"
                :disabled="submitting"
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
                @load-schedule="loadSchedule"
              />
            </div>
          </div>

          <!-- Row 2: Request Type only -->
          <div>
            <BookingRoomRequestTypeSection
              :form="form"
              :BOOKING_ROOM_NAMES="BOOKING_ROOM_NAMES"
              :BOOKING_ROOM_MATERIALS="BOOKING_ROOM_MATERIALS"
              :is-material-on="isMaterialOn"
              :material-text="materialText"
              @toggle-material="toggleMaterial"
            />
          </div>

          <!-- FOOT -->
          <div class="flex items-center justify-between gap-3 border-t border-slate-200 pt-3 text-[11px] dark:border-slate-800">
            <div class="text-slate-500 dark:text-slate-400">
              Please review requester, booking detail, and request type before submitting.
            </div>

            <div class="flex gap-2">
              <button
                class="ui-btn ui-btn-soft"
                type="button"
                :disabled="submitting"
                @click="resetForm()"
              >
                <i class="fa-solid fa-rotate-left text-[11px]" />
                Reset
              </button>

              <button
                class="ui-btn ui-btn-primary"
                type="button"
                :disabled="submitting"
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