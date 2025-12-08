<!-- src/views/employee/EmployeeHome.vue -->
<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import socket from '@/utils/socket'
import { useRouter, useRoute } from 'vue-router'
import { useToast } from '@/composables/useToast'

const DEBUG = false
const router = useRouter()
const route  = useRoute()
const { showToast } = useToast()

/* Sections */
import RequesterSection from './foodBooking/sections/RequesterSection.vue'
import OrderDetailSection from './foodBooking/sections/OrderDetailSection.vue'
import MenuSection from './foodBooking/sections/MenuSection.vue'
import RecurringBookingSection from './foodBooking/sections/RecurringBookingSection.vue'

/* Constants */
const MEALS        = ['Breakfast', 'Lunch', 'Dinner', 'Snack']
const MENU_CHOICES = ['Standard', 'Vegetarian', 'Vegan', 'No pork', 'No beef']
const ALLERGENS    = ['Peanut', 'Shellfish', 'Egg', 'Gluten', 'Dairy/Lactose', 'Soy', 'Others']

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
  eatDate: dayjs().format('YYYY-MM-DD'),

  eatStartHour: '',
  eatStartMinute: '',
  eatEndHour: '',
  eatEndMinute: '',

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
  endDate: '',
  skipHolidays: false,
})

/* If calendar opened with ?eatDate=YYYY-MM-DD, apply it (no past dates) */
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
    const msg = e?.response?.data?.message || e?.message || 'Failed to load employee directory.'
    error.value = msg
    showToast({
      type: 'error',
      title: 'Directory error',
      message: msg,
      timeout: 2500,
    })
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
const isTimedOrder       = computed(
  () => form.value.orderType && form.value.orderType !== 'Daily meal'
)
const needsOtherLocation = computed(() => form.value.location === 'Other')
const showOtherAllergy   = computed(
  () => (form.value.dietary || []).includes('Others')
)

/* Validation */
function validateForm() {
  const f = form.value
  const errs = []

  if (!f.employeeId) errs.push('• Employee is required.')
  if (!f.orderType)  errs.push('• Order Type is required.')
  if (!f.eatDate)    errs.push('• Eat Date is required.')
  if (!f.location)   errs.push('• Location is required.')

  if (!Array.isArray(f.meals) || f.meals.length === 0) {
    errs.push('• Select at least one Meal.')
  }
  if (Number(f.quantity) < 1) {
    errs.push('• Quantity must be ≥ 1.')
  }

  if (!Array.isArray(f.menuChoices) || f.menuChoices.length === 0) {
    errs.push('• Select at least one Menu option.')
  }
  if (needsOtherLocation.value && !f.locationOther) {
    errs.push('• Please specify “Other Location”.')
  }
  if (showOtherAllergy.value && !f.dietaryOther) {
    errs.push('• Please specify “Other allergy (specify)”.')
  }

  if (isTimedOrder.value) {
    const start = f.eatStartHour && f.eatStartMinute ? `${f.eatStartHour}:${f.eatStartMinute}` : ''
    const end   = f.eatEndHour   && f.eatEndMinute   ? `${f.eatEndHour}:${f.eatEndMinute}`     : ''
    if (!start) errs.push('• Start time is required for non-daily orders.')
    if (!end)   errs.push('• End time is required for non-daily orders.')
    if (start && end && end <= start) errs.push('• End time must be after Start.')
  }

  if (f.recurring) {
    if (!f.endDate) {
      errs.push('• End Date is required when Recurring = Yes.')
    } else if (f.eatDate && f.endDate < f.eatDate) {
      errs.push('• End Date cannot be before Eat Date.')
    }
  }

  return errs
}

/* Builders */
function buildMenuCountsArray(menuCountsObj) {
  const entries = Object.entries(menuCountsObj || {})
    .map(([choice, cnt]) => ({ choice, count: Number(cnt || 0) }))
    .filter(x => x.choice && x.count > 0 && x.choice !== 'Standard')

  const map = new Map()
  for (const it of entries) {
    map.set(it.choice, (map.get(it.choice) || 0) + it.count)
  }
  return Array.from(map, ([choice, count]) => ({ choice, count }))
}

function buildDietaryCountsArray(dietaryCountsObj) {
  const temp = Object.entries(dietaryCountsObj || {})
    .map(([allergen, v]) => ({
      allergen,
      count: Number(v?.count || 0),
      menu: v?.menu || 'Standard'
    }))
    .filter(x => x.allergen && x.count > 0)

  const key = x => `${x.menu}__${x.allergen}`
  const map = new Map()
  for (const it of temp) {
    const k = key(it)
    map.set(k, {
      allergen: it.allergen,
      menu: it.menu,
      count: (map.get(k)?.count || 0) + it.count
    })
  }
  return Array.from(map.values())
}

function buildPayloadFromForm(f) {
  const simpleStart = f.eatTimeStart && /^\d{2}:\d{2}$/.test(f.eatTimeStart)
    ? f.eatTimeStart
    : null

  const startFromParts = f.eatStartHour && f.eatStartMinute
    ? `${String(f.eatStartHour).padStart(2, '0')}:${String(f.eatStartMinute).padStart(2, '0')}`
    : null

  const endFromParts = f.eatEndHour && f.eatEndMinute
    ? `${String(f.eatEndHour).padStart(2, '0')}:${String(f.eatEndMinute).padStart(2, '0')}`
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

/* Submit & Reset (inline + toast alerts) */
async function submit() {
  error.value = ''
  success.value = ''

  const errs = validateForm()
  if (errs.length) {
    const msg = errs.join(' ')
    error.value = msg
    showToast({
      type: 'error',
      title: 'Please check the form',
      message: msg,
      timeout: 3500,
    })
    return
  }

  loading.value = true
  try {
    const payload = buildPayloadFromForm(form.value)
    await api.post('/public/food-requests', payload)

    success.value = 'Request submitted successfully.'
    error.value   = ''

    showToast({
      type: 'success',
      title: 'Request submitted',
      message: 'Your meal request has been sent to the system.',
      timeout: 2500,
    })

    resetForm({ keepEmployee: true })
    router.push({ name: 'employee-request-history' })
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message || 'Submission failed.'
    error.value   = msg
    success.value = ''
    showToast({
      type: 'error',
      title: 'Submission failed',
      message: msg,
      timeout: 3000,
    })
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

    eatStartHour: '',
    eatStartMinute: '00',
    eatEndHour: '',
    eatEndMinute: '00',
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

  error.value   = ''
  success.value = ''
}

/* Persist bits */
watch(() => form.value.employeeId, v => { if (v) localStorage.setItem('employeeId', v) })
watch(() => form.value.location, v => { if (v !== 'Other') form.value.locationOther = '' })
watch(
  () => form.value.dietary,
  v => { if (!(v || []).includes('Others')) form.value.dietaryOther = '' }
)

/* Realtime toast → banner message */
onMounted(() => {
  socket.on('foodRequest:created', doc => {
    const empId = doc?.employee?.employeeId || doc?.employeeId
    if (empId && empId === (form.value.employeeId || localStorage.getItem('employeeId'))) {
      success.value = 'System has received your meal request.'
      error.value   = ''
      showToast({
        type: 'info',
        title: 'Request received',
        message: 'System confirmed your meal request.',
        timeout: 2500,
      })
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

/* Holidays for RecurringBookingSection calendar */
const customHolidaySet = ref(new Set())

async function loadHolidays() {
  try {
    const { data } = await api.get('/public/holidays')
    customHolidaySet.value = new Set(data?.holidays || [])
  } catch (e) {
    console.warn('[holidays] fetch failed', e)
    showToast({
      type: 'warning',
      title: 'Holiday list',
      message: 'Could not load holiday list. Recurring preview may not skip all holidays.',
      timeout: 3000,
    })
  }
}
loadHolidays()
</script>

<template>
  <!-- Tight padding; layout already has bg-slate-50 -->
  <div class="px-1 py-1 sm:px-0">
    <!-- Main card -->
    <div
      class="rounded-2xl border border-slate-600 bg-slate-100/90 shadow-sm
             dark:border-slate-700 dark:bg-slate-900/80"
    >
      <!-- Alerts -->
      <div v-if="error" class="px-2 pt-2 sm:px-3">
        <div
          class="rounded-md border border-red-500 bg-red-50 px-3 py-2 text-[11px] text-red-700
                 dark:border-red-500/70 dark:bg-red-900/30 dark:text-red-100"
        >
          {{ error }}
        </div>
      </div>

      <div v-else-if="success" class="px-2 pt-2 sm:px-3">
        <div
          class="rounded-md border border-emerald-500 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-700
                 dark:border-emerald-500/70 dark:bg-emerald-900/30 dark:text-emerald-100"
        >
          {{ success }}
        </div>
      </div>

      <!-- Divider line -->
      <div
        class="mt-3 h-px bg-gradient-to-r from-transparent via-slate-400 to-transparent
               dark:via-slate-600"
      ></div>

      <!-- Form content -->
      <div class="px-2 pb-2 pt-3 sm:px-3 sm:pb-3">
        <form @submit.prevent="submit">
          <div class="grid grid-cols-12 gap-3 sm:gap-4">
            <!-- STEP 1: Requester -->
            <section
              class="col-span-12 rounded-xl border border-slate-500 bg-slate-50/80 p-3
                     dark:border-slate-700/80 dark:bg-slate-900/70
                     md:col-span-4"
            >
              <RequesterSection
                :form="form"
                :employees="employees"
                :loading-employees="loadingEmployees"
                @updateEmployee="onEmployeeSelected"
              />
            </section>

            <!-- STEP 2: Order details -->
            <section
              class="col-span-12 rounded-xl border border-slate-500 bg-slate-50 p-3
                     shadow-[0_4px_10px_rgba(15,23,42,0.04)]
                     dark:border-slate-700/80 dark:bg-slate-900
                     md:col-span-8"
            >
              <OrderDetailSection
                :form="form"
                :is-timed-order="isTimedOrder"
                :needs-other-location="needsOtherLocation"
                :MEALS="MEALS"
                :r="route"
              />
            </section>

            <!-- STEP 3: Menu & allergy -->
            <section
              class="col-span-12 rounded-xl border border-slate-500 bg-slate-50 p-3
                     shadow-[0_4px_10px_rgba(15,23,42,0.04)]
                     dark:border-slate-700/80 dark:bg-slate-900"
            >
              <MenuSection
                :form="form"
                :MENU_CHOICES="MENU_CHOICES"
                :ALLERGENS="ALLERGENS"
                :show-other-allergy="showOtherAllergy"
              />
            </section>

            <!-- STEP 4: Recurring -->
            <section
              class="col-span-12 rounded-xl border border-slate-500 bg-slate-50/80 p-3
                     dark:border-slate-700/80 dark:bg-slate-900/70"
            >
              <RecurringBookingSection :form="form" :holidays="[...customHolidaySet]" />
            </section>
          </div>
        </form>
      </div>

      <!-- Bottom toolbar -->
      <div
        class="flex items-center justify-end gap-2 border-t border-slate-500
               bg-slate-100/80 px-2 py-1.5 text-[11px]
               dark:border-slate-800 dark:bg-slate-900/80 sm:px-3"
      >
        <span class="hidden text-[10px] text-slate-500 dark:text-slate-400 sm:inline">
          Tip:
          <kbd
            class="rounded border border-slate-400/60 bg-slate-800/80 px-1 text-[9px] text-slate-100"
          >
            Ctrl
          </kbd>
          +
          <kbd
            class="rounded border border-slate-400/60 bg-slate-800/80 px-1 text-[9px] text-slate-100"
          >
            Enter
          </kbd>
          to submit
        </span>

        <button
          type="button"
          class="inline-flex items-center rounded-full px-3 py-1.5 text-[11px] font-semibold
                 text-slate-700 hover:text-slate-900
                 disabled:cursor-not-allowed disabled:opacity-60
                 dark:text-slate-300 dark:hover:text-slate-100"
          :disabled="loading"
          @click="resetForm()"
        >
          Reset
        </button>

        <button
          type="button"
          class="inline-flex items-center rounded-full bg-[oklch(60%_0.118_184.704)] px-4 py-1.5 text-[11px] font-semibold
                 text-slate-900 shadow-sm hover:brightness-95
                 disabled:cursor-not-allowed disabled:opacity-70"
          :disabled="loading"
          @click="submit"
        >
          <span
            v-if="loading"
            class="mr-1 inline-flex h-3 w-3 animate-spin rounded-full border-[2px] border-slate-900 border-t-transparent"
          ></span>
          Submit
        </button>
      </div>
    </div>
  </div>
</template>
