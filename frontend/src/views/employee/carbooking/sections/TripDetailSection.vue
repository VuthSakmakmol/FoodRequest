<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import Swal from 'sweetalert2'
import api from '@/utils/api'

dayjs.extend(utc)
dayjs.extend(timezone)

const props = defineProps({
  form: Object,
  CATEGORY: Array,
  LOCATIONS: Array,
  PASSENGER_OPTIONS: Array
})
const emit = defineEmits(['capacity-change'])

/* ───────── constants ───────── */
const MAX_CAR = 3
const MAX_MSGR = 1
const TIMEZONE = 'Asia/Phnom_Penh'

const availLoading = ref(false)
const availError = ref('')
const availableCar = ref(null)
const availableMsgr = ref(null)
const clashes = ref([])

const drivers = ref([])
const messengers = ref([])

/* ───────── helpers ───────── */
function toMin(hhmm) {
  if (!hhmm) return null
  const [h, m] = hhmm.split(':').map(n => parseInt(n || '0', 10))
  return h * 60 + (m || 0)
}
const overlaps = (aS, aE, bS, bE) => aS < bE && bS < aE

/* ───────── fetch people ───────── */
async function fetchPeople() {
  const normalize = (arr = []) =>
    (Array.isArray(arr) ? arr : []).map(u => ({
      loginId: String(u.loginId || u._id || u.id || '').trim(),
      name: u.name || u.fullName || '—'
    }))
  try {
    const [drv, msg] = await Promise.all([
      api.get('/admin/users', { params: { role: 'DRIVER', isActive: true } }),
      api.get('/admin/users', { params: { role: 'MESSENGER', isActive: true } })
    ])
    drivers.value = normalize(drv?.data)
    messengers.value = normalize(msg?.data)
  } catch {
    drivers.value = []
    messengers.value = []
  }
}

/* ───────── Computed ───────── */
const startTime = computed(() =>
  props.form.startHour && props.form.startMinute ? `${props.form.startHour}:${props.form.startMinute}` : ''
)
const endTime = computed(() =>
  props.form.endHour && props.form.endMinute ? `${props.form.endHour}:${props.form.endMinute}` : ''
)
const isCarSelected = computed(() => props.form.category === 'Car')
const isMessengerSelected = computed(() => props.form.category === 'Messenger')

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = ['00', '30']

/* ───────── validation logic ───────── */
function validateTime() {
  const now = dayjs().tz(TIMEZONE)
  const currentMinutes = now.hour() * 60 + now.minute()

  // Default minutes to 00 when picking a new hour
  if (props.form.startHour && !props.form.startMinute) props.form.startMinute = '00'
  if (props.form.endHour && !props.form.endMinute) props.form.endMinute = '00'

  const startMinutes = toMin(`${props.form.startHour || '00'}:${props.form.startMinute || '00'}`)
  const endMinutes = toMin(`${props.form.endHour || '00'}:${props.form.endMinute || '00'}`)

  // Only check if trip is today
  const isToday = props.form.tripDate === now.format('YYYY-MM-DD')

  // Rule 1: Start time must not be earlier than current Phnom Penh time
  if (isToday && props.form.startHour && startMinutes < currentMinutes) {
    Swal.fire({
      icon: 'warning',
      title: 'Invalid Start Time',
      text: 'Start time cannot be earlier than the current Phnom Penh time.',
      timer: 2200,
      showConfirmButton: false
    })
    // Correct automatically to current time (rounded up)
    const nextHalf = now.minute() < 30 ? now.minute(30) : now.add(1, 'hour').minute(0)
    props.form.startHour = nextHalf.hour().toString().padStart(2, '0')
    props.form.startMinute = nextHalf.minute().toString().padStart(2, '0')
  }

  // Rule 2: End time must be after start time
  if (props.form.endHour && endMinutes <= startMinutes) {
    Swal.fire({
      icon: 'warning',
      title: 'Invalid End Time',
      text: 'End time must be later than the start time.',
      timer: 2200,
      showConfirmButton: false
    })
    props.form.endHour = ''
    props.form.endMinute = ''
  }
}

/* ───────── Conditional passenger logic ───────── */
watch(() => props.form.category, (newVal) => {
  if (newVal === 'Messenger') {
    props.form.passengers = '' // hide + clear passengers
  } else if (newVal === 'Car') {
    props.form.passengers = props.form.passengers || '1' // default 1 if empty
  }
})

/* ───────── Availability logic ───────── */
async function refreshAvailability() {
  availError.value = ''
  clashes.value = []

  const haveAll = props.form.tripDate && startTime.value && endTime.value
  if (!haveAll) {
    availableCar.value = null
    availableMsgr.value = null
    emit('capacity-change', false)
    return
  }

  availLoading.value = true
  try {
    if (!drivers.value.length && !messengers.value.length) await fetchPeople()
    const capCar = drivers.value.length || MAX_CAR
    const capMsgr = messengers.value.length || MAX_MSGR

    const { data: day } = await api.get('/admin/car-bookings', {
      params: { date: props.form.tripDate }
    })
    const s = toMin(startTime.value)
    const e = toMin(endTime.value)
    const BUSY = new Set(['ACCEPTED', 'ON_ROAD', 'ARRIVING', 'DELAYED'])

    const busyCar = (day || [])
      .filter(b => b.category === 'Car' && BUSY.has(b.status))
      .filter(b => overlaps(s, e, toMin(b.timeStart), toMin(b.timeEnd))).length
    const busyMsgr = (day || [])
      .filter(b => b.category === 'Messenger' && BUSY.has(b.status))
      .filter(b => overlaps(s, e, toMin(b.timeStart), toMin(b.timeEnd))).length

    availableCar.value = Math.max(0, capCar - busyCar)
    availableMsgr.value = Math.max(0, capMsgr - busyMsgr)

    const noneLeft = isCarSelected.value ? availableCar.value === 0 : availableMsgr.value === 0
    emit('capacity-change', noneLeft)

    const sel = props.form.category
    clashes.value = (day || [])
      .filter(b => b.category === sel && BUSY.has(b.status))
      .filter(b => overlaps(s, e, toMin(b.timeStart), toMin(b.timeEnd)))
      .map(b => ({ id: b._id, start: b.timeStart, end: b.timeEnd }))
      .sort((a, b) => a.start.localeCompare(b.start))
  } catch (err) {
    availError.value = err?.response?.data?.message || err?.message || 'Failed to check availability'
    availableCar.value = null
    availableMsgr.value = null
  } finally {
    availLoading.value = false
  }
}

/* ───────── Dynamic chip color ───────── */
const carChipColor = computed(() => {
  if (availLoading.value || availError.value) return 'grey'
  return (availableCar.value ?? MAX_CAR) > 0 ? 'success' : 'error'
})
const msgrChipColor = computed(() => {
  if (availLoading.value || availError.value) return 'grey'
  return (availableMsgr.value ?? MAX_MSGR) > 0 ? 'success' : 'error'
})

/* ───────── watchers ───────── */
watch(() => [props.form.startHour, props.form.startMinute], validateTime)
watch(() => [props.form.endHour, props.form.endMinute], validateTime)
watch(() => [props.form.tripDate, props.form.category], refreshAvailability)
watch(() => [props.form.startHour, props.form.startMinute, props.form.endHour, props.form.endMinute], refreshAvailability)
onMounted(refreshAvailability)
</script>

<template>
  <v-sheet class="section pa-0 overflow-hidden" rounded="lg">
    <div class="hero">
      <div class="hero-title">
        <i class="fa-solid fa-route"></i>
        <span>Order Detail</span>
      </div>
    </div>

    <div class="px-3 pb-3 pt-2">
      <!-- Availability -->
      <v-card flat class="mb-3 soft-card glass">
        <v-card-text class="pt-3">
          <div class="cap-row">
            <!-- Car -->
            <v-chip :color="carChipColor" size="small" class="fw-bold text-white" variant="flat">
              <i class="fa-solid fa-car"></i>&nbsp;
              <template v-if="availLoading">Checking…</template>
              <template v-else-if="availError">{{ availError }}</template>
              <template v-else>Available cars: {{ availableCar ?? 3 }}</template>
            </v-chip>

            <!-- Messenger -->
            <v-chip :color="msgrChipColor" size="small" class="fw-bold text-white" variant="flat">
              <i class="fa-solid fa-motorcycle"></i>&nbsp;
              <template v-if="availLoading">Checking…</template>
              <template v-else-if="availError">{{ availError }}</template>
              <template v-else>Available messenger: {{ availableMsgr ?? 1 }}</template>
            </v-chip>
          </div>

          <!-- Clashes -->
          <v-alert
            v-if="!availLoading && !availError && clashes.length"
            type="warning"
            variant="tonal"
            border="start"
            class="mt-3"
            density="comfortable"
          >
            <i class="fa-solid fa-triangle-exclamation"></i>
            Busy during your selected time:
            <div class="chip-row mt-2">
              <v-chip
                v-for="c in clashes"
                :key="c.id"
                size="small"
                class="chip busy"
                label
              >
                <i class="fa-regular fa-clock"></i>&nbsp;{{ c.start }}–{{ c.end }}
              </v-chip>
            </div>
          </v-alert>
        </v-card-text>
      </v-card>

      <!-- Schedule -->
      <v-card flat class="mb-3 soft-card glass">
        <v-card-title class="subhdr">
          <i class="fa-solid fa-calendar-days"></i>
          <span>Schedule</span>
        </v-card-title>
        <v-card-text class="pt-0">
          <v-row dense>
            <v-col cols="12" md="4">
              <v-select :items="CATEGORY" v-model="props.form.category" label="Category" variant="outlined" density="compact" hide-details />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field v-model="props.form.tripDate" type="date" label="Confirm Date" variant="outlined" density="compact" hide-details />
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>

      <!-- Time & Passengers -->
      <v-card flat class="soft-card glass">
        <v-card-title class="subhdr">
          <i class="fa-solid fa-clock"></i>
          <span>Time & Passengers</span>
        </v-card-title>
        <v-card-text class="pt-0">
          <v-row dense>
            <v-col cols="6" md="3">
              <v-select :items="HOURS" v-model="props.form.startHour" label="Start Hour" variant="outlined" density="compact" hide-details />
            </v-col>
            <v-col cols="6" md="3">
              <v-select :items="MINUTES" v-model="props.form.startMinute" label="Start Minute" variant="outlined" density="compact" hide-details />
            </v-col>
            <v-col cols="6" md="3">
              <v-select :items="HOURS" v-model="props.form.endHour" label="End Hour" variant="outlined" density="compact" hide-details />
            </v-col>
            <v-col cols="6" md="3">
              <v-select :items="MINUTES" v-model="props.form.endMinute" label="End Minute" variant="outlined" density="compact" hide-details />
            </v-col>

            <!-- Passenger field only if Car -->
            <v-col v-if="isCarSelected" cols="12" md="4">
              <v-select
                :items="['0', ...PASSENGER_OPTIONS]"
                v-model="props.form.passengers"
                label="Passengers"
                variant="outlined"
                density="compact"
                hide-details
              />
            </v-col>

            <v-col cols="12" :md="isCarSelected ? 8 : 12">
              <v-text-field
                v-model="props.form.customerContact"
                label="Customer Contact Number"
                variant="outlined"
                density="compact"
                hide-details
              />
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>
    </div>
  </v-sheet>
</template>

<style scoped>
.section { background: linear-gradient(180deg, rgba(99,102,241,.06), rgba(16,185,129,.05)); border: 1px solid rgba(100,116,139,.18); }
.hero { padding:14px 18px; background:linear-gradient(90deg,#5d7884,#9293d4 60%,#786e95); color:#fff; font-weight:700; display:flex; align-items:center; gap:10px; }
.soft-card { border:1px solid rgba(100,116,139,.14); border-radius:14px; }
.glass { background:rgba(255,255,255,.62); backdrop-filter:blur(6px); }
.subhdr { display:flex; align-items:center; gap:10px; font-weight:700; font-size:medium; }
.cap-row { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; }
.chip-row { display:flex; flex-wrap:wrap; gap:6px; }
.chip.busy { background:rgba(239,68,68,.12); border:1px solid rgba(239,68,68,.4); }
</style>
