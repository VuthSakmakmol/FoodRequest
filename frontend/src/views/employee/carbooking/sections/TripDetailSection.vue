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

/* ---------- constants ---------- */
const MAX_CAR = 3
const MAX_MSGR = 1
const TIMEZONE = 'Asia/Phnom_Penh'

/* ---------- reactive ---------- */
const availLoading = ref(false)
const availError = ref('')
const availableCar = ref(null)
const availableMsgr = ref(null)

/* ---------- computed ---------- */
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = ['00', '30']

const startTime = computed(() =>
  props.form.startHour && props.form.startMinute
    ? `${props.form.startHour}:${props.form.startMinute}`
    : ''
)
const endTime = computed(() =>
  props.form.endHour && props.form.endMinute
    ? `${props.form.endHour}:${props.form.endMinute}`
    : ''
)
const isCarSelected = computed(() => props.form.category === 'Car')

/* ---------- helpers ---------- */
function toMin(hhmm) {
  if (!hhmm) return null
  const [h, m] = hhmm.split(':').map(n => parseInt(n || '0', 10))
  return h * 60 + (m || 0)
}

/* ---------- time validation ---------- */
function validateTime() {
  const now = dayjs().tz(TIMEZONE)
  const currentMinutes = now.hour() * 60 + now.minute()

  if (props.form.startHour && !props.form.startMinute) props.form.startMinute = '00'
  if (props.form.endHour && !props.form.endMinute) props.form.endMinute = '00'

  const s = toMin(`${props.form.startHour || '00'}:${props.form.startMinute || '00'}`)
  const e = toMin(`${props.form.endHour || '00'}:${props.form.endMinute || '00'}`)
  const isToday = props.form.tripDate === now.format('YYYY-MM-DD')

  if (isToday && props.form.startHour && s < currentMinutes) {
    Swal.fire({
      icon: 'warning',
      title: 'Invalid Start Time',
      text: 'Start time cannot be earlier than current time.',
      timer: 2200,
      showConfirmButton: false
    })
    const nextHalf = now.minute() < 30 ? now.minute(30) : now.add(1, 'hour').minute(0)
    props.form.startHour = nextHalf.hour().toString().padStart(2, '0')
    props.form.startMinute = nextHalf.minute().toString().padStart(2, '0')
  }

  if (props.form.endHour && e <= s) {
    Swal.fire({
      icon: 'warning',
      title: 'Invalid End Time',
      text: 'End time must be later than start time.',
      timer: 2200,
      showConfirmButton: false
    })
    props.form.endHour = ''
    props.form.endMinute = ''
  }
}

/* ---------- availability check ---------- */
async function refreshAvailability() {
  availError.value = ''
  availableCar.value = null
  availableMsgr.value = null

  const haveAll = props.form.tripDate && startTime.value && endTime.value
  if (!haveAll) return

  availLoading.value = true
  try {
    const [carRes, msgrRes] = await Promise.all([
      api.get('/public/transport/checkAvailability', {
        params: {
          date: props.form.tripDate,
          start: startTime.value,
          end: endTime.value,
          category: 'Car'
        }
      }),
      api.get('/public/transport/checkAvailability', {
        params: {
          date: props.form.tripDate,
          start: startTime.value,
          end: endTime.value,
          category: 'Messenger'
        }
      })
    ])

    availableCar.value = carRes.data?.available ?? MAX_CAR
    availableMsgr.value = msgrRes.data?.available ?? MAX_MSGR
    const noneLeft = isCarSelected.value ? availableCar.value === 0 : availableMsgr.value === 0
    emit('capacity-change', noneLeft)
  } catch (err) {
    availError.value = err?.response?.data?.message || err?.message || 'Failed to check availability'
  } finally {
    availLoading.value = false
  }
}

/* ---------- reactive updates ---------- */
watch(() => [props.form.startHour, props.form.startMinute], validateTime)
watch(() => [props.form.endHour, props.form.endMinute], validateTime)
watch(() => [props.form.tripDate, props.form.category], refreshAvailability)
watch(
  () => [props.form.startHour, props.form.startMinute, props.form.endHour, props.form.endMinute],
  refreshAvailability
)
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
            <v-chip
              :color="availLoading ? 'grey' : (availableCar > 0 ? 'success' : 'error')"
              size="small"
              class="fw-bold text-white"
              variant="flat"
            >
              <i class="fa-solid fa-car"></i>&nbsp;
              <template v-if="availLoading">Checking…</template>
              <template v-else-if="availError">Error</template>
              <template v-else>Available cars: {{ availableCar ?? 0 }}</template>
            </v-chip>

            <v-chip
              :color="availLoading ? 'grey' : (availableMsgr > 0 ? 'success' : 'error')"
              size="small"
              class="fw-bold text-white"
              variant="flat"
            >
              <i class="fa-solid fa-motorcycle"></i>&nbsp;
              <template v-if="availLoading">Checking…</template>
              <template v-else-if="availError">Error</template>
              <template v-else>Available messenger: {{ availableMsgr ?? 0 }}</template>
            </v-chip>
          </div>
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
              <v-select
                :items="CATEGORY"
                v-model="props.form.category"
                variant="outlined"
                density="compact"
                hide-details
              >
                <template #label>
                  Category<span class="required-star">*</span>
                </template>
              </v-select>
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field
                v-model="props.form.tripDate"
                type="date"
                variant="outlined"
                density="compact"
                hide-details
              >
                <template #label>
                  Confirm Date<span class="required-star">*</span>
                </template>
              </v-text-field>
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
              <v-select
                :items="HOURS"
                v-model="props.form.startHour"
                variant="outlined"
                density="compact"
                hide-details
              >
                <template #label>
                  Start Hour<span class="required-star">*</span>
                </template>
              </v-select>
            </v-col>
            <v-col cols="6" md="3">
              <v-select
                :items="MINUTES"
                v-model="props.form.startMinute"
                variant="outlined"
                density="compact"
                hide-details
              >
                <template #label>
                  Start Minute<span class="required-star">*</span>
                </template>
              </v-select>
            </v-col>
            <v-col cols="6" md="3">
              <v-select
                :items="HOURS"
                v-model="props.form.endHour"
                variant="outlined"
                density="compact"
                hide-details
              >
                <template #label>
                  End Hour<span class="required-star">*</span>
                </template>
              </v-select>
            </v-col>
            <v-col cols="6" md="3">
              <v-select
                :items="MINUTES"
                v-model="props.form.endMinute"
                variant="outlined"
                density="compact"
                hide-details
              >
                <template #label>
                  End Minute<span class="required-star">*</span>
                </template>
              </v-select>
            </v-col>

            <v-col v-if="isCarSelected" cols="12" md="4">
              <v-select
                :items="['0', ...PASSENGER_OPTIONS]"
                v-model="props.form.passengers"
                variant="outlined"
                density="compact"
                hide-details
              >
                <template #label>
                  Passengers<span class="required-star">*</span>
                </template>
              </v-select>
            </v-col>

            <v-col cols="12" :md="isCarSelected ? 8 : 12">
              <v-text-field
                v-model="props.form.customerContact"
                variant="outlined"
                density="compact"
                hide-details
              >
                <template #label>
                  Customer Contact Number<span class="required-star">*</span>
                </template>
              </v-text-field>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>
    </div>
  </v-sheet>
</template>

<style scoped>
.section {
  background: linear-gradient(180deg, rgba(99,102,241,.06), rgba(16,185,129,.05));
  border: 1px solid rgba(100,116,139,.18);
  border-radius: 16px;
}

/* hero bar */
.hero {
  padding:14px 18px;
  background:linear-gradient(90deg,#5d7884,#9293d4 60%,#786e95);
  color:#fff;
  font-weight:700;
  display:flex;
  align-items:center;
  gap:10px;
}

/* cards */
.soft-card {
  border:1px solid rgba(100,116,139,.14);
  border-radius:14px;
}
.glass {
  background:rgba(255,255,255,.62);
  backdrop-filter:blur(6px);
}
.subhdr {
  display:flex;
  align-items:center;
  gap:10px;
  font-weight:700;
  font-size:medium;
}
.cap-row {
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:10px;
  flex-wrap:wrap;
}

/* 🔴 red, slightly bigger star for required fields */
.required-star {
  color: #ef4444;
  font-size: 1.2em;
  margin-left: 2px;
  line-height: 1;
}

/* 📱 Mobile: remove borders & stretch to screen edge */
@media (max-width: 600px) {
  .section {
    border: none;
    border-radius: 0;
    /* pull out of v-container padding so it touches phone edge */
    margin-left: -12px;
    margin-right: -12px;
  }

  .hero {
    border-radius: 0;
  }

  .soft-card {
    border: none;
    border-radius: 0;
    box-shadow: none;
  }
}
</style>
