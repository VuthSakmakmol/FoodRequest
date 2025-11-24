<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import Swal from 'sweetalert2'
import dayjs from 'dayjs'
import api from '@/utils/api'
import socket from '@/utils/socket'
import { useRouter, useRoute } from 'vue-router'   // ✅ useRoute added

/* ───────── Router ───────── */
const router = useRouter()
const route = useRoute()
const DEBUG = true

/* ───────── Sections ───────── */
import RequesterSection from './sections/RequesterSection.vue'
import TripDetailSection from './sections/TripDetailSection.vue'
import PurposeSection from './sections/PurposeSection.vue'
import RecurringBookingSection from './sections/RecurringBookingSection.vue'

/* ───────── Constants ───────── */
const CATEGORY = ['Car', 'Messenger']
const LOCATIONS = [
  'Airport',
  'DAMCO',
  'KN (WH)',
  'CARGOPORT ( OFFICE )',
  'Khai Nam',
  'DB ( OFFICE )',
  'BS',
  'Techo International Airport',
  'Buy SIM card ( Phone )',
  'KN  (OFFICE)',
  'CIMB Bank',
  'Sixplus Factory',
  'XOTEX',
  'IFB ( OFFICE )',
  'DHL',
  'HORIZON',
  'Bangkok Bank',
  'DSV (OFFICE)',
  'ABA Bank',
  'DAMCO (WH)',
  'DAMCO (OFFICE)',
  'KN ( WH)',
  'DSV  (WH)',
  'DB Schenker',
  'CARGOPORT',
  'SCAN GLOBAL',
  'Hong leong hour (WH)',
  'So Nguon (WH)',
  'Khainam Bus',
  'Acleda Bank',
  'Kerry',
  'Olair dry port',
  'Avery',
  'JGL Worldwide',
  'PTT 271',
  'Dyeing Company',
  'S E C Mega factory  CO., LTD',
  
]
const PURPOSES = ['Bring Customer', 'Pick up Customer', 'Meeting', 'Check quality in subcon']
const PASSENGER_OPTIONS = Array.from({ length: 15 }, (_, i) => String(i + 1))
const MAX_CAR = 3
const MAX_MSGR = 1

/* ───────── Employees ───────── */
const employees = ref([])
const loadingEmployees = ref(false)

async function loadEmployees() {
  loadingEmployees.value = true
  try {
    const { data } = await api.get('/public/employees', { params: { activeOnly: true } })
    employees.value = (Array.isArray(data) ? data : []).map(e => ({
      employeeId: String(e.employeeId || ''),
      name: String(e.name || ''),
      department: String(e.department || ''),
      contactNumber: String(e.contactNumber || ''),
      isActive: !!e.isActive
    }))
    const savedId = localStorage.getItem('employeeId') || ''
    if (savedId && !form.value.employeeId) {
      const exists = employees.value.some(e => String(e.employeeId) === String(savedId))
      if (exists) {
        form.value.employeeId = savedId
        onEmployeeSelected(savedId)
      }
    } else if (form.value.employeeId) {
      onEmployeeSelected(form.value.employeeId)
    }
  } catch (e) {
    console.error('Failed to load employees', e)
  } finally {
    loadingEmployees.value = false
  }
}
loadEmployees()

function onEmployeeSelected(val) {
  const emp = employees.value.find(e => String(e.employeeId) === String(val))
  if (DEBUG) console.log('👆 selected id:', val, '→ emp:', emp)
  form.value.name = emp?.name || ''
  form.value.department = emp?.department || ''
  form.value.contactNumber = emp?.contactNumber || ''
}

/* ───────── Form State ───────── */
const form = ref({
  employeeId: '',
  name: '',
  department: '',
  contactNumber: '',

  category: 'Car',
  tripDate: dayjs().format('YYYY-MM-DD'),
  stops: [{ destination: '', destinationOther: '', mapLink: '' }],

  startHour: '', startMinute: '',
  endHour: '', endMinute: '',
  passengers: '1',
  customerContact: '',

  purpose: '',
  notes: '',
  ticketFile: null,

  recurring: false,
  frequency: '',
  endDate: '',
  skipHolidays: false,
  timeStart: ''
})

/* ───────── Helpers (demo capacity) ───────── */
const demoBookings = ref([
  { date: dayjs().format('YYYY-MM-DD'), category: 'Car',       start: '07:00', end: '09:00' },
  { date: dayjs().format('YYYY-MM-DD'), category: 'Messenger', start: '08:00', end: '10:00' }
])

function toMinutes(h, m) {
  const H = Number(h || 0)
  const M = Number(m || 0)
  return H * 60 + M
}
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd
}

const selectedStart = computed(() => toMinutes(form.value.startHour, form.value.startMinute))
const selectedEnd   = computed(() => toMinutes(form.value.endHour, form.value.endMinute))

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

const availableCar = computed(() => Math.max(0, MAX_CAR - busyCar.value))
const availableMsgr = computed(() => Math.max(0, MAX_MSGR - busyMsgr.value))
const capacityExceeded = computed(() => {
  if (!selectedStart.value || !selectedEnd.value) return false
  if (form.value.category === 'Car')       return availableCar.value <= 0
  if (form.value.category === 'Messenger') return availableMsgr.value <= 0
  return false
})

/* ───────── Validation ───────── */
const hasAirport = computed(() => (form.value.stops || []).some(s => s.destination === 'Airport'))
const startTime = computed(() =>
  form.value.startHour && form.value.startMinute ? `${form.value.startHour}:${form.value.startMinute}` : ''
)
const endTime = computed(() =>
  form.value.endHour && form.value.endMinute ? `${form.value.endHour}:${form.value.endMinute}` : ''
)

function validateForm() {
  const f = form.value
  const errs = []
  if (!f.employeeId) errs.push('• Employee is required')
  if (!f.category) errs.push('• Category is required')
  if (!f.tripDate) errs.push('• Date is required')
  if (!f.stops?.length) errs.push('• At least one destination is required')
  f.stops.forEach((s, idx) => {
    if (!s.destination) errs.push(`• Destination #${idx + 1} is required`)
    if (s.destination === 'Other' && !s.destinationOther)
      errs.push(`• Destination #${idx + 1}: Please enter Destination Name`)
  })
  if (!startTime.value) errs.push('• Start time is required')
  if (!endTime.value) errs.push('• End time is required')
  if (startTime.value && endTime.value && endTime.value <= startTime.value)
    errs.push('• End time must be after Start')
  if (!f.passengers) errs.push('• Number of passengers is required')
  if (!f.purpose) errs.push('• Purpose is required')
  if (hasAirport.value && !f.ticketFile) errs.push('• Please attach the airplane ticket (required for Airport)')
  if (capacityExceeded.value) {
    const kind = f.category === 'Car' ? 'car' : 'messenger'
    errs.push(`• No ${kind} available for the selected time window.`)
  }
  return errs
}

/* ───────── Payload Builders ───────── */
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
    endDate: f.endDate,
    timeStart: f.timeStart || startTime.value,
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

/* ───────── Submit Logic ───────── */
const loading = ref(false)

async function submit() {
  const errs = validateForm()
  if (errs.length) {
    await Swal.fire({ icon: 'warning', title: 'Please fix the following', html: errs.join('<br>') })
    return
  }
  try {
    loading.value = true
    if (form.value.recurring) {
      const seriesPayload = buildRecurringSeriesPayload(form.value)
      const { data } = await api.post('/transport/recurring', seriesPayload)
      await Swal.fire({
        icon: 'success',
        title: 'Recurring series created',
        html: `Created <b>${data.created}</b>, skipped <b>${(data.skipped || []).length}</b>.`,
        timer: 1800, showConfirmButton: false
      })
      resetForm({ keepEmployee: true })
      router.push({ name: 'employee-car-history' })
      return
    }

    const payload = buildOneOffPayload(form.value)
    const needsTicket = (form.value.stops || []).some(s => s.destination === 'Airport')
    if (needsTicket) {
      const fd = new FormData()
      fd.append('data', JSON.stringify(payload))
      const file = form.value.ticketFile
      if (!file) throw new Error('Airplane ticket is required.')
      fd.append('ticket', file)
      await api.post('/public/car-bookings', fd)
    } else {
      await api.post('/public/car-bookings', payload)
    }

    await Swal.fire({ icon: 'success', title: 'Submitted', timer: 1400, showConfirmButton: false })
    resetForm({ keepEmployee: true })
    router.push({ name: 'employee-car-history' })
  } catch (e) {
    const msg = e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Submission failed.'
    await Swal.fire({ icon: 'error', title: 'Failed', text: msg })
  } finally {
    loading.value = false
  }
}

/* ───────── Reset ───────── */
function resetForm({ keepEmployee = false } = {}) {
  const cur = {
    id: form.value.employeeId,
    name: form.value.name,
    dept: form.value.department,
    phone: form.value.contactNumber
  }
  form.value = {
    employeeId: keepEmployee ? cur.id : '',
    name: keepEmployee ? cur.name : '',
    department: keepEmployee ? cur.dept : '',
    contactNumber: keepEmployee ? cur.phone : '',
    category: 'Car',
    tripDate: dayjs().format('YYYY-MM-DD'),
    stops: [{ destination: '', destinationOther: '', mapLink: '' }],
    startHour: '', startMinute: '', endHour: '', endMinute: '',
    passengers: '1', customerContact: '', purpose: '', notes: '', ticketFile: null,
    recurring: false, frequency: '', endDate: '', skipHolidays: false, timeStart: ''
  }
}

/* ───────── Mounted: handle ?tripDate= ───────── */
onMounted(() => {
  if (route.query.tripDate) {
    form.value.tripDate = route.query.tripDate
    Swal.fire({
      icon: 'info',
      title: 'Booking Date Loaded',
      text: `Date automatically set to ${route.query.tripDate}`,
      timer: 1500,
      showConfirmButton: false
    })
  }
})

/* ───────── Watchers ───────── */
watch(() => form.value.employeeId, v => { if (v) localStorage.setItem('employeeId', v) })
</script>

<template>
  <v-container fluid class="pa-2 book-container">
    <v-card class="rounded-lg slim-card" elevation="1">
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
              />
            </v-col>

            <v-col cols="12" md="3" class="sticky-col">
              <PurposeSection
                :form="form"
                :PURPOSES="PURPOSES"
                :LOCATIONS="LOCATIONS"
              />
            </v-col>

            <v-col cols="12">
              <RecurringBookingSection :form="form" />
            </v-col>
          </v-row>
        </v-form>
      </v-card-text>

      <v-toolbar flat density="compact" class="px-3 py-1 slim-toolbar">
        <v-btn :loading="loading" size="small" class="px-4 ml-1" color="primary" @click="submit">
          <v-icon start>mdi-send</v-icon> Submit
        </v-btn>

        <v-btn variant="text" size="small" class="ml-1" color="error" :disabled="loading" @click="resetForm()">
          <v-icon start>mdi-refresh</v-icon> Reset
        </v-btn>
      </v-toolbar>
    </v-card>
  </v-container>
</template>

<style scoped>
.slim-card {
  border: 1px solid rgba(100,116,139,.16);
  border-radius: 14px;
}
.slim-toolbar {
  background: linear-gradient(90deg, rgba(99,102,241,.06), rgba(16,185,129,.05));
  border-bottom-left-radius: 14px;
  border-bottom-right-radius: 14px;
}
.sticky-col { align-self: flex-start; }

/* Slightly tighter inner padding overall */
:deep(.slim-card > .v-card-text) {
  padding-top: 10px;
  padding-bottom: 8px;
}

/* 📱 Mobile: remove borders, full-width to phone edge, tighter paddings */
@media (max-width: 600px) {
  .book-container {
    padding: 0 !important;          /* kill v-container padding */
  }

  .slim-card {
    border: none;
    border-radius: 0;
  }

  .slim-toolbar {
    border-radius: 0;
    padding-left: 8px !important;
    padding-right: 8px !important;
  }

  :deep(.slim-card > .v-card-text) {
    padding: 8px 8px 6px;
  }
}
</style>
