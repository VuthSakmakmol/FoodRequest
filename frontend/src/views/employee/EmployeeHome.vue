<!-- src/views/employee/EmployeeFoodRequest.vue -->
<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import Swal from 'sweetalert2'
import dayjs from 'dayjs'
import api from '@/utils/api'
import socket from '@/utils/socket'
import { useRouter, useRoute } from 'vue-router'

const DEBUG = false
const router = useRouter()
const route  = useRoute()

/* Sections */
import RequesterSection from './sections/RequesterSection.vue'
import OrderDetailSection from './sections/OrderDetailSection.vue'
import MenuSection from './sections/MenuSection.vue'
import RecurringBookingSection from './sections/RecurringBookingSection.vue'

/* Constants */
const MEALS        = ['Breakfast','Lunch','Dinner','Snack']
const MENU_CHOICES = ['Standard','Vegetarian','Vegan','No pork','No beef']
const ALLERGENS    = ['Peanut','Shellfish','Egg','Gluten','Dairy/Lactose','Soy','Others']

/* Directory */
const employees = ref([])
const loadingEmployees = ref(false)

/* Form */
const form = ref({
  employeeId: '',
  name: '',
  department: '',
  contactNumber: '',

  orderType: 'Daily meal',
  meals: [],
  eatDate: dayjs().format('YYYY-MM-DD'),   // will be overridden by route if provided

  eatStartHour: '',
  eatStartMinute: '',
  eatEndHour: '',
  eatEndMinute: '',

  // Simple HH:mm used by Recurring section; OK to leave empty
  eatTimeStart: '',

  quantity: 1,
  location: '',
  locationOther: '',

  menuChoices: ['Standard'],
  menuCounts: {},

  dietary: [],
  dietaryCounts: {},
  dietaryOther: '',

  specialInstructions: '',

  // 🔁 recurring (Daily)
  recurring: false,
  endDate: '',          // 'YYYY-MM-DD'
  skipHolidays: false,
})

/* 🔗 If calendar opened with ?eatDate=YYYY-MM-DD, apply it (no past dates) */
const qEatDate = typeof route.query.eatDate === 'string' ? route.query.eatDate : ''
if (qEatDate && /^\d{4}-\d{2}-\d{2}$/.test(qEatDate)) {
  let d = dayjs(qEatDate, 'YYYY-MM-DD', true)
  const today = dayjs().startOf('day')
  if (!d.isValid() || d.isBefore(today, 'day')) {
    d = today
  }
  form.value.eatDate = d.format('YYYY-MM-DD')
}

const loading = ref(false)
const success = ref('')
const error   = ref('')

/* =========================
   Load employee directory
   ========================= */
async function loadEmployees() {
  loadingEmployees.value = true
  try {
    const { data } = await api.get('/public/employees', { params: { activeOnly: true } })
    employees.value = (Array.isArray(data) ? data : []).map(e => ({
      employeeId:   String(e.employeeId || ''),
      name:         String(e.name || ''),
      department:   String(e.department || ''),
      contactNumber:String(e.contactNumber || ''),
      isActive: !!e.isActive,
    }))

    // restore last selection
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

    if (DEBUG) {
      const withPhone = employees.value.filter(e => e.contactNumber).length
      console.log(`🧮 employees: ${employees.value.length} | with phone: ${withPhone}`)
    }
  } catch (e) {
    console.error('Failed to load directory', e)
  } finally {
    loadingEmployees.value = false
  }
}
loadEmployees()

function onEmployeeSelected(val) {
  const emp = employees.value.find(e => String(e.employeeId) === String(val))
  form.value.name          = emp ? emp.name : ''
  form.value.department    = emp ? emp.department : ''
  form.value.contactNumber = emp ? (emp.contactNumber || '') : ''
}

/* Derived flags */
const isTimedOrder       = computed(() => form.value.orderType && form.value.orderType !== 'Daily meal')
const needsOtherLocation = computed(() => form.value.location === 'Other')
const showOtherAllergy   = computed(() => (form.value.dietary || []).includes('Others'))

/* Validation */
function validateForm() {
  const f = form.value
  const errs = []

  if (!f.employeeId) errs.push('• Employee is required')
  if (!f.orderType)  errs.push('• Order Type is required')
  if (!f.eatDate)    errs.push('• Eat Date is required')
  if (!f.location)   errs.push('• Location is required')

  if (!Array.isArray(f.meals) || f.meals.length === 0) errs.push('• Select at least one Meal')
  if (Number(f.quantity) < 1) errs.push('• Quantity must be ≥ 1')

  if (!Array.isArray(f.menuChoices) || f.menuChoices.length === 0) errs.push('• Select at least one Menu option')
  if (needsOtherLocation.value && !f.locationOther) errs.push('• Please specify “Other Location”')
  if (showOtherAllergy.value && !f.dietaryOther)    errs.push('• Please specify “Other (identify)”')

  if (isTimedOrder.value) {
    const start = f.eatStartHour && f.eatStartMinute ? `${f.eatStartHour}:${f.eatStartMinute}` : ''
    const end   = f.eatEndHour   && f.eatEndMinute   ? `${f.eatEndHour}:${f.eatEndMinute}`     : ''
    if (!start) errs.push('• Start time is required for non-daily orders')
    if (!end)   errs.push('• End time is required for non-daily orders')
    if (start && end && end <= start) errs.push('• End time must be after Start')
  }

  if (f.recurring) {
    if (!f.endDate) errs.push('• End Date is required when Recurring = Yes')
    else if (f.eatDate && f.endDate < f.eatDate) errs.push('• End Date cannot be before Eat Date')
  }

  return errs
}

/* Builders */
function buildMenuCountsArray(menuCountsObj) {
  const entries = Object.entries(menuCountsObj || {})
    .map(([choice, cnt]) => ({ choice, count: Number(cnt || 0) }))
    .filter(x => x.choice && x.count > 0 && x.choice !== 'Standard')

  const map = new Map()
  for (const it of entries) map.set(it.choice, (map.get(it.choice) || 0) + it.count)
  return Array.from(map, ([choice, count]) => ({ choice, count }))
}
function buildDietaryCountsArray(dietaryCountsObj) {
  const temp = Object.entries(dietaryCountsObj || {})
    .map(([allergen, v]) => ({ allergen, count: Number(v?.count || 0), menu: v?.menu || 'Standard' }))
    .filter(x => x.allergen && x.count > 0)

  const key = (x) => `${x.menu}__${x.allergen}`
  const map = new Map()
  for (const it of temp) {
    const k = key(it)
    map.set(k, { allergen: it.allergen, menu: it.menu, count: (map.get(k)?.count || 0) + it.count })
  }
  return Array.from(map.values())
}
function buildPayloadFromForm(f) {
  const simpleStart = f.eatTimeStart && /^\d{2}:\d{2}$/.test(f.eatTimeStart) ? f.eatTimeStart : null

  const startFromParts = f.eatStartHour && f.eatStartMinute
    ? `${String(f.eatStartHour).padStart(2,'0')}:${String(f.eatStartMinute).padStart(2,'0')}`
    : null

  const endFromParts = f.eatEndHour && f.eatEndMinute
    ? `${String(f.eatEndHour).padStart(2,'0')}:${String(f.eatEndMinute).padStart(2,'0')}`
    : null

  return {
    employeeId: f.employeeId,
    orderType: f.orderType,
    meals: f.meals,
    eatDate: f.eatDate,

    eatTimeStart: simpleStart || startFromParts,
    eatTimeEnd:   endFromParts,

    quantity: Number(f.quantity),
    location: {
      kind: f.location,
      other: f.location === 'Other' ? (f.locationOther || '') : ''
    },

    menuChoices: f.menuChoices,
    menuCounts: buildMenuCountsArray(f.menuCounts),

    dietary: f.dietary,
    dietaryOther: f.dietaryOther || '',
    dietaryCounts: buildDietaryCountsArray(f.dietaryCounts),

    specialInstructions: f.specialInstructions || '',

    recurring: {
      enabled: !!f.recurring,
      endDate: f.recurring ? (f.endDate || null) : null,
      skipHolidays: f.recurring ? !!f.skipHolidays : false
    }
  }
}

/* Submit & Reset */
async function submit() {
  error.value = ''
  success.value = ''
  const errs = validateForm()
  if (errs.length) {
    await Swal.fire({ icon:'warning', title:'Please fix the following', html:errs.join('<br>') })
    return
  }

  loading.value = true
  try {
    const payload = buildPayloadFromForm(form.value)
    await api.post('/public/food-requests', payload)
    success.value = '✅ Submitted.'
    await Swal.fire({ icon:'success', title:'Submitted', timer:1400, showConfirmButton:false })
    resetForm({ keepEmployee: true })
    router.push({ name: 'employee-request-history' })
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message || 'Submission failed.'
    error.value = msg
    await Swal.fire({ icon:'error', title:'Submission failed', text: msg })
  } finally {
    loading.value = false
  }
}

function resetForm({ keepEmployee = false } = {}) {
  const cur = {
    id:   form.value.employeeId,
    name: form.value.name,
    dept: form.value.department,
    phone: form.value.contactNumber
  }

  form.value = {
    employeeId:    keepEmployee ? cur.id    : '',
    name:          keepEmployee ? cur.name  : '',
    department:    keepEmployee ? cur.dept  : '',
    contactNumber: keepEmployee ? cur.phone : '',

    orderType: 'Daily meal',
    meals: [],
    eatDate: dayjs().format('YYYY-MM-DD'),

    eatStartHour:'', eatStartMinute:'00',
    eatEndHour:'',   eatEndMinute:'00',
    eatTimeStart: '',

    quantity: 1,
    location: '',
    locationOther: '',

    menuChoices: ['Standard'],
    menuCounts: {},

    dietary: [],
    dietaryCounts: {},
    dietaryOther: '',

    specialInstructions: '',

    recurring: false,
    endDate: '',
    skipHolidays: false
  }
}

/* Persist bits */
watch(() => form.value.employeeId, (v) => { if (v) localStorage.setItem('employeeId', v) })
watch(() => form.value.location, (v) => { if (v !== 'Other') form.value.locationOther = '' })
watch(() => form.value.dietary,  (v) => { if (!(v||[]).includes('Others')) form.value.dietaryOther = '' })

/* Realtime toast */
onMounted(() => {
  socket.on('foodRequest:created', (doc) => {
    const empId = doc?.employee?.employeeId || doc?.employeeId
    if (empId && empId === (form.value.employeeId || localStorage.getItem('employeeId'))) {
      if (!success.value) {
        Swal.fire({
          toast:true,
          icon:'success',
          title:'Request received',
          timer:1500,
          position:'top',
          showConfirmButton:false
        })
      }
    }
  })
  window.addEventListener('keydown', onHotkey)
})
onBeforeUnmount(() => {
  socket.off('foodRequest:created')
  window.removeEventListener('keydown', onHotkey)
})
function onHotkey(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !loading.value) submit()
}

/* Holidays + recurring preview */
const customHolidaySet = ref(new Set())
const holidaysLoading  = ref(false)

async function loadHolidays() {
  holidaysLoading.value = true
  try {
    const { data } = await api.get('/public/holidays')
    customHolidaySet.value = new Set(data?.holidays || [])
  } catch (e) {
    console.warn('[holidays] fetch failed', e)
  } finally {
    holidaysLoading.value = false
  }
}
loadHolidays()

const fmtFullDate = (d) => dayjs(d).format('ddd, D MMM YYYY')
const timeLabel = computed(() => {
  const f = form.value
  if (f.eatTimeStart && /^\d{2}:\d{2}$/.test(f.eatTimeStart)) return f.eatTimeStart
  if (f.eatStartHour && f.eatStartMinute) {
    return `${String(f.eatStartHour).padStart(2,'0')}:${String(f.eatStartMinute).padStart(2,'0')}`
  }
  return '—'
})

const menuSummary = computed(() => {
  const f = form.value
  const qty = Number(f.quantity || 0)
  const specials = Object.entries(f.menuCounts || {})
    .filter(([k]) => k !== 'Standard')
    .reduce((sum, [,v]) => sum + Number(v || 0), 0)

  const standard = Math.max(0, qty - specials)
  const parts = []
  if (standard > 0) parts.push(`Standard × ${standard}`)
  for (const [k, v] of Object.entries(f.menuCounts || {})) {
    if (k === 'Standard') continue
    const n = Number(v || 0)
    if (n > 0) parts.push(`${k} × ${n}`)
  }
  return parts.join(', ') || ('Standard × ' + qty)
})

const recurringList = computed(() => {
  const f = form.value
  if (!f.recurring || !f.eatDate || !f.endDate) return []

  const out = []
  let d = dayjs(f.eatDate)
  const end = dayjs(f.endDate)
  const meals = (f.meals || []).join(', ')
  while (d.isSame(end) || d.isBefore(end)) {
    const iso = d.format('YYYY-MM-DD')
    const isSunday = d.day() === 0
    const isCustom = customHolidaySet.value.has(iso)
    const isHoliday = isSunday || isCustom

    const included = !(f.skipHolidays && isHoliday)

    out.push({
      iso,
      label: fmtFullDate(iso),
      time: timeLabel.value,
      meals,
      qty: Number(f.quantity || 0),
      menus: menuSummary.value,
      location: f.location === 'Other' ? (f.locationOther || 'Other') : (f.location || '—'),
      isHoliday,
      isSunday,
      isCustom,
      included,
      status: included ? 'Will create' : 'Skipped',
      reason: isHoliday ? 'Holiday' : ''
    })
    d = d.add(1, 'day')
  }
  return out
})

const recurringCount = computed(() => recurringList.value.filter(d => d.included).length)
</script>

<template>
  <v-container fluid class="pa-2">
    <v-card class="rounded-lg slim-card" elevation="1">
      <v-alert
        v-if="error"
        type="error"
        class="mx-2 mt-2"
        density="compact"
        variant="tonal"
        border="start"
      >
        {{ error }}
      </v-alert>
      <v-alert
        v-if="success"
        type="success"
        class="mx-2 mt-2"
        density="compact"
        variant="tonal"
        border="start"
      >
        {{ success }}
      </v-alert>
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
              <!-- 🔗 pass route down so OrderDetailSection can see ?eatDate=... -->
              <OrderDetailSection
                :form="form"
                :is-timed-order="isTimedOrder"
                :needs-other-location="needsOtherLocation"
                :MEALS="MEALS"
                :r="route"
              />
            </v-col>

            <v-col cols="12" md="3" class="sticky-col">
              <MenuSection
                :form="form"
                :MENU_CHOICES="MENU_CHOICES"
                :ALLERGENS="ALLERGENS"
                :show-other-allergy="showOtherAllergy"
              />
            </v-col>

            <v-col cols="12">
              <RecurringBookingSection :form="form" :holidays="[...customHolidaySet]" />
            </v-col>

            <!-- recurring preview table -->
            <v-col cols="12" v-if="form.recurring">
              <v-card class="rounded-lg mt-2" elevation="0" variant="outlined">
                <v-toolbar flat density="compact">
                  <v-toolbar-title class="text-subtitle-1 font-weight-bold">
                    Recurring schedule preview
                    <v-progress-circular
                      v-if="holidaysLoading"
                      indeterminate
                      size="16"
                      width="2"
                      class="ml-2"
                    />
                  </v-toolbar-title>
                  <v-spacer />
                  <v-chip size="small" color="primary" variant="flat">
                    {{ recurringCount }} day{{ recurringCount === 1 ? '' : 's' }}
                  </v-chip>
                </v-toolbar>

                <v-divider />

                <v-card-text class="pa-0">
                  <v-table density="comfortable" class="text-body-2">
                    <thead>
                      <tr>
                        <th style="width: 220px;">Date</th>
                        <th style="width: 88px;">Time</th>
                        <th>Meals</th>
                        <th style="width: 84px;">Qty</th>
                        <th>Menus</th>
                        <th style="width: 200px;">Location</th>
                        <th style="width: 120px;">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="d in recurringList" :key="d.iso">
                        <td>
                          <span>{{ d.label }}</span>
                          <v-chip
                            v-if="d.isHoliday"
                            size="x-small"
                            color="red"
                            class="ml-2"
                            variant="tonal"
                            label
                          >
                            Holiday
                          </v-chip>
                        </td>
                        <td>{{ d.time }}</td>
                        <td>{{ d.meals || '—' }}</td>
                        <td>{{ d.qty }}</td>
                        <td>{{ d.menus }}</td>
                        <td>{{ d.location }}</td>
                        <td>
                          <v-chip :color="d.included ? 'green' : 'grey'" size="small" label>
                            {{ d.status }}
                            <template v-if="!d.included && d.reason">
                              ({{ d.reason }})
                            </template>
                          </v-chip>
                        </td>
                      </tr>

                      <tr v-if="!recurringList.length">
                        <td colspan="7" class="text-medium-emphasis">
                          No days to show. Pick an End Date on the Recurring section.
                        </td>
                      </tr>
                    </tbody>
                  </v-table>
                </v-card-text>
              </v-card>
            </v-col>
          </v-row>
        </v-form>
      </v-card-text>

      <v-toolbar flat density="compact" class="px-3 py-1 slim-toolbar">
        <v-spacer />
        <v-btn
          :loading="loading"
          size="small"
          class="px-4"
          color="primary"
          @click="submit"
        >
          Submit
        </v-btn>
        <v-btn
          variant="text"
          size="small"
          class="ml-1"
          color="error"
          :disabled="loading"
          @click="resetForm()"
        >
          Reset
        </v-btn>
      </v-toolbar>
    </v-card>
  </v-container>
</template>

<style scoped>
.slim-card {
  border: 1px solid rgba(100,116,139,.16);
}
.slim-toolbar {
  background: linear-gradient(90deg, rgba(99,102,241,.06), rgba(16,185,129,.05));
}
.section {
  background: #fafafb;
  border: 1px dashed rgba(100,116,139,.25);
}
.hdr {
  display:flex;
  align-items:center;
  gap:8px;
  margin-bottom:6px;
}
.hdr .t {
  font-weight: 600;
  font-size: .95rem;
}
.n {
  width:18px;
  height:18px;
  border-radius:999px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  background:#6b7280;
  color:#fff;
  font-size:11px;
  font-weight:700;
}
:deep(.v-input){
  margin-bottom:6px !important;
}
:deep(.v-field__input){
  padding-top:6px;
  padding-bottom:6px;
}
.sticky-col {
  align-self:flex-start;
}

/* Recurring preview table */
:deep(.v-table thead th){
  background: #f8fafc;
  font-weight: 600;
}
</style>
