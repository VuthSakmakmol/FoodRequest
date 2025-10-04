<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import Swal from 'sweetalert2'
import dayjs from 'dayjs'
import api from '@/utils/api'
import socket from '@/utils/socket'
import { useRouter } from 'vue-router'

const DEBUG = true
const router = useRouter()

import RequesterSection from './sections/RequesterSection.vue'
import OrderDetailSection from './sections/OrderDetailSection.vue'
import MenuSection from './sections/MenuSection.vue'
import RecurringBookingSection from './sections/RecurringBookingSection.vue'

const MEALS = ['Breakfast','Lunch','Dinner','Snack']
const MENU_CHOICES = ['Standard','Vegetarian','Vegan','No pork','No beef']
const ALLERGENS = ['Peanut','Shellfish','Egg','Gluten','Dairy/Lactose','Soy','Others']

const employees = ref([])
const loadingEmployees = ref(false)

/* ✅ include contactNumber in the form state */
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
  frequency: '',
  endDate: '',
  skipHolidays: false
})

const loading = ref(false)
const success = ref('')
const error = ref('')

/* Fetch directory from /public/employees and preserve contactNumber */
async function loadEmployees() {
  loadingEmployees.value = true
  try {
    const { data } = await api.get('/public/employees', { params: { activeOnly: true } })
    if (DEBUG) console.log('🔎 /public/employees raw[0]:', Array.isArray(data) ? data[0] : data)

    // preserve contactNumber explicitly
    employees.value = (Array.isArray(data) ? data : []).map(e => ({
      employeeId: String(e.employeeId || ''),
      name: String(e.name || ''),
      department: String(e.department || ''),
      contactNumber: String(e.contactNumber || ''),
      isActive: !!e.isActive,
    }))
    if (DEBUG) {
      const withPhone = employees.value.filter(e => e.contactNumber).length
      console.log(`🧮 loaded employees: ${employees.value.length} | with contactNumber: ${withPhone}`)
    }

    // restore last selection
    const savedId = localStorage.getItem('employeeId') || ''
    if (savedId && !form.value.employeeId) {
      const exists = employees.value.some(e => String(e.employeeId) === String(savedId))
      if (exists) {
        form.value.employeeId = savedId
        onEmployeeSelected(savedId)
      }
    } else if (form.value.employeeId) {
      onEmployeeSelected(form.value.employeeId) // fill after async load
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
  if (DEBUG) console.log('👆 selected id:', val, '→ emp:', emp)
  form.value.name = emp ? emp.name : ''
  form.value.department = emp ? emp.department : ''
  form.value.contactNumber = emp ? (emp.contactNumber || '') : ''
  if (DEBUG) console.log('📝 form.contactNumber set to:', form.value.contactNumber)
}

const isTimedOrder = computed(() => form.value.orderType && form.value.orderType !== 'Daily meal')
const needsOtherLocation = computed(() => form.value.location === 'Other')
const showOtherAllergy = computed(() => (form.value.dietary || []).includes('Others'))

function validateForm() {
  const f = form.value
  const errs = []
  if (!f.employeeId) errs.push('• Employee is required')
  if (!f.orderType) errs.push('• Order Type is required')
  if (!f.eatDate) errs.push('• Eat Date is required')
  if (!f.location) errs.push('• Location is required')
  if (!Array.isArray(f.meals) || f.meals.length === 0) errs.push('• Select at least one Meal')
  if (Number(f.quantity) < 1) errs.push('• Quantity must be ≥ 1')
  if (!Array.isArray(f.menuChoices) || f.menuChoices.length === 0) errs.push('• Select at least one Menu option')
  if (needsOtherLocation.value && !f.locationOther) errs.push('• Please specify “Other Location”')
  if (showOtherAllergy.value && !f.dietaryOther) errs.push('• Please specify “Other (identify)”')
  if (isTimedOrder.value) {
    const start = f.eatStartHour && f.eatStartMinute ? `${f.eatStartHour}:${f.eatStartMinute}` : ''
    const end   = f.eatEndHour && f.eatEndMinute ? `${f.eatEndHour}:${f.eatEndMinute}` : ''
    if (!start) errs.push('• Start time is required for non-daily orders')
    if (!end) errs.push('• End time is required for non-daily orders')
    if (start && end && end <= start) errs.push('• End time must be after Start')
  }
  if (f.recurring) {
    if (!f.frequency) errs.push('• Frequency is required when Recurring = Yes')
    if (!f.endDate) errs.push('• End Date is required when Recurring = Yes')
  }
  return errs
}

/* (unchanged) payload builders, submit, reset ... */
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
  return {
    employeeId: f.employeeId,
    orderType: f.orderType,
    meals: f.meals,
    eatDate: f.eatDate,
    eatTimeStart: f.eatStartHour && f.eatStartMinute ? `${f.eatStartHour}:${f.eatStartMinute}` : null,
    eatTimeEnd:   f.eatEndHour && f.eatEndMinute ? `${f.eatEndHour}:${f.eatEndMinute}` : null,
    quantity: Number(f.quantity),
    location: { kind: f.location, other: f.location === 'Other' ? (f.locationOther || '') : '' },
    menuChoices: f.menuChoices,
    menuCounts: buildMenuCountsArray(f.menuCounts),
    dietary: f.dietary,
    dietaryOther: f.dietaryOther || '',
    dietaryCounts: buildDietaryCountsArray(f.dietaryCounts),
    specialInstructions: f.specialInstructions || '',
    recurring: { enabled: !!f.recurring, frequency: f.recurring ? (f.frequency || null) : null, endDate: f.recurring ? (f.endDate || null) : null, skipHolidays: f.recurring ? !!f.skipHolidays : false },
  }
}
async function submit() {
  error.value = ''; success.value = ''
  const errs = validateForm()
  if (errs.length) { await Swal.fire({ icon:'warning', title:'Please fix the following', html:errs.join('<br>') }); return }
  const payload = buildPayloadFromForm(form.value)
  loading.value = true
  try {
    await api.post('/public/food-requests', payload)
    success.value = '✅ Submitted.'
    await Swal.fire({ icon:'success', title:'Submitted', timer:1400, showConfirmButton:false })
    resetForm({ keepEmployee: true })
    router.push({ name: 'employee-request-history' })
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message || 'Submission failed.'
    error.value = msg
    await Swal.fire({ icon:'error', title:'Submission failed', text: msg })
  } finally { loading.value = false }
}
function resetForm({ keepEmployee = false } = {}) {
  const cur = { id: form.value.employeeId, name: form.value.name, dept: form.value.department, phone: form.value.contactNumber }
  form.value = {
    employeeId: keepEmployee ? cur.id : '',
    name: keepEmployee ? cur.name : '',
    department: keepEmployee ? cur.dept : '',
    contactNumber: keepEmployee ? cur.phone : '',
    orderType: 'Daily meal', meals: [], eatDate: dayjs().format('YYYY-MM-DD'),
    eatStartHour:'', eatStartMinute:'', eatEndHour:'', eatEndMinute:'',
    quantity: 1, location: '', locationOther: '',
    menuChoices: ['Standard'], menuCounts: {}, dietary: [], dietaryCounts: {}, dietaryOther: '',
    specialInstructions: '', recurring: false, frequency: '', endDate: '', skipHolidays: false
  }
}

/* Persist employee selection + small housekeeping */
watch(() => form.value.employeeId, (v) => { if (v) localStorage.setItem('employeeId', v) })
watch(() => form.value.location, v => { if (v !== 'Other') form.value.locationOther = '' })
watch(() => form.value.dietary, v => { if (!(v||[]).includes('Others')) form.value.dietaryOther = '' })

/* Realtime toast (unchanged) */
onMounted(() => {
  socket.on('foodRequest:created', (doc) => {
    const empId = doc?.employee?.employeeId || doc?.employeeId
    if (empId && empId === (form.value.employeeId || localStorage.getItem('employeeId'))) {
      if (!success.value) Swal.fire({ toast:true, icon:'success', title:'Request received', timer:1500, position:'top', showConfirmButton:false })
    }
  })
  window.addEventListener('keydown', onHotkey)
})
onBeforeUnmount(() => { socket.off('foodRequest:created'); window.removeEventListener('keydown', onHotkey) })
function onHotkey(e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !loading.value) submit() }
</script>

<template>
  <!-- Debug panel (turn on by changing v-if to true) -->
  <pre v-if="false" style="font-size:11px; background:#0b1020; color:#d2e3ff; padding:.5rem; border-radius:8px;">
    EMP[0]: {{ employees[0] }}
    FORM: {{ form }}
  </pre>

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
              <OrderDetailSection
                :form="form"
                :is-timed-order="isTimedOrder"
                :needs-other-location="needsOtherLocation"
                :MEALS="MEALS"
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
              <RecurringBookingSection :form="form" />
            </v-col>
          </v-row>
        </v-form>
      </v-card-text>

      <v-toolbar flat density="compact" class="px-3 py-1 slim-toolbar">
        <v-toolbar-title class="text-subtitle-1 font-weight-bold">Employee Food Request</v-toolbar-title>
        <v-spacer />
        <v-btn :loading="loading" size="small" class="px-4" @click="submit" style="background-color:aqua;">Submit</v-btn>
        <v-btn variant="text" size="small" class="ml-1" :disabled="loading" @click="resetForm()" style="background-color:red;">Reset</v-btn>
      </v-toolbar>
    </v-card>
  </v-container>
</template>

<style scoped>
.slim-card { border: 1px solid rgba(100,116,139,.16); }
.slim-toolbar { background: linear-gradient(90deg, rgba(99,102,241,.06), rgba(16,185,129,.05)); }
.section { background: #fafafb; border: 1px dashed rgba(100,116,139,.25); }
.hdr { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
.hdr .t { font-weight: 600; font-size: .95rem; }
.n { width:18px; height:18px; border-radius:999px; display:inline-flex; align-items:center; justify-content:center; background:#6b7280; color:#fff; font-size:11px; font-weight:700; }
:deep(.v-input){ margin-bottom:6px !important; }
:deep(.v-field__input){ padding-top:6px; padding-bottom:6px; }
.sticky-col { align-self:flex-start; }
</style>
