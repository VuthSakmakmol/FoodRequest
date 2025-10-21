<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import Swal from 'sweetalert2'
import dayjs from 'dayjs'
import api from '@/utils/api'
import socket from '@/utils/socket'
import { useRouter } from 'vue-router'

const DEBUG = true
const router = useRouter()

/* Sections */
import RequesterSection from './sections/RequesterSection.vue'
import TripDetailSection from './sections/TripDetailSection.vue'
import VehicleSection from './sections/VehicleSection.vue'
import RecurringBookingSection from './sections/RecurringBookingSection.vue'

/* Calendar dialog */
import TransportScheduleCalendar from './calendars/TransportScheduleCalendar.vue'
const showSchedule = ref(false)
const scheduleDate = ref(dayjs().format('YYYY-MM-DD'))

/* Constants */
const CATEGORY = ['Car','Messenger']
const LOCATIONS = ['Airport','DAMCO (WH)','BS Printing','YMG','CIMB Bank (Tuek Thla)','Jtrust Bank','Yanlord','Other']
const PURPOSES = ['Bring Customer','Pick up Customer','Meeting','Check quality in subcon']
const PASSENGER_OPTIONS = Array.from({length: 15}, (_,i)=> String(i+1))

/* Capacity rules */
const MAX_CAR = 3
const MAX_MSGR = 1

/* Directory */
const employees = ref([])
const loadingEmployees = ref(false)

/* ───────── form state ───────── */
const form = ref({
  employeeId: '',
  name: '',
  department: '',
  contactNumber: '',

  category: 'Car',
  tripDate: dayjs().format('YYYY-MM-DD'),

  stops: [ { destination: '', destinationOther: '', mapLink: '' } ],

  startHour: '', startMinute: '',
  endHour:   '', endMinute:   '',

  passengers: '1',
  customerContact: '',

  purpose: '',
  notes: '',

  ticketFile: null,

  recurring: false, frequency: '', endDate: '', skipHolidays: false,
  // timeStart for recurring preview UI (kept in RecurringBookingSection)
  timeStart: ''
})

const loading = ref(false)
const success = ref('')
const error = ref('')

/* Demo availability (frontend only) */
const demoBookings = ref([
  { date: dayjs().format('YYYY-MM-DD'), category: 'Car',       start: '07:00', end: '09:00' },
  { date: dayjs().format('YYYY-MM-DD'), category: 'Messenger', start: '08:00', end: '10:00' }
])

/* Load employees */
async function loadEmployees() {
  loadingEmployees.value = true
  try {
    const { data } = await api.get('/public/employees', { params: { activeOnly: true } })
    employees.value = (Array.isArray(data) ? data : []).map(e => ({
      employeeId: String(e.employeeId || ''),
      name: String(e.name || ''),
      department: String(e.department || ''),
      contactNumber: String(e.contactNumber || ''),
      isActive: !!e.isActive,
    }))
    const savedId = localStorage.getItem('employeeId') || ''
    if (savedId && !form.value.employeeId) {
      const exists = employees.value.some(e => String(e.employeeId) === String(savedId))
      if (exists) { form.value.employeeId = savedId; onEmployeeSelected(savedId) }
    } else if (form.value.employeeId) {
      onEmployeeSelected(form.value.employeeId)
    }
  } catch (e) {
    console.error('Failed to load employees', e)
  } finally { loadingEmployees.value = false }
}
loadEmployees()

function onEmployeeSelected(val) {
  const emp = employees.value.find(e => String(e.employeeId) === String(val))
  if (DEBUG) console.log('👆 selected id:', val, '→ emp:', emp)
  form.value.name = emp?.name || ''
  form.value.department = emp?.department || ''
  form.value.contactNumber = emp?.contactNumber || ''
}

/* time helpers + availability */
const selectedStart = computed(() => toMinutes(form.value.startHour, form.value.startMinute))
const selectedEnd   = computed(() => toMinutes(form.value.endHour,   form.value.endMinute))
function toMinutes(h, m){ const H=Number(h||0), M=Number(m||0); return H*60+M }
function overlaps(aStart, aEnd, bStart, bEnd){ return aStart < bEnd && bStart < aEnd }

const busyCar = computed(() => {
  if (!form.value.tripDate || !selectedStart.value || !selectedEnd.value) return 0
  return demoBookings.value.filter(b =>
    b.date === form.value.tripDate &&
    b.category === 'Car' &&
    overlaps(selectedStart.value, selectedEnd.value, toMinutes(...b.start.split(':')), toMinutes(...b.end.split(':')))
  ).length
})
const busyMsgr = computed(() => {
  if (!form.value.tripDate || !selectedStart.value || !selectedEnd.value) return 0
  return demoBookings.value.filter(b =>
    b.date === form.value.tripDate &&
    b.category === 'Messenger' &&
    overlaps(selectedStart.value, selectedEnd.value, toMinutes(...b.start.split(':')), toMinutes(...b.end.split(':')))
  ).length
})
const availableCar  = computed(() => Math.max(0, MAX_CAR  - busyCar.value))
const availableMsgr = computed(() => Math.max(0, MAX_MSGR - busyMsgr.value))
const capacityExceeded = computed(() => {
  if (!selectedStart.value || !selectedEnd.value) return false
  if (form.value.category === 'Car')       return availableCar.value  <= 0
  if (form.value.category === 'Messenger') return availableMsgr.value <= 0
  return false
})

/* validation + payload */
const hasAirport = computed(() => (form.value.stops || []).some(s => s.destination === 'Airport'))
const startTime = computed(() => form.value.startHour && form.value.startMinute ? `${form.value.startHour}:${form.value.startMinute}` : '')
const endTime   = computed(() => form.value.endHour   && form.value.endMinute   ? `${form.value.endHour}:${form.value.endMinute}`   : '')

function validateForm() {
  const f = form.value
  const errs = []
  if (!f.employeeId) errs.push('• Employee is required')
  if (!f.category) errs.push('• Category is required')
  if (!f.tripDate) errs.push('• Date is required')

  if (!f.stops?.length) errs.push('• At least one destination is required')
  f.stops.forEach((s, idx) => {
    if (!s.destination) errs.push(`• Destination #${idx+1} is required`)
    if (s.destination === 'Other' && !s.destinationOther) errs.push(`• Destination #${idx+1}: Please enter Destination Name`)
  })

  if (!startTime.value) errs.push('• Start time is required')
  if (!endTime.value) errs.push('• End time is required')
  if (startTime.value && endTime.value && endTime.value <= startTime.value) errs.push('• End time must be after Start')

  if (!f.passengers) errs.push('• Number of passengers is required')
  if (!f.purpose) errs.push('• Purpose is required')
  if (hasAirport.value && !f.ticketFile) errs.push('• Please attach the airplane ticket (required for Airport)')

  if (capacityExceeded.value) {
    const kind = f.category === 'Car' ? 'car' : 'messenger'
    errs.push(`• No ${kind} available for the selected time window. Try a different time or contact Admin.`)
  }
  return errs
}

function buildOneOffPayload(f) {
  return {
    employeeId: f.employeeId,
    category: f.category,
    tripDate: f.tripDate,
    stops: (f.stops || []).map(s => ({
      destination: s.destination,
      destinationOther: s.destination === 'Other' ? (s.destinationOther || '') : '',
      mapLink: s.mapLink || ''
    })),
    timeStart: startTime.value || null,
    timeEnd: endTime.value || null,
    passengers: Number(f.passengers || 1),
    customerContact: f.customerContact || '',
    purpose: f.purpose,
    notes: f.notes || ''
  }
}

function buildRecurringSeriesPayload(f) {
  return {
    category: f.category,
    startDate: f.tripDate,
    endDate: f.endDate,                 // set by RecurringBookingSection
    timeStart: f.timeStart || startTime.value, // prefer section’s HH:mm if set
    timeEnd: endTime.value,
    timezone: 'Asia/Phnom_Penh',
    skipHolidays: !!f.skipHolidays,
    passengers: Number(f.passengers || 1),
    customerContact: f.customerContact || '',
    stops: (f.stops || []).map(s => ({
      destination: s.destination,
      destinationOther: s.destination === 'Other' ? (s.destinationOther || '') : '',
      mapLink: s.mapLink || ''
    })),
    purpose: f.purpose || '',
    notes: f.notes || '',
    createdByEmp: {
    employeeId: String(f.employeeId || ''),
    name: f.name || '',
    department: f.department || '',
    contactNumber: f.contactNumber || ''
    }
  }
}

/* submit/reset */
async function submit() {
  error.value = ''; success.value = ''

  const errs = validateForm()
  if (errs.length) {
    await Swal.fire({ icon:'warning', title:'Please fix the following', html: errs.join('<br>') })
    return
  }

  try {
    loading.value = true

    // RECURRING path
    if (form.value.recurring) {
      const seriesPayload = buildRecurringSeriesPayload(form.value)
      const { data } = await api.post('/transport/recurring', seriesPayload) // baseURL already has /api
      if (!data?.ok) throw new Error(data?.error || 'Failed to create recurring series')
      await Swal.fire({
        icon:'success',
        title:'Recurring series created',
        html:`Created <b>${data.created}</b>, skipped <b>${(data.skipped||[]).length}</b>.`,
        timer:1700, showConfirmButton:false
      })
      resetForm({ keepEmployee: true })
      router.push({ name: 'employee-car-history' })
      return
    }

    // ONE-OFF path
    const payload = buildOneOffPayload(form.value)
    const needsTicket = (form.value.stops || []).some(s => s.destination === 'Airport')
    if (needsTicket) {
      const fd = new FormData()
      fd.append('data', JSON.stringify(payload))
      const file = form.value.ticketFile
      if (!file) throw new Error('Airplane ticket is required for Airport destination.')
      fd.append('ticket', file)
      await api.post('/public/car-bookings', fd)
    } else {
      await api.post('/public/car-bookings', payload)
    }

    await Swal.fire({ icon:'success', title:'Submitted', timer:1400, showConfirmButton:false })
    resetForm({ keepEmployee: true })
    router.push({ name: 'employee-car-history' })
  } catch (e) {
    const msg = e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Submission failed.'
    error.value = msg
    await Swal.fire({ icon:'error', title:'Submission failed', text: msg })
  } finally {
    loading.value = false
  }
}

function resetForm({ keepEmployee = false } = {}) {
  const cur = { id: form.value.employeeId, name: form.value.name, dept: form.value.department, phone: form.value.contactNumber }
  form.value = {
    employeeId: keepEmployee ? cur.id : '',
    name: keepEmployee ? cur.name : '',
    department: keepEmployee ? cur.dept : '',
    contactNumber: keepEmployee ? cur.phone : '',

    category: 'Car',
    tripDate: dayjs().format('YYYY-MM-DD'),
    stops: [ { destination: '', destinationOther: '', mapLink: '' } ],

    startHour:'', startMinute:'', endHour:'', endMinute:'',

    passengers:'1',
    customerContact:'',

    purpose:'', notes:'', ticketFile: null,

    recurring:false, frequency:'', endDate:'', skipHolidays:false,
    timeStart:''
  }
}

/* misc */
watch(() => form.value.employeeId, v => { if (v) localStorage.setItem('employeeId', v) })

onMounted(() => {
  socket.on('carBooking:created', (doc) => {
    const empId = doc?.employee?.employeeId || doc?.employeeId
    if (empId && empId === (form.value.employeeId || localStorage.getItem('employeeId'))) {
      if (!success.value) Swal.fire({ toast:true, icon:'success', title:'Booking received', timer:1500, position:'top', showConfirmButton:false })
    }
  })
  window.addEventListener('keydown', onHotkey)
})
onBeforeUnmount(() => {
  socket.off('carBooking:created')
  window.removeEventListener('keydown', onHotkey)
})
function onHotkey(e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !loading.value) submit() }

function openSchedule() {
  scheduleDate.value = form.value.tripDate || dayjs().format('YYYY-MM-DD')
  showSchedule.value = true
}
</script>

<template>
  <v-container fluid class="pa-2">
    <v-card class="rounded-lg slim-card" elevation="1">
      <v-alert v-if="error" type="error" class="mx-2 mt-2" density="compact" variant="tonal" border="start">{{ error }}</v-alert>
      <v-alert v-if="success" type="success" class="mx-2 mt-2" density="compact" variant="tonal" border="start">{{ success }}</v-alert>
      <v-divider class="my-1" />

      <v-card-text class="pa-3">
        <v-form @submit.prevent="submit">
          <v-row dense>
            <v-col cols="12" md="4">
              <RequesterSection
                :form="form"
                :employees="employees"
                :loading-employees="loadingEmployees"
                @updateEmployee="onEmployeeSelected"
              />
            </v-col>

            <v-col cols="12" md="5">
              <TripDetailSection
                :form="form"
                :CATEGORY="CATEGORY"
                :LOCATIONS="LOCATIONS"
                :PASSENGER_OPTIONS="PASSENGER_OPTIONS"
                :MAX_CAR="MAX_CAR"
                :MAX_MSGR="MAX_MSGR"
                :busyCar="busyCar"
                :busyMsgr="busyMsgr"
                :availableCar="availableCar"
                :availableMsgr="availableMsgr"
                :capacityExceeded="capacityExceeded"
              />
            </v-col>

            <v-col cols="12" md="3" class="sticky-col">
              <VehicleSection :form="form" :PURPOSES="PURPOSES" />
            </v-col>

            <v-col cols="12">
              <RecurringBookingSection :form="form" />
            </v-col>
          </v-row>
        </v-form>
      </v-card-text>

      <v-toolbar flat density="compact" class="px-3 py-1 slim-toolbar">
        <v-toolbar-title class="text-subtitle-1 font-weight-bold">Employee Car / Messenger Booking</v-toolbar-title>
        <v-spacer />

        <v-btn size="small" variant="outlined" class="mr-2" @click="openSchedule">Vue Schedule</v-btn>

        <v-btn :loading="loading" size="small" class="px-4" @click="submit" :disabled="capacityExceeded" style="background-color:aqua;">
          Submit
        </v-btn>
        <v-btn variant="text" size="small" class="ml-1" :disabled="loading" @click="resetForm()" style="background-color:red;">
          Reset
        </v-btn>
      </v-toolbar>

      <v-dialog v-model="showSchedule" max-width="1200">
        <v-card class="rounded-lg">
          <v-toolbar flat density="comfortable">
            <v-toolbar-title class="font-weight-bold">Transport Schedule</v-toolbar-title>
            <v-spacer />
            <v-btn icon variant="text" @click="showSchedule = false"><v-icon>mdi-close</v-icon></v-btn>
          </v-toolbar>
          <v-divider />
          <v-card-text class="pa-3">
            <TransportScheduleCalendar
              v-model="scheduleDate"
              :max-car="MAX_CAR"
              :max-msgr="MAX_MSGR"
              start-hour="06"
              end-hour="22"
              :minute-step="30"
            />
          </v-card-text>
        </v-card>
      </v-dialog>
    </v-card>
  </v-container>
</template>

<style scoped>
.slim-card { border: 1px solid rgba(100,116,139,.16); }
.slim-toolbar { background: linear-gradient(90deg, rgba(99,102,241,.06), rgba(16,185,129,.05)); }
.section { background: #f7f8fb; border: 1px dashed rgba(100,116,139,.25); }
.hdr { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
.hdr .t { font-weight: 600; font-size: .95rem; }
.n { width:18px; height:18px; border-radius:999px; display:inline-flex; align-items:center; justify-content:center; background:#6b7280; color:#fff; font-size:11px; font-weight:700; }
:deep(.v-input){ margin-bottom:6px !important; }
:deep(.v-field__input){ padding-top:6px; padding-bottom:6px; }
.sticky-col { align-self:flex-start; }
:deep(.v-dialog > .v-overlay__content) { width: 96%; }
</style>
