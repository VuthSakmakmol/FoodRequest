<!-- src/views/employee/EmployeeHome.vue -->
<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import api from '@/utils/api'
import dayjs from 'dayjs'
import Swal from 'sweetalert2'
import socket from '@/utils/socket'

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
  serveDate: dayjs().format('YYYY-MM-DD'),  // default: today
  timeStart: '',
  timeEnd: '',
  quantity: 1,
  location: '',
  locationOther: '',
  menuChoices: [],
  dietary: [],
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

/* popup menus */
const serveDateMenu = ref(false)
const endDateMenu   = ref(false)
const startTimeMenu = ref(false)
const endTimeMenu   = ref(false)

/* helpers */
const fmtDate = d => (d ? dayjs(d).format('YYYY-MM-DD') : '')
const fmtTime = t => t || ''

/* ───────── load employees ───────── */
async function loadEmployees() {
  loadingEmployees.value = true
  try {
    const { data } = await api.get('/public/employees?activeOnly=true')
    employees.value = Array.isArray(data) ? data : []
    // preselect previously used employeeId (if still active)
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
const employeeOptions = computed(() =>
  employees.value.map(e => ({
    value: e.employeeId,
    title: `${e.employeeId} — ${e.name}`,
    subtitle: e.department
  }))
)
function onEmployeeSelected(val) {
  const emp = employees.value.find(e => e.employeeId === val)
  form.value.name = emp ? emp.name : ''
  form.value.department = emp ? emp.department : ''
}
const isTimedOrder = computed(() => form.value.orderType && form.value.orderType !== 'Daily meal')
const needsOtherLocation = computed(() => form.value.location === 'Other')
const showOtherAllergy = computed(() => (form.value.dietary || []).includes('Others'))

/* ───────── validation + payload ───────── */
const r = {
  arrReq: (arr, label='Please select at least one') => (Array.isArray(arr) && arr.length>0) ? true : label,
  pos1: v => (+v >= 1) ? true : 'Quantity must be ≥ 1',
  timePair: () => {
    if (!isTimedOrder.value) return true
    const { timeStart, timeEnd } = form.value
    if (!timeStart || !timeEnd) return 'Start & End time required'
    return timeStart < timeEnd ? true : 'End time must be after Start'
  }
}

function validateForm() {
  const f = form.value
  const errs = []
  if (!f.employeeId) errs.push('• Employee is required')
  if (!f.orderType) errs.push('• Order Type is required')
  if (!f.serveDate) errs.push('• Serve Date is required')
  if (!f.location) errs.push('• Location is required')
  if (!(r.arrReq(f.meals)===true)) errs.push('• Select at least one Meal')
  if (!(r.pos1(f.quantity)===true)) errs.push(`• ${r.pos1(f.quantity)}`)
  if (!(r.arrReq(f.menuChoices)===true)) errs.push('• Select at least one Menu option')
  if (needsOtherLocation.value && !f.locationOther) errs.push('• Please specify “Other Location”')
  if (showOtherAllergy.value && !f.allergiesOther) errs.push('• Please specify “Other (identify)”')
  if (isTimedOrder.value) {
    if (!f.timeStart) errs.push('• Start time is required for non-daily orders')
    if (!f.timeEnd) errs.push('• End time is required for non-daily orders')
    if (f.timeStart && f.timeEnd && !(r.timePair()===true)) errs.push(`• ${r.timePair()}`)
  }
  if (f.recurring) {
    if (!f.frequency) errs.push('• Frequency is required when Recurring = Yes')
    if (!f.endDate) errs.push('• End Date is required when Recurring = Yes')
  }
  if (errs.length) {
    console.group('[Food Request] Validation Errors')
    errs.forEach(e => console.error(e))
    console.groupEnd()
  }
  return errs
}

function buildPayloadFromForm(f) {
  // Backend expects a single menuType (string) — use first selected
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
    serveDate: f.serveDate,
    timeStart: f.timeStart || undefined,
    timeEnd:   f.timeEnd   || undefined,
    quantity: f.quantity,
    location: {
      kind: f.location,
      other: f.location === 'Other' ? (f.locationOther || '') : '',
    },
    menuType,
    dietary: f.dietary,
    dietaryOther: f.allergiesOther || '',
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
      confirmButtonText: 'OK',
      allowEnterKey: true
    })
    return
  }

  const payload = buildPayloadFromForm(form.value)
  console.info('[Food Request] Payload to API:', payload)

  loading.value = true
  try {
    const { data } = await api.post('/public/food-requests', payload)
    console.info('[Food Request] Submitted:', data)
    success.value = '✅ Submitted.'
    // keep the employee preselected for faster next request
    await Swal.fire({ icon: 'success', title: 'Submitted', timer: 1400, showConfirmButton: false })
    resetForm({ keepEmployee: true })
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message || 'Submission failed.'
    console.error('[Food Request] Submit Error:', e)
    error.value = msg
    await Swal.fire({ icon: 'error', title: 'Submission failed', text: msg })
  } finally {
    loading.value = false
  }
}

function resetForm ({ keepEmployee = false } = {}) {
  const currentEmp = form.value.employeeId
  const currentName = form.value.name
  const currentDept = form.value.department
  form.value = {
    employeeId: keepEmployee ? currentEmp : '',
    name: keepEmployee ? currentName : '',
    department: keepEmployee ? currentDept : '',
    orderType: '',
    meals: [],
    serveDate: dayjs().format('YYYY-MM-DD'),
    timeStart: '',
    timeEnd: '',
    quantity: 1,
    location: '',
    locationOther: '',
    menuChoices: [],
    dietary: [],
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

/* clear when not needed */
watch(() => form.value.location, v => { if (v !== 'Other') form.value.locationOther = '' })
watch(() => form.value.dietary, v => { if (!(v||[]).includes('Others')) form.value.allergiesOther = '' })

/* ───────── realtime: confirm creation ping for this employee ───────── */
onMounted(() => {
  socket.on('foodRequest:created', (doc) => {
    try {
      const empId = doc?.employee?.employeeId
      if (empId && empId === (form.value.employeeId || localStorage.getItem('employeeId'))) {
        // Soft toast only if the user didn't just trigger a submit alert
        if (!success.value) {
          Swal.fire({ toast:true, icon:'success', title:'Request received', timer: 1500, position:'top', showConfirmButton:false })
        }
      }
    } catch {}
  })
  // Keyboard: Ctrl/Cmd + Enter to submit
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
      <v-toolbar flat density="compact" class="px-3 py-1 slim-toolbar">
        <v-toolbar-title class="text-subtitle-1 font-weight-bold">Employee Food Request</v-toolbar-title>
        <v-spacer />
        <v-btn :loading="loading" color="primary" size="small" class="px-4" @click="submit">Submit</v-btn>
        <v-btn variant="text" size="small" class="ml-1" :disabled="loading" @click="resetForm()">Reset</v-btn>
      </v-toolbar>

      <v-alert v-if="error" type="error" class="mx-2 mt-2" density="compact" variant="tonal" border="start">{{ error }}</v-alert>
      <v-alert v-if="success" type="success" class="mx-2 mt-2" density="compact" variant="tonal" border="start">{{ success }}</v-alert>

      <v-divider class="my-1" />

      <v-card-text class="pa-3">
        <v-form @submit.prevent="submit" validate-on="submit">
          <v-row dense>
            <!-- ① Requester -->
            <v-col cols="12" md="4" lg="4">
              <v-sheet class="section pa-2" rounded="lg">
                <div class="hdr"><span class="n">1</span><span class="t">Requester</span></div>

                <v-autocomplete
                  v-model="form.employeeId"
                  :items="employeeOptions"
                  item-title="title"
                  item-value="value"
                  :loading="loadingEmployees"
                  label="Employee"
                  variant="outlined"
                  density="compact"
                  hide-details="auto"
                  clearable
                  @update:model-value="onEmployeeSelected"
                />

                <v-row dense class="mt-1">
                  <v-col cols="6">
                    <v-text-field v-model="form.name" label="Name" readonly variant="outlined" density="compact" hide-details />
                  </v-col>
                  <v-col cols="6">
                    <v-text-field v-model="form.department" label="Department" readonly variant="outlined" density="compact" hide-details />
                  </v-col>
                </v-row>
              </v-sheet>
            </v-col>

            <!-- ② Order Detail -->
            <v-col cols="12" md="5" lg="5">
              <v-sheet class="section pa-2" rounded="lg">
                <div class="hdr"><span class="n">2</span><span class="t">Order Detail</span></div>

                <v-row dense>
                  <v-col cols="12" sm="4">
                    <v-select
                      v-model="form.orderType"
                      :items="['Daily meal','Meeting catering','Visitor meal']"
                      label="Type"
                      variant="outlined"
                      density="compact"
                      hide-details="auto"
                    />
                  </v-col>

                  <v-col cols="12" sm="4">
                    <v-menu v-model="serveDateMenu" :close-on-content-click="false" offset-y min-width="auto" transition="scale-transition">
                      <template #activator="{ props }">
                        <v-text-field
                          v-bind="props"
                          :model-value="fmtDate(form.serveDate)"
                          label="Serve Date"
                          variant="outlined"
                          density="compact"
                          readonly
                          placeholder="YYYY-MM-DD"
                          hide-details="auto"
                        />
                      </template>
                      <v-date-picker v-model="form.serveDate" @update:model-value="serveDateMenu = false" />
                    </v-menu>
                  </v-col>

                  <v-col cols="12" sm="4">
                    <v-select
                      v-model="form.location"
                      :items="['Meeting Room','Canteen','Other']"
                      label="Location"
                      variant="outlined"
                      density="compact"
                      hide-details="auto"
                    />
                  </v-col>
                </v-row>

                <!-- Time pickers -->
                <v-row dense v-if="isTimedOrder" class="mt-1">
                  <v-col cols="12" sm="6">
                    <v-menu v-model="startTimeMenu" :close-on-content-click="false" offset-y min-width="auto" transition="scale-transition">
                      <template #activator="{ props }">
                        <v-text-field
                          v-bind="props"
                          :model-value="fmtTime(form.timeStart)"
                          label="Start"
                          variant="outlined"
                          density="compact"
                          readonly
                          placeholder="HH:mm"
                          hide-details="auto"
                        />
                      </template>
                      <v-card>
                        <v-time-picker v-model="form.timeStart" format="24hr" scrollable />
                        <v-card-actions class="justify-end">
                          <v-btn variant="text" @click="startTimeMenu = false">Close</v-btn>
                          <v-btn color="primary" @click="startTimeMenu = false">OK</v-btn>
                        </v-card-actions>
                      </v-card>
                    </v-menu>
                  </v-col>

                  <v-col cols="12" sm="6">
                    <v-menu v-model="endTimeMenu" :close-on-content-click="false" offset-y min-width="auto" transition="scale-transition">
                      <template #activator="{ props }">
                        <v-text-field
                          v-bind="props"
                          :model-value="fmtTime(form.timeEnd)"
                          label="End"
                          variant="outlined"
                          density="compact"
                          readonly
                          placeholder="HH:mm"
                          hide-details="auto"
                          :error-messages="typeof r.timePair() === 'string' ? r.timePair() : ''"
                        />
                      </template>
                      <v-card>
                        <v-time-picker v-model="form.timeEnd" format="24hr" scrollable />
                        <v-card-actions class="justify-end">
                          <v-btn variant="text" @click="endTimeMenu = false">Close</v-btn>
                          <v-btn color="primary" @click="endTimeMenu = false">OK</v-btn>
                        </v-card-actions>
                      </v-card>
                    </v-menu>
                  </v-col>
                </v-row>

                <v-text-field
                  v-if="needsOtherLocation"
                  v-model="form.locationOther"
                  class="mt-1"
                  label="Other Location"
                  variant="outlined"
                  density="compact"
                  hide-details="auto"
                />

                <!-- Meals -->
                <div class="mt-2">
                  <div class="mini-title">Meal</div>
                  <v-row dense class="mt-1">
                    <v-col cols="6" v-for="m in MEALS" :key="m">
                      <v-checkbox
                        v-model="form.meals"
                        :label="m"
                        :value="m"
                        density="compact"
                        color="success"
                        hide-details
                        class="checkbox-pill"
                        :class="{'is-checked': form.meals.includes(m)}"
                      />
                    </v-col>
                  </v-row>
                  <div class="text-error text-caption mt-1" v-if="!(Array.isArray(form.meals)&&form.meals.length)">Select at least one Meal</div>
                </div>

                <v-row dense class="mt-1">
                  <v-col cols="12" sm="6">
                    <v-text-field
                      v-model.number="form.quantity"
                      type="number"
                      min="1"
                      label="Qty"
                      suffix="People"
                      variant="outlined"
                      density="compact"
                      hide-details="auto"
                    />
                  </v-col>
                </v-row>
              </v-sheet>
            </v-col>

            <!-- ③ Menu Section (STICKY on md+) -->
            <v-col cols="12" md="3" lg="3" class="sticky-col">
              <v-sheet class="section pa-2 sticky-panel" rounded="lg">
                <div class="hdr"><span class="n">3</span><span class="t">Menu Section</span></div>

                <div class="mini-title mb-1">Menu (multi-choice)</div>
                <v-row dense>
                  <v-col cols="6" v-for="mc in MENU_CHOICES" :key="mc">
                    <div class="checkbox-box" :class="{ 'is-checked': form.menuChoices.includes(mc) }">
                      <v-checkbox
                        v-model="form.menuChoices"
                        :label="mc"
                        :value="mc"
                        density="compact"
                        color="success"
                        hide-details
                      />
                    </div>
                  </v-col>
                </v-row>

                <div class="text-error text-caption mt-1" v-if="!(Array.isArray(form.menuChoices)&&form.menuChoices.length)">
                  Select at least one Menu
                </div>

                <div class="mini-title mt-3 mb-1">Dietary & Allergies</div>
                <v-row dense>
                  <v-col cols="6" v-for="item in ALLERGENS" :key="item">
                    <div class="checkbox-box" :class="{ 'is-checked': form.dietary.includes(item) }">
                      <v-checkbox
                        v-model="form.dietary"
                        :label="item"
                        :value="item"
                        density="compact"
                        color="success"
                        hide-details
                      />
                    </div>
                  </v-col>
                </v-row>

                <v-text-field
                  v-if="showOtherAllergy"
                  v-model="form.allergiesOther"
                  class="mt-1"
                  label="Other (identify)"
                  variant="outlined"
                  density="compact"
                  hide-details="auto"
                />

                <v-textarea
                  v-model="form.specialInstructions"
                  class="mt-2"
                  label="Special Instruction"
                  variant="outlined"
                  density="compact"
                  rows="2"
                  auto-grow
                  counter="150"
                  hide-details="auto"
                />
              </v-sheet>
            </v-col>

            <!-- ④ Recurring Booking -->
            <v-col cols="12">
              <v-sheet class="section pa-2" rounded="lg">
                <div class="hdr"><span class="n">4</span><span class="t">Recurring Booking</span></div>
                <v-row dense class="align-center">
                  <v-col cols="12" sm="3">
                    <v-btn-toggle v-model="form.recurring" rounded="lg" divided density="compact">
                      <v-btn :value="true" size="small">Yes</v-btn>
                      <v-btn :value="false" size="small">No</v-btn>
                    </v-btn-toggle>
                  </v-col>

                  <template v-if="form.recurring">
                    <v-col cols="12" sm="3">
                      <v-select
                        v-model="form.frequency"
                        :items="['Daily','Weekly','Monthly']"
                        label="Frequency"
                        variant="outlined"
                        density="compact"
                        hide-details="auto"
                      />
                    </v-col>

                    <v-col cols="12" sm="3">
                      <v-menu v-model="endDateMenu" :close-on-content-click="false" offset-y min-width="auto" transition="scale-transition">
                        <template #activator="{ props }">
                          <v-text-field
                            v-bind="props"
                            :model-value="fmtDate(form.endDate)"
                            label="End Date"
                            variant="outlined"
                            density="compact"
                            readonly
                            placeholder="YYYY-MM-DD"
                            hide-details="auto"
                          />
                        </template>
                        <v-date-picker v-model="form.endDate" @update:model-value="endDateMenu = false" />
                      </v-menu>
                    </v-col>

                    <v-col cols="12" sm="3">
                      <v-checkbox v-model="form.skipHolidays" label="Skip holidays" density="compact" hide-details />
                    </v-col>
                  </template>
                </v-row>
              </v-sheet>
            </v-col>
          </v-row>
        </v-form>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<style scoped>
/* ───── card & section look ───── */
.slim-card { border: 1px solid rgba(100,116,139,.16); }
.slim-toolbar { background: linear-gradient(90deg, rgba(99,102,241,.06), rgba(16,185,129,.05)); }
.section { background: #fafafb; border: 1px dashed rgba(100,116,139,.25); }
.hdr { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
.hdr .t { font-weight: 600; font-size: .95rem; }
.n {
  width:18px; height:18px; border-radius:999px; display:inline-flex; align-items:center; justify-content:center;
  background:#6b7280; color:#fff; font-size:11px; font-weight:700;
}
.mini-title { font-size:.8rem; font-weight:600; opacity:.85; }

/* ───── tighten inputs ───── */
:deep(.v-input) { margin-bottom: 6px !important; }
:deep(.v-field__input) { padding-top: 6px; padding-bottom: 6px; }

/* ───── regular checkbox “pill” color when checked (left & middle sections) ───── */
.checkbox-pill.is-checked :deep(.v-selection-control__input) { --v-theme-primary: #16a34a; }
.checkbox-pill.is-checked :deep(.v-label) { color: #16a34a !important; font-weight: 600; }

/* ───── sticky right panel (Section 3) ───── */
.sticky-col { align-self: flex-start; }
.sticky-panel {
  position: sticky;
  top: 72px;
  /* reduced height (~30% less than full page) */
  max-height: calc(70vh - 72px);
  overflow: auto;
  scrollbar-width: thin;
}
.sticky-panel::-webkit-scrollbar { width: 8px; }
.sticky-panel::-webkit-scrollbar-thumb {
  background: rgba(100,116,139,.35);
  border-radius: 8px;
}
/* Disable sticky on small screens */
@media (max-width: 959.98px) {
  .sticky-panel {
    position: static;
    max-height: none;
    overflow: visible;
  }
}

/* ───── soft boxed check items (Menu & Allergies in Section 3) ───── */
.checkbox-box {
  background: #f9fafb;
  border: 1px solid rgba(100,116,139,.20);
  border-radius: 8px;
  padding: 2px 8px;
  transition: background .2s, border-color .2s, box-shadow .2s;
}
.checkbox-box:hover {
  background: #f3f4f6;
  border-color: rgba(100,116,139,.35);
}
.checkbox-box:focus-within {
  box-shadow: 0 0 0 3px rgba(34,197,94,.15);
}

/* checked state */
.checkbox-box.is-checked {
  background: #ecfdf5;
  border-color: #16a34a;
}
.checkbox-box.is-checked :deep(.v-label) {
  font-weight: 600;
  color: #16a34a !important;
}

/* compact the internal v-checkbox */
.checkbox-box :deep(.v-selection-control) { min-height: 30px; }
.checkbox-box :deep(.v-selection-control__wrapper) { padding-inline: 4px; }
.checkbox-box :deep(.v-label) { font-size: .9rem; }

/* also tint the native checkbox control when checked */
.checkbox-box.is-checked :deep(.v-selection-control__input) { --v-theme-primary: #16a34a; }
</style>
