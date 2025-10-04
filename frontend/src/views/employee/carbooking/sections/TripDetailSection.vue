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

/* Backend capacity rules */
const MAX_CAR = 3
const MAX_MSGR = 1

/* UI state */
const availLoading = ref(false)
const availError   = ref('')
const availableCar  = ref(null) // null => show default max
const availableMsgr = ref(null) // null => show default max
const clashes      = ref([])     // overlapping bookings for the selected window (selected category)

/* Derived */
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

/* Itinerary */
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

/* Time helpers */
const toMin = (hhmm) => {
  if (!hhmm) return null
  const [h, m] = hhmm.split(':').map(n => parseInt(n || '0', 10))
  return h * 60 + (m || 0)
}
const overlaps = (aS, aE, bS, bE) => aS < bE && bS < aE

/* Availability + clash windows */
async function refreshAvailability() {
  availError.value = ''
  clashes.value = []

  const haveAll = props.form.tripDate && startTime.value && endTime.value

  // No time picked yet → display defaults
  if (!haveAll) {
    availableCar.value  = null
    availableMsgr.value = null
    emit('capacity-change', false)
    return
  }

  availLoading.value = true
  try {
    // Fetch both capacities (Cars + Messenger)
    const [carCap, msgrCap] = await Promise.all([
      api.get('/car-bookings/availability', {
        params: { date: props.form.tripDate, start: startTime.value, end: endTime.value, category: 'Car' }
      }),
      api.get('/car-bookings/availability', {
        params: { date: props.form.tripDate, start: startTime.value, end: endTime.value, category: 'Messenger' }
      })
    ])

    const leftCar = Number(carCap?.data?.available ?? MAX_CAR)
    const leftMsgr = Number(msgrCap?.data?.available ?? MAX_MSGR)
    availableCar.value  = Math.max(0, Math.min(MAX_CAR, leftCar))
    availableMsgr.value = Math.max(0, Math.min(MAX_MSGR, leftMsgr))

    // Lock submit based on *selected* category
    const noneLeft = isCarSelected.value ? availableCar.value === 0 : availableMsgr.value === 0
    emit('capacity-change', noneLeft)

    // Fetch day list → compute clashes only for the *selected* category
    const { data: day } = await api.get('/admin/car-bookings', { params: { date: props.form.tripDate } })
    const s = toMin(startTime.value)
    const e = toMin(endTime.value)
    const sel = props.form.category

    clashes.value = (Array.isArray(day) ? day : [])
      .filter(b => b.category === sel && b.status !== 'CANCELLED')
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
onMounted(refreshAvailability)
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
        <div class="hero-sub">Live availability shows exact vehicles left for your selected time.</div>
      </div>
    </div>

    <div class="px-3 pb-3 pt-2">
      <!-- Availability -->
      <v-card flat class="mb-3 soft-card glass">
        <v-card-text class="pt-3">
          <div class="cap-row">
            <div class="left">
              <i class="fa-solid fa-warehouse"></i>
              <span>Availability</span>
            </div>
            <div class="right">
              <v-chip class="gradient-chip car" size="small">
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

          <!-- Busy windows for the *selected* category -->
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
              <v-text-field v-model="props.form.tripDate" type="date" label="Date" variant="outlined" density="compact" hide-details />
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
          <div class="left">
            <i class="fa-solid fa-map-location-dot"></i>
            <span>Itinerary</span>
          </div>
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
                <v-row dense>
                  <v-col cols="12" md="3">
                    <v-select
                      :items="destinationItems"
                      v-model="row.destination"
                      :label="`Destination #${idx + 1}`"
                      variant="outlined"
                      density="compact"
                      hide-details
                      @update:model-value="onDestinationChange(row)"
                    />
                  </v-col>

                  <v-col v-if="row.destination === 'Other'" cols="12" md="4">
                    <v-text-field v-model="row.destinationOther" label="Destination Name (Other)" variant="outlined" density="compact" hide-details />
                  </v-col>

                  <v-col v-if="row.destination === 'Other'" cols="12" md="4">
                    <v-text-field v-model="row.mapLink" label="Google Maps Link" placeholder="https://maps.google.com/…" variant="outlined" density="compact" hide-details />
                  </v-col>

                  <v-col cols="12" md="1" class="text-right">
                    <v-btn color="error" variant="text" size="small" class="remove-btn" @click="removeStop(idx)">
                      <i class="fa-solid fa-trash"></i>
                      <span class="ml-1">Remove</span>
                    </v-btn>
                  </v-col>
                </v-row>
              </v-expansion-panel-text>
            </v-expansion-panel>
          </v-expansion-panels>

          <!-- Airport ticket -->
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
.hero { display:flex; align-items:center; justify-content:space-between; padding: 14px 18px; background: linear-gradient(90deg, #0ea5e9 0%, #6366f1 60%, #a78bfa 100%); color:#fff; }
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
