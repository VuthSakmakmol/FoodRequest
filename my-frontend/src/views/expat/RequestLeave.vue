<!-- src/views/expat/RequestLeave.vue
  ✅ Uses your global design system from:
     - src/assets/main.css (Kantumruy Pro for all)
     - src/assets/tailwind.css (ui-* components/tokens)
  ✅ Compact “app-like” cards with icons
  ✅ Supports:
     - Single-day half: AM/PM
     - Multi-day half edges: startHalf/endHalf
  ✅ Payload rules:
     - multi-day => startHalf/endHalf
     - single-day half => legacy isHalfDay/dayPart + also startHalf (safe)
  ✅ After success -> redirect to MyRequests (by PATH, not name)
-->

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { subscribeEmployeeIfNeeded, subscribeUserIfNeeded, onSocket } from '@/utils/socket'
import UserLeaveProfile from '@/views/expat/user/UserLeaveProfile.vue'

defineOptions({ name: 'RequestLeave' })

const router = useRouter()
const { showToast } = useToast()

// ✅ CHANGE to your real route path
const MY_REQUESTS_PATH = '/leave/user/my-requests'

/* ───────── Identity (for realtime only, NOT required to submit) ───────── */
const employeeId = ref(String(localStorage.getItem('employeeId') || '').trim())
const loginId = ref(String(localStorage.getItem('loginId') || '').trim())
const realtimeReady = ref(false)

/* ───────── Leave types ───────── */
const loadingTypes = ref(false)
const leaveTypes = ref([])
const typesError = ref('')

function typeLabel(t) {
  const name = String(t?.name || '').trim()
  const code = String(t?.code || '').trim().toUpperCase()
  if (!code) return name
  const endsWithCode = new RegExp(`\\(\\s*${code}\\s*\\)$`, 'i').test(name)
  return endsWithCode ? name : `${name} (${code})`
}

async function fetchLeaveTypes() {
  try {
    loadingTypes.value = true
    typesError.value = ''
    const res = await api.get('/leave/types')
    let data = Array.isArray(res.data) ? res.data : []
    data = data.filter((t) => t.isActive !== false)
    leaveTypes.value = data
    if (!data.length) typesError.value = 'No leave types configured. Please contact HR/Admin.'
  } catch (e) {
    console.error('fetchLeaveTypes error', e)
    typesError.value = e?.response?.data?.message || 'Unable to load leave types.'
    leaveTypes.value = []
  } finally {
    loadingTypes.value = false
  }
}

/* ───────── Form ───────── */
const form = ref({
  leaveTypeCode: '',
  startDate: '',
  endDate: '',
  reason: '',

  // half mode
  useHalf: false,

  // single-day half
  singleHalf: '', // 'AM' | 'PM'

  // multi-day half edges
  halfStartEnabled: false,
  halfStartPart: '', // 'AM' | 'PM'
  halfEndEnabled: false,
  halfEndPart: '', // 'AM' | 'PM'
})

const submitting = ref(false)
const formError = ref('')
const formSuccess = ref('')

const selectedType = computed(() => {
  const code = String(form.value.leaveTypeCode || '').toUpperCase()
  return leaveTypes.value.find((t) => String(t.code || '').toUpperCase() === code) || null
})

const isMA = computed(() => String(form.value.leaveTypeCode || '').toUpperCase() === 'MA')

const isMultiDay = computed(() => {
  if (!form.value.startDate || !form.value.endDate) return false
  return form.value.endDate > form.value.startDate
})

const canSubmit = computed(() => {
  if (submitting.value || loadingTypes.value) return false
  if (!form.value.leaveTypeCode) return false
  if (!form.value.startDate) return false
  if (!form.value.endDate) return false
  if (!isMA.value && form.value.endDate < form.value.startDate) return false

  if (!form.value.useHalf) return true

  // MA: half not allowed
  if (isMA.value) return false

  // half enabled
  if (!isMultiDay.value) {
    // single-day: require AM/PM
    return !!form.value.singleHalf
  }

  // multi-day: require at least one edge enabled
  if (!form.value.halfStartEnabled && !form.value.halfEndEnabled) return false
  if (form.value.halfStartEnabled && !form.value.halfStartPart) return false
  if (form.value.halfEndEnabled && !form.value.halfEndPart) return false
  return true
})

function resetForm() {
  form.value = {
    leaveTypeCode: '',
    startDate: '',
    endDate: '',
    reason: '',
    useHalf: false,
    singleHalf: '',
    halfStartEnabled: false,
    halfStartPart: '',
    halfEndEnabled: false,
    halfEndPart: '',
  }
  formError.value = ''
  formSuccess.value = ''
}

/* ───────── Keep dates safe ───────── */
watch(
  () => [form.value.startDate, form.value.leaveTypeCode],
  () => {
    if (!form.value.startDate) return

    if (isMA.value) {
      // MA: fixed start day input; backend computes +90 days
      form.value.endDate = form.value.startDate

      // MA: half not allowed
      form.value.useHalf = false
      form.value.singleHalf = ''
      form.value.halfStartEnabled = false
      form.value.halfStartPart = ''
      form.value.halfEndEnabled = false
      form.value.halfEndPart = ''
      return
    }

    if (!form.value.endDate) form.value.endDate = form.value.startDate
    if (form.value.endDate < form.value.startDate) form.value.endDate = form.value.startDate
  }
)

watch(
  () => form.value.endDate,
  () => {
    if (!form.value.startDate) return
    if (!form.value.endDate) form.value.endDate = form.value.startDate
    if (!isMA.value && form.value.endDate < form.value.startDate) form.value.endDate = form.value.startDate
  }
)

/* ───────── Half toggle behavior ───────── */
watch(
  () => form.value.useHalf,
  (on) => {
    if (!on) {
      form.value.singleHalf = ''
      form.value.halfStartEnabled = false
      form.value.halfStartPart = ''
      form.value.halfEndEnabled = false
      form.value.halfEndPart = ''
      return
    }

    // if turning on while multi-day, enable start edge by default
    if (isMultiDay.value && !form.value.halfStartEnabled && !form.value.halfEndEnabled) {
      form.value.halfStartEnabled = true
    }
  }
)

watch(
  () => [form.value.startDate, form.value.endDate],
  () => {
    if (!form.value.useHalf) return
    if (isMultiDay.value) {
      // multi-day mode: disable single half
      form.value.singleHalf = ''
      if (!form.value.halfStartEnabled && !form.value.halfEndEnabled) form.value.halfStartEnabled = true
    } else {
      // single-day mode: disable edges
      form.value.halfStartEnabled = false
      form.value.halfStartPart = ''
      form.value.halfEndEnabled = false
      form.value.halfEndPart = ''
    }
  }
)

function toggleEdge(edge) {
  if (edge === 'start') {
    form.value.halfStartEnabled = !form.value.halfStartEnabled
    if (!form.value.halfStartEnabled) form.value.halfStartPart = ''
  }
  if (edge === 'end') {
    form.value.halfEndEnabled = !form.value.halfEndEnabled
    if (!form.value.halfEndEnabled) form.value.halfEndPart = ''
  }
}

function pickPart(target, val) {
  if (target === 'single') form.value.singleHalf = val
  if (target === 'start') form.value.halfStartPart = val
  if (target === 'end') form.value.halfEndPart = val
}

/* ───────── Submit ───────── */
async function submitRequest() {
  if (!canSubmit.value) {
    formError.value = 'Please complete required fields.'
    return
  }

  formError.value = ''
  formSuccess.value = ''

  // friendly checks
  if (!form.value.leaveTypeCode) return (formError.value = 'Please select leave type.')
  if (!form.value.startDate) return (formError.value = 'Please select start date.')
  if (!form.value.endDate) return (formError.value = 'Please select end date.')
  if (!isMA.value && form.value.endDate < form.value.startDate) return (formError.value = 'End date cannot be earlier than start date.')

  if (form.value.useHalf && !isMA.value) {
    if (!isMultiDay.value) {
      if (!form.value.singleHalf) return (formError.value = 'Please choose AM or PM.')
    } else {
      if (!form.value.halfStartEnabled && !form.value.halfEndEnabled) return (formError.value = 'Choose half on Start day or End day.')
      if (form.value.halfStartEnabled && !form.value.halfStartPart) return (formError.value = 'Choose AM/PM for Start day half.')
      if (form.value.halfEndEnabled && !form.value.halfEndPart) return (formError.value = 'Choose AM/PM for End day half.')
    }
  }

  submitting.value = true
  try {
    const payload = {
      leaveTypeCode: form.value.leaveTypeCode,
      startDate: form.value.startDate,
      endDate: isMA.value ? form.value.startDate : form.value.endDate,
      reason: form.value.reason || '',
    }

    if (!isMA.value && form.value.useHalf) {
      if (!isMultiDay.value) {
        // single-day half (legacy + new-safe)
        const part = String(form.value.singleHalf || '').toUpperCase()
        payload.isHalfDay = true
        payload.dayPart = part
        payload.startHalf = part
        payload.endHalf = null
      } else {
        // multi-day edges
        payload.isHalfDay = false
        payload.dayPart = ''
        payload.startHalf = form.value.halfStartEnabled ? String(form.value.halfStartPart || '').toUpperCase() : null
        payload.endHalf = form.value.halfEndEnabled ? String(form.value.halfEndPart || '').toUpperCase() : null
      }
    } else {
      payload.isHalfDay = false
      payload.dayPart = ''
      payload.startHalf = null
      payload.endHalf = null
    }

    console.log('[RequestLeave] submit payload:', payload)

    await api.post('/leave/requests', payload)

    showToast({ type: 'success', title: 'Submitted', message: 'Your request has been sent for approval.' })
    formSuccess.value = 'Submitted successfully.'
    resetForm()

    router.push(MY_REQUESTS_PATH)
  } catch (e) {
    console.error('submitRequest error', e)
    const msg = e?.response?.data?.message || 'Failed to submit leave request.'
    formError.value = msg
    showToast({ type: 'error', title: 'Submit failed', message: msg })
  } finally {
    submitting.value = false
  }
}

/* ───────── Realtime (optional) ───────── */
const offHandlers = []

function ensureRealtime() {
  const emp = String(employeeId.value || '').trim()
  const log = String(loginId.value || '').trim()

  if (emp) subscribeEmployeeIfNeeded(emp)
  if (log) subscribeUserIfNeeded(log)

  realtimeReady.value = !!(emp || log)
}

function isMine(payload = {}) {
  const emp = String(payload.employeeId || '').trim()
  const reqr = String(payload.requesterLoginId || '').trim()
  return (employeeId.value && emp === employeeId.value) || (loginId.value && reqr === loginId.value)
}

function setupRealtimeListeners() {
  offHandlers.push(
    onSocket('leave:req:updated', (p = {}) => { if (isMine(p)) {/* no-op */} }),
    onSocket('leave:profile:updated', (p = {}) => { if (isMine(p)) {/* no-op */} })
  )
}

watch(() => String(localStorage.getItem('employeeId') || '').trim(), (v) => { employeeId.value = v })
watch(() => String(localStorage.getItem('loginId') || '').trim(), (v) => { loginId.value = v })

onMounted(async () => {
  await fetchLeaveTypes()
  ensureRealtime()
  setupRealtimeListeners()
})

onBeforeUnmount(() => {
  offHandlers.forEach((off) => { try { off && off() } catch {} })
})
</script>

<template>
  <div class="ui-page">
    <div class="ui-container py-2">
            <div class="mb-2">
        <UserLeaveProfile />
      </div>

      <!-- Main container card -->
      <div class="ui-card overflow-hidden">
        <!-- uses your existing gradient header -->
        <div class="ui-hero-gradient">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <div class="grid h-9 w-9 place-items-center rounded-2xl bg-white/15">
                <i class="fa-solid fa-wand-magic-sparkles" />
              </div>
              <div>
                <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Request Leave</div>
              </div>
            </div>
            <div class="text-[11px] font-semibold opacity-90">
              {{ isMA ? 'MA: 90 days auto' : 'Select dates' }}
            </div>
          </div>
        </div>

        <div class="p-3">
          <div
            v-if="typesError"
            class="mb-2 rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-900
                   dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200"
          >
            {{ typesError }}
          </div>

          <form class="space-y-2.5" @submit.prevent="submitRequest">
            <!-- Leave type -->
            <div class="ui-card p-3">
              <div class="ui-row">
                <div class="ui-ico"><i class="fa-solid fa-layer-group" /></div>
                <div class="flex-1">
                  <div class="ui-label">Leave Type</div>
                  <select v-model="form.leaveTypeCode" :disabled="loadingTypes || !leaveTypes.length" class="ui-select">
                    <option value="" disabled>{{ loadingTypes ? 'Loading…' : 'Select leave type' }}</option>
                    <option v-for="t in leaveTypes" :key="t.code" :value="t.code">{{ typeLabel(t) }}</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Dates -->
            <div class="ui-card p-3">
              <div class="grid gap-2 sm:grid-cols-2">
                <div class="ui-row">
                  <div class="ui-ico"><i class="fa-solid fa-play" /></div>
                  <div class="flex-1">
                    <div class="ui-label">Start Date</div>

                    <!-- ✅ use your date picker style -->
                    <input
                      v-model="form.startDate"
                      type="date"
                      class="ui-date"
                    />
                  </div>
                </div>

                <div class="ui-row">
                  <div class="ui-ico"><i class="fa-solid fa-flag-checkered" /></div>
                  <div class="flex-1">
                    <div class="ui-label">End Date</div>

                    <!-- ✅ use your date picker style + MA disabled behavior -->
                    <input
                      v-model="form.endDate"
                      type="date"
                      :disabled="isMA"
                      class="ui-date disabled:opacity-70 disabled:cursor-not-allowed"
                    />
                  </div>
                </div>
              </div>

              <div v-if="isMA" class="mt-2 text-[11px] text-slate-600 dark:text-slate-300">
                <span class="ui-badge ui-badge-warning">MA</span>
                System will auto-calculate end date = start + 90 days.
              </div>
            </div>


            <!-- Half options -->
            <div class="ui-card p-3">
              <div class="ui-row">
                <div class="ui-ico"><i class="fa-solid fa-clock" /></div>

                <div class="flex-1">
                  <div class="flex items-center justify-between gap-2">
                    <div>
                      <div class="ui-label">Half-day</div>
                      <div class="text-[11px] text-slate-500 dark:text-slate-400">Choose AM/PM</div>
                    </div>

                    <label class="inline-flex items-center gap-2 text-[11px] font-extrabold text-slate-700 dark:text-slate-200">
                      <input
                        v-model="form.useHalf"
                        type="checkbox"
                        :disabled="isMA"
                        class="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500 disabled:opacity-60
                               dark:border-slate-700 dark:bg-slate-900"
                      />
                      Enable
                    </label>
                  </div>

                  <!-- single-day AM/PM -->
                  <div v-if="form.useHalf && !isMA && !isMultiDay" class="mt-2 grid grid-cols-2 gap-2">
                    <button type="button" class="ui-chip" :class="form.singleHalf === 'AM' ? 'ui-chip-am' : ''" @click="pickPart('single','AM')">
                      <i class="fa-solid fa-sun" /> AM
                    </button>
                    <button type="button" class="ui-chip" :class="form.singleHalf === 'PM' ? 'ui-chip-pm' : ''" @click="pickPart('single','PM')">
                      <i class="fa-solid fa-moon" /> PM
                    </button>
                  </div>

                  <!-- multi-day edges -->
                  <div v-if="form.useHalf && !isMA && isMultiDay" class="mt-2 space-y-2">
                    <div class="grid grid-cols-2 gap-2">
                      <button type="button" class="ui-chip" :class="form.halfStartEnabled ? 'ui-chip-on' : ''" @click="toggleEdge('start')">
                        <i class="fa-solid fa-play" /> Half of Start Date
                      </button>
                      <button type="button" class="ui-chip" :class="form.halfEndEnabled ? 'ui-chip-on' : ''" @click="toggleEdge('end')">
                        <i class="fa-solid fa-flag" /> Half of End Date
                      </button>
                    </div>

                    <div v-if="form.halfStartEnabled" class="grid grid-cols-2 gap-2">
                      <button type="button" class="ui-chip" :class="form.halfStartPart === 'AM' ? 'ui-chip-am' : ''" @click="pickPart('start','AM')">AM</button>
                      <button type="button" class="ui-chip" :class="form.halfStartPart === 'PM' ? 'ui-chip-pm' : ''" @click="pickPart('start','PM')">PM</button>
                    </div>

                    <div v-if="form.halfEndEnabled" class="grid grid-cols-2 gap-2">
                      <button type="button" class="ui-chip" :class="form.halfEndPart === 'AM' ? 'ui-chip-am' : ''" @click="pickPart('end','AM')">AM</button>
                      <button type="button" class="ui-chip" :class="form.halfEndPart === 'PM' ? 'ui-chip-pm' : ''" @click="pickPart('end','PM')">PM</button>
                    </div>
                  </div>

                  <div v-if="isMA && form.useHalf" class="mt-2 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                    MA does not support half-day.
                  </div>
                </div>
              </div>
            </div>

            <!-- Reason -->
            <div class="ui-card p-3">
              <div class="ui-row">
                <div class="ui-ico"><i class="fa-solid fa-pen" /></div>
                <div class="flex-1">
                  <div class="ui-label">Reason</div>
                  <textarea v-model="form.reason" rows="2" class="ui-textarea" placeholder="Optional…" />
                </div>
              </div>
            </div>

            <!-- messages -->
            <div v-if="formError" class="text-[11px] font-extrabold text-rose-600 dark:text-rose-400">{{ formError }}</div>
            <div v-if="formSuccess" class="text-[11px] font-extrabold text-emerald-600 dark:text-emerald-300">{{ formSuccess }}</div>

            <!-- actions -->
            <div class="mt-2 flex items-center justify-end gap-2">
              <button type="button" class="ui-btn ui-btn-soft" :disabled="submitting" @click="resetForm">
                <i class="fa-solid fa-arrow-rotate-left" /> Reset
              </button>

              <button type="submit" class="ui-btn ui-btn-primary" :disabled="!canSubmit">
                <i v-if="submitting" class="fa-solid fa-spinner animate-spin" />
                <i v-else class="fa-solid fa-paper-plane" />
                Submit
              </button>
            </div>

            <div v-if="selectedType" class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              <span class="font-extrabold text-slate-800 dark:text-slate-100">{{ selectedType.name }}</span>
              <span class="opacity-80"> — {{ selectedType.description || 'Follow company policy.' }}</span>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Keep empty: this view relies on main.css + tailwind.css ui-* */
</style>
