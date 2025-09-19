<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import Swal from 'sweetalert2'
import dayjs from 'dayjs'
import api from '@/utils/api'
import socket from '@/utils/socket'

/* ───────── child sections ───────── */
import RequesterSection from './sections/RequesterSection.vue'
import OrderDetailSection from './sections/OrderDetailSection.vue'
import MenuSection from './sections/MenuSection.vue'
import RecurringBookingSection from './sections/RecurringBookingSection.vue'

/* constants */
const MEALS = ['Breakfast','Lunch','Dinner','Snack']
const MENU_CHOICES = ['Standard','Vegetarian','Vegan','No pork','No beef']
const ALLERGENS = ['Peanut','Shellfish','Egg','Gluten','Dairy/Lactose','Soy','Others']

/* ───────── state ───────── */
const employees = ref([])
const loadingEmployees = ref(false)

const form = ref({
  employeeId: '',
  name: '',
  department: '',
  orderType: '',
  meals: [],
  eatDate: dayjs().format('YYYY-MM-DD'),
  eatStartHour: '',
  eatStartMinute: '',
  eatEndHour: '',
  eatEndMinute: '',
  quantity: 1,
  location: '',
  locationOther: '',
  menuChoices: [],
  menuCounts: {},          // ✅ initialize
  dietary: [],
  dietaryCounts: {},       // ✅ initialize with { count, menu }
  allergiesOther: '',
  specialInstructions: '',
  recurring: false,
  frequency: '',
  endDate: '',
  skipHolidays: false
})

const loading = ref(false)
const success = ref('')
const error = ref('')

/* ───────── load employees ───────── */
async function loadEmployees() {
  loadingEmployees.value = true
  try {
    const { data } = await api.get('/public/employees?activeOnly=true')
    employees.value = Array.isArray(data) ? data : []
    const savedId = localStorage.getItem('employeeId') || ''
    if (savedId && !form.value.employeeId) {
      const exists = employees.value.some(e => e.employeeId === savedId)
      if (exists) {
        form.value.employeeId = savedId
        onEmployeeSelected(savedId)
      }
    }
  } catch (e) {
    console.error('Failed to load directory', e)
  } finally {
    loadingEmployees.value = false
  }
}
loadEmployees()

/* ───────── derived ───────── */
function onEmployeeSelected(val) {
  const emp = employees.value.find(e => e.employeeId === val)
  form.value.name = emp ? emp.name : ''
  form.value.department = emp ? emp.department : ''
}
const isTimedOrder = computed(() => form.value.orderType && form.value.orderType !== 'Daily meal')
const needsOtherLocation = computed(() => form.value.location === 'Other')
const showOtherAllergy = computed(() => (form.value.dietary || []).includes('Others'))

/* ───────── validation + payload ───────── */
function validateForm() {
  const f = form.value
  const errs = []
  if (!f.employeeId) errs.push('• Employee is required')
  if (!f.orderType) errs.push('• Order Type is required')
  if (!f.eatDate) errs.push('• Eat Date is required')
  if (!f.location) errs.push('• Location is required')
  if (!Array.isArray(f.meals) || f.meals.length === 0) errs.push('• Select at least one Meal')
  if (f.quantity < 1) errs.push('• Quantity must be ≥ 1')
  if (!Array.isArray(f.menuChoices) || f.menuChoices.length === 0) errs.push('• Select at least one Menu option')
  if (needsOtherLocation.value && !f.locationOther) errs.push('• Please specify “Other Location”')
  if (showOtherAllergy.value && !f.allergiesOther) errs.push('• Please specify “Other (identify)”')

  // time check
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

function buildPayloadFromForm(f) {
  const menuType =
    Array.isArray(f.menuChoices) && f.menuChoices.length
      ? f.menuChoices[0]
      : null

  return {
    employee: {
      employeeId: f.employeeId,
      name: f.name,
      department: f.department,
    },
    orderType: f.orderType,
    meals: f.meals,
    orderDate: new Date(),   // always today
    eatDate: f.eatDate,      // ✅ instead of serveDate
    eatTimeStart: f.eatStartHour && f.eatStartMinute ? `${f.eatStartHour}:${f.eatStartMinute}` : null,
    eatTimeEnd:   f.eatEndHour && f.eatEndMinute ? `${f.eatEndHour}:${f.eatEndMinute}` : null,
    quantity: f.quantity,
    location: {
      kind: f.location,
      other: f.location === 'Other' ? (f.locationOther || '') : '',
    },
    menuChoices: f.menuChoices,
    menuCounts: f.menuCounts,
    menuType,
    dietary: f.dietary,
    dietaryOther: f.allergiesOther || '',
    dietaryCounts: f.dietaryCounts,
    specialInstructions: f.specialInstructions || '',
    recurring: {
      enabled: !!f.recurring,
      frequency: f.recurring ? (f.frequency || null) : null,
      endDate:   f.recurring ? (f.endDate   || null) : null,
      skipHolidays: f.recurring ? !!f.skipHolidays : false,
    },
  }
}


/* ───────── submit ───────── */
async function submit() {
  error.value = ''
  success.value = ''

  const errs = validateForm()
  if (errs.length) {
    await Swal.fire({
      icon: 'warning',
      title: 'Please fix the following',
      html: errs.join('<br>'),
      confirmButtonText: 'OK'
    })
    return
  }

  const payload = buildPayloadFromForm(form.value)
  loading.value = true
  try {
    const { data } = await api.post('/public/food-requests', payload)
    success.value = '✅ Submitted.'
    await Swal.fire({ icon: 'success', title: 'Submitted', timer: 1400, showConfirmButton: false })
    resetForm({ keepEmployee: true })
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message || 'Submission failed.'
    error.value = msg
    await Swal.fire({ icon: 'error', title: 'Submission failed', text: msg })
  } finally {
    loading.value = false
  }
}

function resetForm({ keepEmployee = false } = {}) {
  const currentEmp = form.value.employeeId
  const currentName = form.value.name
  const currentDept = form.value.department
  form.value = {
    employeeId: keepEmployee ? currentEmp : '',
    name: keepEmployee ? currentName : '',
    department: keepEmployee ? currentDept : '',
    orderType: '',
    meals: [],
    eatDate: dayjs().format('YYYY-MM-DD'),
    eatStartHour: '',
    eatStartMinute: '',
    eatEndHour: '',
    eatEndMinute: '',
    quantity: 1,
    location: '',
    locationOther: '',
    menuChoices: [],
    menuCounts: {},
    dietary: [],
    dietaryCounts: {},
    allergiesOther: '',
    specialInstructions: '',
    recurring: false,
    frequency: '',
    endDate: '',
    skipHolidays: false
  }
}

/* persist employee selection */
watch(() => form.value.employeeId, (v) => {
  if (v) localStorage.setItem('employeeId', v)
})
watch(() => form.value.location, v => { if (v !== 'Other') form.value.locationOther = '' })
watch(() => form.value.dietary, v => { if (!(v||[]).includes('Others')) form.value.allergiesOther = '' })

/* ───────── realtime ───────── */
onMounted(() => {
  socket.on('foodRequest:created', (doc) => {
    const empId = doc?.employee?.employeeId
    if (empId && empId === (form.value.employeeId || localStorage.getItem('employeeId'))) {
      if (!success.value) {
        Swal.fire({ toast:true, icon:'success', title:'Request received', timer: 1500, position:'top', showConfirmButton:false })
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
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !loading.value) {
    submit()
  }
}
</script>

<template>
  <v-container fluid class="pa-2">
    <v-card class="rounded-lg slim-card" elevation="1">
      <v-alert v-if="error" type="error" class="mx-2 mt-2" density="compact" variant="tonal" border="start">{{ error }}</v-alert>
      <v-alert v-if="success" type="success" class="mx-2 mt-2" density="compact" variant="tonal" border="start">{{ success }}</v-alert>

      <v-divider class="my-1" />

      <v-card-text class="pa-3">
        <v-form @submit.prevent="submit">
          <v-row dense>
            <v-col cols="12" md="4">
              <RequesterSection :form="form" :employees="employees" :loading-employees="loadingEmployees" @updateEmployee="onEmployeeSelected" />
            </v-col>
            <v-col cols="12" md="5">
              <OrderDetailSection :form="form" :is-timed-order="isTimedOrder" :needs-other-location="needsOtherLocation" :MEALS="MEALS" />
            </v-col>
            <v-col cols="12" md="3" class="sticky-col">
              <MenuSection :form="form" :MENU_CHOICES="MENU_CHOICES" :ALLERGENS="ALLERGENS" :show-other-allergy="showOtherAllergy" />
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
.mini-title { font-size:.8rem; font-weight:600; opacity:.85; }
:deep(.v-input) { margin-bottom: 6px !important; }
:deep(.v-field__input) { padding-top: 6px; padding-bottom: 6px; }
.sticky-col { align-self: flex-start; }
.sticky-panel { position: sticky; top: 72px; max-height: calc(70vh - 72px); overflow: auto; scrollbar-width: thin; }
.sticky-panel::-webkit-scrollbar { width: 8px; }
.sticky-panel::-webkit-scrollbar-thumb { background: rgba(100,116,139,.35); border-radius: 8px; }
@media (max-width: 959.98px) {
  .sticky-panel { position: static; max-height: none; overflow: visible; }
}
</style>
