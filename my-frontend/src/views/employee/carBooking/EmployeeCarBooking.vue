<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useRouter, useRoute } from 'vue-router'
import { useToast } from '@/composables/useToast'
import { CAR_BOOKING_PURPOSES } from '@/constants/carBookingOptions'

const router = useRouter()
const route = useRoute()
const { showToast } = useToast()
const DEBUG = true

import RequesterSection from './sections/RequesterSection.vue'
import TripDetailSection from './sections/TripDetailSection.vue'
import PurposeSection from './sections/PurposeSection.vue'
import RecurringBookingSection from './sections/RecurringBookingSection.vue'

const CATEGORY = ['Car', 'Messenger']
const AIRPORT_DESTINATION = 'Techo International Airport'
const LOCATIONS = [
  'Techo International Airport',
  'CGTI',
  'CARGOPORT ( OFFICE )',
  'Khai Nam',
  'DB ( OFFICE )',
  'Romdoul city condo',
  'BS',
  'KN  (OFFICE)',
  'CIMB Bank',
  'Sixplus Factory',
  'XOTEX( YTI) Factory',
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
  'Acleda Bank',
  'Kerry',
  'Sky City Condo',
  'Olair dry port',
  'Avery',
  'Lunch time (GM)',
  'JGL Worldwide',
  'PTT 271',
  'Dyeing Company',
  'S E C Mega factory  CO., LTD',
]

const PURPOSES = CAR_BOOKING_PURPOSES
const PASSENGER_OPTIONS = Array.from({ length: 15 }, (_, i) => String(i + 1))

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
    showToast({ type: 'error', title: 'Load failed', message: 'Unable to load employees list.' })
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

const capacityNoneLeft = ref(false)
function onCapacityChange(noneLeft) {
  capacityNoneLeft.value = !!noneLeft
}
const capacityExceeded = computed(() => capacityNoneLeft.value)

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
    if (s.destination === 'Other' && !s.destinationOther) {
      errs.push(`Destination #${idx + 1}: please enter destination name.`)
    }
  })

  if (!startTime.value) errs.push('Start time is required.')
  if (!endTime.value) errs.push('End time is required.')
  if (startTime.value && endTime.value && endTime.value <= startTime.value) {
    errs.push('End time must be after start time.')
  }

  if (!f.passengers) errs.push('Number of passengers is required.')
  if (!f.purpose) errs.push('Purpose is required.')
  if (capacityExceeded.value) errs.push('No available vehicle/messenger for the selected time.')
  if (hasAirport.value && !f.ticketFile) errs.push('Airplane ticket is required for Techo International Airport.')

  validationErrors.value = errs
  return errs.length === 0
}

const loading = ref(false)

async function submit() {
  if (!validateForm()) {
    showToast({
      type: 'warning',
      title: 'Please check the form',
      message: 'Some required fields are missing or invalid.',
    })
    return
  }

  loading.value = true
  try {
    const fd = new FormData()
    fd.append('employeeId', form.value.employeeId)
    fd.append('category', form.value.category)
    fd.append('tripDate', form.value.tripDate)
    fd.append('timeStart', startTime.value)
    fd.append('timeEnd', endTime.value)
    fd.append('passengers', form.value.passengers)
    fd.append('customerContact', form.value.customerContact || '')
    fd.append('purpose', form.value.purpose || '')
    fd.append('notes', form.value.notes || '')
    fd.append('stops', JSON.stringify(form.value.stops || []))

    if (form.value.ticketFile) {
      fd.append('ticket', form.value.ticketFile)
    }

    await api.post('/car-bookings', fd, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })

    showToast({
      type: 'success',
      title: 'Submitted',
      message: 'Your booking request was submitted successfully.',
    })

    resetForm({ keepEmployee: true })
    router.push({ name: 'employee-car-history' })
  } catch (e) {
    const msg = e?.response?.data?.error || e?.response?.data?.message || e?.message || 'Submission failed.'
    showToast({ type: 'error', title: 'Submission failed', message: msg })
  } finally {
    loading.value = false
  }
}

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
    startHour: '',
    startMinute: '',
    endHour: '',
    endMinute: '',
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
  }

  capacityNoneLeft.value = false
  validationErrors.value = []
}

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

watch(() => form.value.employeeId, v => {
  if (v) localStorage.setItem('employeeId', v)
})
</script>

<template>
  <div class="px-1 py-1 sm:px-0 text-slate-900 dark:text-slate-100 book-container">
    <div class="slim-card rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div class="rounded-t-2xl border-b border-slate-200 bg-gradient-to-r from-sky-700 via-sky-500 to-indigo-400 px-4 py-3 text-white">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-col leading-tight">
            <span class="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-800/80 dark:text-slate-200/80">
              Vehicle Reservation
            </span>
          </div>
        </div>
      </div>

      <div class="px-3 py-3">
        <div
          v-if="validationErrors.length"
          class="mb-3 rounded-md border border-rose-500 bg-rose-50 px-3 py-2 text-[11px] text-rose-700
                 dark:border-rose-500/80 dark:bg-rose-950/40 dark:text-rose-100"
        >
          <div class="mb-1 text-[11px] font-semibold">Please check the following:</div>
          <ul class="list-disc space-y-0.5 pl-4">
            <li v-for="(e, idx) in validationErrors" :key="idx">{{ e }}</li>
          </ul>
        </div>

        <form @submit.prevent="submit">
          <div class="grid gap-3 md:grid-cols-12">
            <div class="md:col-span-4">
              <RequesterSection
                :form="form"
                :employees="employees"
                :loading-employees="loadingEmployees"
                @updateEmployee="onEmployeeSelected"
              />
            </div>

            <div class="md:col-span-5">
              <TripDetailSection
                :form="form"
                :CATEGORY="CATEGORY"
                :LOCATIONS="LOCATIONS"
                :PASSENGER_OPTIONS="PASSENGER_OPTIONS"
                @capacity-change="onCapacityChange"
              />
            </div>

            <div class="md:col-span-3 sticky-col">
              <PurposeSection
                :form="form"
                :PURPOSES="PURPOSES"
                :LOCATIONS="LOCATIONS"
              />
            </div>

            <div class="md:col-span-12">
              <RecurringBookingSection :form="form" />
            </div>
          </div>

          <div
            class="slim-toolbar mt-3 flex items-center justify-between gap-2 border-t border-slate-200
                   bg-gradient-to-r from-indigo-50 via-emerald-50 to-slate-50 px-3 py-2 text-[11px]
                   dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900"
          >
            <div class="text-[11px] text-slate-500 dark:text-slate-400">
              Please double-check date, time, and destination before submitting.
            </div>

            <div class="flex items-center gap-2">
              <button
                type="button"
                class="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100
                       dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                @click="resetForm({ keepEmployee: true })"
              >
                Reset
              </button>

              <button
                type="submit"
                class="inline-flex items-center rounded-lg border border-emerald-500 bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                :disabled="loading"
              >
                <span
                  v-if="loading"
                  class="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-[2px] border-white border-t-transparent"
                />
                Submit Request
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>