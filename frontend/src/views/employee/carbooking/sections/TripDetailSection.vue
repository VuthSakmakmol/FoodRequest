<!-- src/employee/carbooking/sections/TripDetailSection.vue -->
<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import api from '@/utils/api'

const props = defineProps({
  form: Object,
  CATEGORY: Array,
  LOCATIONS: Array,
  PASSENGER_OPTIONS: Array
})
const emit = defineEmits(['capacity-change'])

/* Fallback capacities when no people list is available */
const MAX_CAR  = 3
const MAX_MSGR = 1

/* UI state */
const availLoading = ref(false)
const availError   = ref('')
const availableCar  = ref(null) // null -> show default max
const availableMsgr = ref(null) // null -> show default max
const clashes      = ref([])     // overlapping non-pending bookings for the selected category

/* People for capacity (same as calendar) */
const drivers    = ref([]) // [{ loginId, name }]
const messengers = ref([])

async function fetchPeople() {
  const normalize = (arr = []) =>
    (Array.isArray(arr) ? arr : [])
      .map(u => {
        const loginId = String(u.loginId || u._id || u.id || '').trim()
        return { loginId, name: u.name || u.fullName || loginId || '—' }
      })
      .filter(u => !!u.loginId)

  try {
    const [drv, msg] = await Promise.all([
      api.get('/admin/users', { params: { role: 'DRIVER',    isActive: true } }),
      api.get('/admin/users', { params: { role: 'MESSENGER', isActive: true } }),
    ])
    drivers.value    = normalize(drv?.data)
    messengers.value = normalize(msg?.data)
  } catch (e) {
    // fall back to constant capacities
    drivers.value = []
    messengers.value = []
  }
}

const startTime = computed(() =>
  props.form.startHour && props.form.startMinute ? `${props.form.startHour}:${props.form.startMinute}` : ''
)
const endTime = computed(() =>
  props.form.endHour && props.form.endMinute ? `${props.form.endHour}:${props.form.endMinute}` : ''
)
const isCarSelected       = computed(() => props.form.category === 'Car')
const isMessengerSelected = computed(() => props.form.category === 'Messenger')
const hasAirport  = computed(() => (props.form.stops || []).some(s => s.destination === 'Airport'))

/* Controls */
const HOURS   = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = ['00', '30']
const destinationItems = computed(() => {
  const base = Array.isArray(props.LOCATIONS) ? props.LOCATIONS.slice() : []
  if (!base.includes('Airport')) base.unshift('Airport')
  if (!base.includes('Other')) base.push('Other')
  return base
})

/* Itinerary helpers */
function addStop() {
  props.form.stops.push({ destination: '', destinationOther: '', mapLink: '' })
}
function removeStop(i) {
  props.form.stops.splice(i, 1)
  if (!props.form.stops.length) addStop()
}
function onDestinationChange(row) {
  if (row.destination !== 'Other') {
    row.destinationOther = ''
    row.mapLink = ''
  }
}

/* Time math */
const toMin = (hhmm) => {
  if (!hhmm) return null
  const [h, m] = hhmm.split(':').map(n => parseInt(n || '0', 10))
  return h * 60 + (m || 0)
}
const overlaps = (aS, aE, bS, bE) => aS < bE && bS < aE

/* Availability + clashes (client-side, PENDING is ignored) */
async function refreshAvailability() {
  availError.value = ''
  clashes.value = []

  const haveAll = props.form.tripDate && startTime.value && endTime.value
  if (!haveAll) {
    // nothing chosen yet -> use defaults
    availableCar.value  = null
    availableMsgr.value = null
    emit('capacity-change', false)
    return
  }

  availLoading.value = true
  try {
    // Ensure we have current people lists (for true capacity)
    if (!drivers.value.length && !messengers.value.length) {
      await fetchPeople()
    }

    const capCar  = drivers.value.length    ? drivers.value.length    : MAX_CAR
    const capMsgr = messengers.value.length ? messengers.value.length : MAX_MSGR

    // Get all bookings for the day
    const { data: day } = await api.get('/admin/car-bookings', { params: { date: props.form.tripDate } })

    const s = toMin(startTime.value)
    const e = toMin(endTime.value)

    // statuses considered BUSY (PENDING should NOT block)
    const BUSY = new Set(['ACCEPTED','ON_ROAD','ARRIVING','DELAYED'])

    // Busy counts by category
    const busyCar = (Array.isArray(day) ? day : [])
      .filter(b => b.category === 'Car' && BUSY.has(b.status))
      .filter(b => overlaps(s, e, toMin(b.timeStart), toMin(b.timeEnd))).length

    const busyMsgr = (Array.isArray(day) ? day : [])
      .filter(b => b.category === 'Messenger' && BUSY.has(b.status))
      .filter(b => overlaps(s, e, toMin(b.timeStart), toMin(b.timeEnd))).length

    availableCar.value  = Math.max(0, capCar  - busyCar)
    availableMsgr.value = Math.max(0, capMsgr - busyMsgr)

    // Button lock: based on selected category only
    const noneLeft = isCarSelected.value ? availableCar.value === 0 : availableMsgr.value === 0
    emit('capacity-change', noneLeft)

    // Build "busy windows" chips for the selected category only (ignore PENDING/COMPLETED/CANCELLED)
    const sel = props.form.category
    clashes.value = (Array.isArray(day) ? day : [])
      .filter(b => b.category === sel && BUSY.has(b.status))
      .filter(b => overlaps(s, e, toMin(b.timeStart), toMin(b.timeEnd)))
      .map(b => ({ id: b._id, start: b.timeStart, end: b.timeEnd }))
      .sort((a, b) => a.start.localeCompare(b.start))
  } catch (err) {
    availError.value = err?.response?.data?.message || err?.message || 'Failed to check availability'
    availableCar.value  = null
    availableMsgr.value = null
  } finally {
    availLoading.value = false
  }
}

/* Watchers */
const trigger = () => queueMicrotask(refreshAvailability)
watch(() => [props.form.tripDate, props.form.category], trigger)
watch(() => [props.form.startHour, props.form.startMinute, props.form.endHour, props.form.endMinute], trigger)
onMounted(() => {
  // make sure a stop row exists
  if (!props.form.stops?.length) addStop()
  refreshAvailability()
})
</script>

<template>
  <v-sheet class="section pa-0 overflow-hidden" rounded="lg">
    <!-- Header -->
    <div class="hero">
      <div class="hero-left">
        <div class="hero-title">
          <i class="fa-solid fa-route"></i>
          <span>Order Detail</span>
        </div>
      </div>
    </div>

    <div class="px-3 pb-3 pt-2">
      <!-- Availability -->
      <v-card flat class="mb-3 soft-card glass">
        <v-card-text class="pt-3">
          <div class="cap-row">
            <div class="right">
              <v-chip class="gradient-chip car" size="small" style="margin-bottom: 2px;">
                <i class="fa-solid fa-car"></i>&nbsp;
                <template v-if="availLoading">Checking…</template>
                <template v-else-if="availError">{{ availError }}</template>
                <template v-else>
                  Available cars: {{ (availableCar === null) ? 3 : availableCar }}
                </template>
              </v-chip>

              <v-chip class="gradient-chip msgr" size="small">
                <i class="fa-solid fa-motorcycle"></i>&nbsp;
                <template v-if="availLoading">Checking…</template>
                <template v-else-if="availError">{{ availError }}</template>
                <template v-else>
                  Available messenger: {{ (availableMsgr === null) ? 1 : availableMsgr }}
                </template>
              </v-chip>
            </div>
          </div>

          <!-- Busy windows for the *selected* category (ignores PENDING/COMPLETED/CANCELLED) -->
          <v-alert
            v-if="!availLoading && !availError && (availableCar !== null || availableMsgr !== null) && clashes.length"
            type="warning"
            variant="tonal"
            border="start"
            density="comfortable"
            class="mt-3"
          >
            <div class="mb-1">
              <i class="fa-solid fa-triangle-exclamation"></i>
              &nbsp; Busy during your selected time:
            </div>
            <div class="chip-row">
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
            <div class="mt-2 text-caption">
              Choose another start time or contact admin.
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
      <v-card flat class="mb-3 soft-card glass">
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

            <v-col cols="12" md="4">
              <v-select :items="PASSENGER_OPTIONS" v-model="props.form.passengers" label="Passengers" variant="outlined" density="compact" hide-details />
            </v-col>
            <v-col cols="12" md="8">
              <v-text-field v-model="props.form.customerContact" label="Customer Contact Number" variant="outlined" density="compact" hide-details />
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>

      <!-- Itinerary -->
      <v-card flat class="mb-2 soft-card glass">
        <v-card-title class="subhdr between">
          <v-btn size="x-small" class="btn-grad" @click="addStop">
            <i class="fa-solid fa-plus"></i>&nbsp; Add destination
          </v-btn>
        </v-card-title>

        <v-card-text class="pt-0">
          <v-expansion-panels variant="accordion" density="compact">
            <v-expansion-panel
              v-for="(row, idx) in props.form.stops"
              :key="idx"
              elevation="0"
              class="mb-2 rounded-lg dashed"
            >
              <v-expansion-panel-title>
                <div class="row-title">
                  <div class="num">{{ idx + 1 }}</div>
                  <div class="txt">
                    {{ row.destination === 'Other' ? (row.destinationOther || 'Other') : (row.destination || 'Destination') }}
                  </div>
                </div>
              </v-expansion-panel-title>

              <v-expansion-panel-text>
                <v-row dense class="align-center">
                  <v-col cols="12" md="3">
                    <v-select
                      :items="destinationItems"
                      v-model="row.destination"
                      :label="`Destination #${idx + 1}`"
                      variant="outlined"
                      density="compact"
                      hide-details
                      width="300px"
                      @update:model-value="onDestinationChange(row)"
                    />
                  </v-col>

                  <v-col v-if="row.destination === 'Other'" cols="12" md="4">
                    <v-text-field v-model="row.destinationOther" label="Destination Name (Other)" variant="outlined" density="compact" hide-details />
                  </v-col>

                  <v-col v-if="row.destination === 'Other'" cols="12" md="4">
                    <v-text-field v-model="row.mapLink" label="Google Maps Link" placeholder="https://maps.google.com/…" variant="outlined" density="compact" hide-details />
                  </v-col>

                  <v-spacer class="d-none d-md-flex" />

                  <v-col cols="12" md="auto" class="d-flex justify-end ms-auto mt-2 mt-md-0">
                    <v-btn
                      color="error"
                      variant="text"
                      size="small"
                      class="remove-btn"
                      @click="removeStop(idx)"
                    >
                      <i class="fa-solid fa-trash"></i>
                      <span class="ml-1">Remove</span>
                    </v-btn>
                  </v-col>
                </v-row>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>

          <v-alert v-if="hasAirport" type="info" variant="tonal" density="comfortable" class="mt-3 mb-2" border="start">
            Airport selected — please attach the airplane ticket below.
          </v-alert>
          <v-file-input
            v-if="hasAirport"
            v-model="props.form.ticketFile"
            label="Airplane Ticket (required for Airport)"
            variant="outlined"
            density="compact"
            accept=".pdf,.jpg,.jpeg,.png"
            prepend-icon="mdi-paperclip"
            show-size
            hide-details="auto"
          />
        </v-card-text>
      </v-card>
    </div>
  </v-sheet>
</template>

<style scoped>
.section { background: linear-gradient(180deg, rgba(99,102,241,.06), rgba(16,185,129,.05)); border: 1px solid rgba(100,116,139,.18); }
.hero { display:flex; align-items:center; justify-content:space-between; padding: 14px 18px; background: linear-gradient(90deg, #5d7884 0%, #9293d4 60%, #786e95 100%); color:#fff; }
.hero-left { display:flex; flex-direction:column; gap:6px; }
.hero-title { display:flex; align-items:center; gap:10px; font-weight:700; font-size:1.05rem; }
.hero-sub { opacity:.92; font-size:.9rem; }

.soft-card { border: 1px solid rgba(100,116,139,.14); border-radius: 14px; }
.glass { background: rgba(255,255,255,.62); backdrop-filter: blur(6px); }
.dashed { border: 1px dashed rgba(100,116,139,.25); }

.subhdr { display:flex; align-items:center; gap:10px; font-weight:700; }
.subhdr.between { justify-content:space-between; }

.cap-row { display:flex; align-items:center; justify-content:space-between; gap:10px; }
.gradient-chip { color:#fff !important; padding: 6px 12px; font-weight:700; }
.gradient-chip.car  { background: linear-gradient(90deg,#3b82f6,#22d3ee) !important; }
.gradient-chip.msgr { background: linear-gradient(90deg,#f59e0b,#ef4444) !important; }

.chip-row { display:flex; flex-wrap:wrap; gap:6px; }
.chip.busy { background: rgba(239, 68, 68, .12); border: 1px solid rgba(239, 68, 68, .4); }
.row-title { display:flex; align-items:center; gap:10px; }
.row-title .num { width:22px; height:22px; border-radius:999px; display:flex; align-items:center; justify-content:center; background: linear-gradient(135deg, #22d3ee, #6366f1); color:#fff; font-size:12px; font-weight:800; }
.row-title .txt { font-weight:600; }
.remove-btn { color:#ef4444; }
.btn-grad { background: linear-gradient(90deg,#22d3ee,#6366f1); color:#fff; }
.btn-grad:hover { filter: brightness(1.05); }
</style>
