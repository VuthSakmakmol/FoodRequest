<!-- src/employee/carbooking/EmployeeCarBooking.vue -->
<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useRouter, useRoute } from 'vue-router'
import { useToast } from '@/composables/useToast'

/* ───────── Router / Toast ───────── */
const router = useRouter()
const route = useRoute()
const { showToast } = useToast()
const DEBUG = true

/* ───────── Sections ───────── */
/* ───────── Sections ───────── */
import RequesterSection from './sections/RequesterSection.vue'
import TripDetailSection from './sections/TripDetailSection.vue'
import PurposeSection from './sections/PurposeSection.vue'
import RecurringBookingSection from './sections/RecurringBookingSection.vue'

/* ───────── Constants ───────── */
const CATEGORY = ['Car', 'Messenger']
const AIRPORT_DESTINATION = 'Techo International Airport'
const LOCATIONS = [
  'Techo International Airport',
  'DAMCO',
  'KN (WH)',
  'CARGOPORT ( OFFICE )',
  'Khai Nam',
  'DB ( OFFICE )',
  'BS',
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
const PURPOSES = [
  'Bring & Pick up',
  'Bring Customer',
  'Pick up Customer',
  'Meeting',
  'Check quality in subcon',
  'Release Document',
  'Submit payment',
  'Collect doc back',
  'Revise Document',
  'Send the fabric',
  'Pick  parcel',
  'Bring binding tape',
  'Pick up Accessory',
  'Pay for NSSF',
  'Withdraw',
  'Send Document TT',
  'Pick up SGS inspector'
]
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
    showToast({
      type: 'error',
      title: 'Load failed',
      message: 'Unable to load employees list.',
    })
  } finally {
    loadingEmployees.value = false
  }
}

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
    overlaps(
      selectedStart.value,
      selectedEnd.value,
      toMinutes(...b.start.split(':')),
      toMinutes(...b.end.split(':'))
    )
  ).length
})

const busyMsgr = computed(() => {
  if (!form.value.tripDate || !selectedStart.value || !selectedEnd.value) return 0
  return demoBookings.value.filter(b =>
    b.date === form.value.tripDate &&
    b.category === 'Messenger' &&
    overlaps(
      selectedStart.value,
      selectedEnd.value,
      toMinutes(...b.start.split(':')),
      toMinutes(...b.end.split(':'))
    )
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
const hasAirport = computed(() =>
  (form.value.stops || []).some(s => s.destination === AIRPORT_DESTINATION)
)
const startTime = computed(() =>
  form.value.startHour && form.value.startMinute ? `${form.value.startHour}:${form.value.startMinute}` : ''
)
const endTime = computed(() =>
  form.value.endHour && form.value.endMinute ? `${form.value.endHour}:${form.value.endMinute}` : ''
)

const validationErrors = ref([])

function validateForm() {
  const f = form.value
  const errs = []
  if (!f.employeeId) errs.push('Employee is required.')
  if (!f.category) errs.push('Category is required.')
  if (!f.tripDate) errs.push('Date is required.')
  if (!f.stops?.length) errs.push('At least one destination is required.')
  f.stops.forEach((s, idx) => {
    if (!s.destination) errs.push(`Destination #${idx + 1} is required.`)
    if (s.destination === 'Other' && !s.destinationOther)
      errs.push(`Destination #${idx + 1}: please enter destination name.`)
  })
  if (!startTime.value) errs.push('Start time is required.')
  if (!endTime.value) errs.push('End time is required.')
  if (startTime.value && endTime.value && endTime.value <= startTime.value)
    errs.push('End time must be after start time.')
  if (!f.passengers) errs.push('Number of passengers is required.')
  if (!f.purpose) errs.push('Purpose is required.')
  if (hasAirport.value && !f.ticketFile) errs.push('Please attach the airplane ticket (required for airport).')
  if (capacityExceeded.value) {
    const kind = f.category === 'Car' ? 'car' : 'messenger'
    errs.push(`No ${kind} available for the selected time window.`)
  }
  validationErrors.value = errs
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
    showToast({
      type: 'warning',
      title: 'Please review your form',
      message: 'Some required information is missing or invalid.',
    })
    return
  }

  try {
    loading.value = true

    // ───── Recurring ─────
    if (form.value.recurring) {
      const seriesPayload = buildRecurringSeriesPayload(form.value)
      const { data } = await api.post('/transport/recurring', seriesPayload)
      showToast({
        type: 'success',
        title: 'Recurring series created',
        message: `Created ${data?.created ?? 0}, skipped ${Array.isArray(data?.skipped) ? data.skipped.length : 0}.`,
      })
      resetForm({ keepEmployee: true })
      router.push({ name: 'employee-car-history' })
      return
    }

    // 👉 build payload for one-off
    const payload = buildOneOffPayload(form.value)

    // 👉 only require ticket for Techo International Airport
    const needsTicket = (form.value.stops || []).some(
      s => s.destination === AIRPORT_DESTINATION
    )

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

    showToast({
      type: 'success',
      title: 'Submitted',
      message: 'Your car booking has been submitted.',
    })
    resetForm({ keepEmployee: true })
    router.push({ name: 'employee-car-history' })
  } catch (e) {
    const msg =
      e?.response?.data?.error ||
      e?.response?.data?.message ||
      e?.message ||
      'Submission failed.'
    showToast({
      type: 'error',
      title: 'Submission failed',
      message: msg,
    })
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
  validationErrors.value = []
}

/* ───────── Mounted: load employees + handle ?tripDate= ───────── */
onMounted(() => {
  loadEmployees()

  if (route.query.tripDate) {
    form.value.tripDate = route.query.tripDate
    showToast({
      type: 'info',
      title: 'Booking date loaded',
      message: `Date automatically set to ${route.query.tripDate}.`,
    })
  }
})

/* ───────── Watchers ───────── */
watch(
  () => form.value.employeeId,
  v => { if (v) localStorage.setItem('employeeId', v) }
)
</script>

<template>
  <div class="px-1 py-1 sm:px-0 text-slate-900 dark:text-slate-100 book-container">
    <div
      class="slim-card rounded-2xl border border-slate-200 bg-white shadow-sm
             dark:border-slate-700 dark:bg-slate-900"
    >
      <!-- Header / Hero -->
      <div
        class="rounded-t-2xl border-b border-slate-200 rounded-t-2xl
               bg-gradient-to-r from-sky-700 via-sky-500 to-indigo-400
               px-4 py-3 text-white"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-col leading-tight">
            <span
              class="text-[10px] font-semibold uppercase tracking-[0.24em]
                     text-slate-800/80 dark:text-slate-200/80"
            >
              Car Booking
            </span>
          </div>
        </div>
      </div>

      <!-- Body -->
      <div class="px-3 py-3">
        <!-- Validation error box -->
        <div
          v-if="validationErrors.length"
          class="mb-3 rounded-md border border-rose-500 bg-rose-50 px-3 py-2 text-[11px] text-rose-700
                 dark:border-rose-500/80 dark:bg-rose-950/40 dark:text-rose-100"
        >
          <div class="font-semibold mb-1 text-[11px]">
            Please check the following:
          </div>
          <ul class="list-disc pl-4 space-y-0.5">
            <li v-for="(e, idx) in validationErrors" :key="idx">
              {{ e }}
            </li>
          </ul>
        </div>

        <form @submit.prevent="submit">
          <div class="grid gap-3 md:grid-cols-12">
            <!-- Requester -->
            <div class="md:col-span-4">
              <RequesterSection
                :form="form"
                :employees="employees"
                :loading-employees="loadingEmployees"
                @updateEmployee="onEmployeeSelected"
              />
            </div>

            <!-- Trip details -->
            <div class="md:col-span-5">
              <TripDetailSection
                :form="form"
                :CATEGORY="CATEGORY"
                :LOCATIONS="LOCATIONS"
                :PASSENGER_OPTIONS="PASSENGER_OPTIONS"
              />
            </div>

            <!-- Purpose / notes -->
            <div class="md:col-span-3 sticky-col">
              <PurposeSection
                :form="form"
                :PURPOSES="PURPOSES"
                :LOCATIONS="LOCATIONS"
              />
            </div>

            <!-- Recurring -->
            <div class="md:col-span-12">
              <RecurringBookingSection :form="form" />
            </div>
          </div>
        </form>
      </div>

      <!-- Footer buttons -->
      <div
        class="slim-toolbar flex items-center justify-between gap-2
               border-t border-slate-200 bg-gradient-to-r from-indigo-50 via-emerald-50 to-slate-50
               px-3 py-2 text-[11px]
               dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900"
      >
        <div class="text-[11px] text-slate-500 dark:text-slate-400">
          Please double-check date, time, and destination before submitting.
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100
                   disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            :disabled="loading"
            @click="resetForm()"
          >
            ⟳
            <span class="ml-1">Reset</span>
          </button>

          <button
            type="submit"
            class="inline-flex items-center rounded-lg border border-sky-500 bg-sky-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-sky-500
                   disabled:opacity-60 dark:border-sky-500 dark:bg-sky-600 dark:hover:bg-sky-500"
            :disabled="loading"
            @click.prevent="submit"
          >
            <span
              v-if="loading"
              class="mr-1 inline-block h-3 w-3 animate-spin rounded-full border-[2px] border-white/70 border-t-transparent"
            />
            <span>Submit</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.slim-card {
  border-radius: 14px;
}
.slim-toolbar {
  border-bottom-left-radius: 14px;
  border-bottom-right-radius: 14px;
}

.sticky-col {
  align-self: flex-start;
}

/* 📱 Mobile: full width, no outer border */
@media (max-width: 600px) {
  .book-container {
    padding: 0 !important;
  }

  .slim-card {
    border-radius: 0;
    border-left: none;
    border-right: none;
  }

  .slim-toolbar {
    border-radius: 0;
    padding-left: 8px !important;
    padding-right: 8px !important;
  }
}
</style>
