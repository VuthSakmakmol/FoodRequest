<!-- src/views/expat/RequestLeave.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { subscribeEmployeeIfNeeded, onSocket } from '@/utils/socket'

import UserLeaveProfile from '@/views/expat/user/UserLeaveProfile.vue'

defineOptions({ name: 'RequestLeave' })

const emit = defineEmits(['submitted'])
const { showToast } = useToast()

/* ───────── Employee identity for realtime ─────────
 * Prefer localStorage employeeId (your system uses employeeId rooms).
 */
const employeeId = ref(String(localStorage.getItem('employeeId') || '').trim())

/* ───────── Force refresh for profile component on realtime ───────── */
const profileTick = ref(0)

/* ───────── LEAVE TYPES (Expat only) ───────── */
const loadingTypes = ref(false)
const leaveTypes = ref([])
const typesError = ref('')

function typeLabel(t) {
  const name = String(t?.name || '').trim()
  const code = String(t?.code || '').trim().toUpperCase()
  if (!code) return name

  const endsWithCode = new RegExp(`\\(\\s*${code}\\s*\\)$`, 'i').test(name)
  if (endsWithCode) return name

  return `${name} (${code})`
}

async function fetchLeaveTypes() {
  try {
    loadingTypes.value = true
    typesError.value = ''

    const res = await api.get('/leave/types')
    let data = Array.isArray(res.data) ? res.data : []

    // Optional: only show active types if backend sends isActive
    data = data.filter((t) => t.isActive !== false)

    leaveTypes.value = data

    if (!data.length) {
      typesError.value = 'No leave types configured yet. Please contact HR / Admin.'
    }
  } catch (e) {
    console.error('fetchLeaveTypes error', e)
    typesError.value =
      e?.response?.data?.message ||
      'Unable to load leave types. Please contact HR / Admin.'
    leaveTypes.value = []
  } finally {
    loadingTypes.value = false
  }
}

/* ───────── NEW EXPAT LEAVE REQUEST ───────── */
const form = ref({
  leaveTypeCode: '',
  startDate: '',
  endDate: '',
  isHalfDay: false,
  dayPart: '', // 'AM' | 'PM'
  reason: '',
})

const submitting = ref(false)
const formError = ref('')
const formSuccess = ref('')

const selectedType = computed(() => {
  const code = String(form.value.leaveTypeCode || '').toUpperCase()
  return (
    leaveTypes.value.find((t) => String(t.code || '').toUpperCase() === code) ||
    null
  )
})

const isMA = computed(
  () => String(form.value.leaveTypeCode || '').toUpperCase() === 'MA'
)

const hasBasicFields = computed(() => {
  if (!form.value.leaveTypeCode) return false
  if (!form.value.startDate) return false

  if (form.value.isHalfDay) {
    return !!form.value.dayPart
  }
  return !!form.value.endDate
})

const canSubmit = computed(() => hasBasicFields.value && !submitting.value)

function resetForm() {
  form.value = {
    leaveTypeCode: '',
    startDate: '',
    endDate: '',
    isHalfDay: false,
    dayPart: '',
    reason: '',
  }
  formError.value = ''
  formSuccess.value = ''
}

/* Keep endDate synced for half-day */
watch(
  () => [form.value.isHalfDay, form.value.startDate],
  () => {
    if (form.value.isHalfDay) {
      form.value.endDate = form.value.startDate || ''
    } else {
      if (form.value.startDate && !form.value.endDate) {
        form.value.endDate = form.value.startDate
      }
    }
  }
)

/* If leave type changes, keep safe */
watch(
  () => form.value.leaveTypeCode,
  () => {
    if (!form.value.isHalfDay) form.value.dayPart = ''
  }
)

async function submitRequest() {
  if (!canSubmit.value) return

  formError.value = ''
  formSuccess.value = ''

  // Front-end validation
  if (!form.value.isHalfDay) {
    if (!form.value.endDate) {
      formError.value = 'Please select an end date.'
      return
    }
    if (form.value.startDate > form.value.endDate) {
      formError.value = 'End date cannot be earlier than start date.'
      return
    }
  } else {
    if (!form.value.dayPart) {
      formError.value = 'Please select Morning or Afternoon.'
      return
    }
    if (!form.value.startDate) {
      formError.value = 'Please select a start date.'
      return
    }
  }

  submitting.value = true

  try {
    const payload = {
      leaveTypeCode: form.value.leaveTypeCode,
      startDate: form.value.startDate,
      endDate: form.value.isHalfDay ? form.value.startDate : form.value.endDate,
      reason: form.value.reason || '',
      isHalfDay: !!form.value.isHalfDay,
      dayPart: form.value.isHalfDay
        ? String(form.value.dayPart || '').toUpperCase()
        : '',
    }

    await api.post('/leave/requests', payload)

    formSuccess.value = 'Leave request submitted successfully.'
    showToast({
      type: 'success',
      title: 'Submitted',
      message: 'Your leave request has been sent for approval.',
    })

    resetForm()
    emit('submitted')
  } catch (e) {
    console.error('submitRequest error', e)
    const msg = e?.response?.data?.message || 'Failed to submit leave request.'
    formError.value = msg
    showToast({
      type: 'error',
      title: 'Submit failed',
      message: msg,
    })
  } finally {
    submitting.value = false
  }
}

/* ───────── Realtime: subscribe + listeners ───────── */
const offHandlers = []
const isRealtimeReady = ref(false)

function ensureRealtimeSub() {
  const empId = String(employeeId.value || '').trim()
  if (!empId) return

  subscribeEmployeeIfNeeded(empId)
  isRealtimeReady.value = true
}

function isMyEmp(payload = {}) {
  const emp = String(payload.employeeId || '').trim()
  return emp && emp === String(employeeId.value || '').trim()
}

function setupRealtimeListeners() {
  // Manager decision
  const offManager = onSocket('leave:req:manager-decision', (payload = {}) => {
    if (!isMyEmp(payload)) return

    const status = String(payload.status || '').trim().toUpperCase()
    if (status === 'PENDING_GM') {
      showToast({
        type: 'success',
        title: 'Manager approved',
        message: 'Your leave request was approved by manager and sent to GM.',
      })
    } else if (status === 'REJECTED') {
      showToast({
        type: 'error',
        title: 'Manager rejected',
        message: 'Your leave request was rejected by your manager.',
      })
    }

    profileTick.value += 1
  })

  // GM decision
  const offGm = onSocket('leave:req:gm-decision', (payload = {}) => {
    if (!isMyEmp(payload)) return

    const status = String(payload.status || '').trim().toUpperCase()
    if (status === 'APPROVED') {
      showToast({
        type: 'success',
        title: 'GM approved',
        message: 'Your leave request was approved by GM.',
      })
    } else if (status === 'REJECTED') {
      showToast({
        type: 'error',
        title: 'GM rejected',
        message: 'Your leave request was rejected by GM.',
      })
    }

    profileTick.value += 1
  })

  // Generic updates (cancel / admin edits / etc.)
  const offUpdated = onSocket('leave:req:updated', (payload = {}) => {
    if (!isMyEmp(payload)) return

    const status = String(payload.status || '').trim().toUpperCase()
    if (status === 'CANCELLED') {
      showToast({
        type: 'info',
        title: 'Cancelled',
        message: 'Your leave request was cancelled.',
      })
      profileTick.value += 1
    }
  })

  // Profile updated (balances refresh)
  const offProfile = onSocket('leave:profile:updated', (payload = {}) => {
    if (!isMyEmp(payload)) return
    profileTick.value += 1
  })

  offHandlers.push(offManager, offGm, offUpdated, offProfile)
}

/* EmployeeId may appear after login -> keep subscribing */
watch(
  () => String(localStorage.getItem('employeeId') || '').trim(),
  (v) => {
    if (v && v !== employeeId.value) employeeId.value = v
  }
)

watch(
  () => employeeId.value,
  (v) => {
    if (!v) return
    ensureRealtimeSub()
  },
  { immediate: true }
)

onMounted(async () => {
  await fetchLeaveTypes()
  ensureRealtimeSub()
  setupRealtimeListeners()
})

onBeforeUnmount(() => {
  offHandlers.forEach((off) => {
    try {
      off && off()
    } catch {}
  })
})
</script>

<template>
  <div class="px-1 py-1 sm:px-3 space-y-3">
    <UserLeaveProfile :key="profileTick" />

    <div class="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div class="rounded-t-2xl ui-hero-gradient">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 class="text-sm font-semibold">Request Leave</h2>
            <p class="mt-0.5 text-[11px] text-sky-50/90">
              Use this form to request leave as a foreign employee
            </p>
          </div>

          <div class="mt-1 flex items-center gap-2 rounded-xl bg-sky-900/30 px-3 py-2 text-[11px]">
            <div class="flex h-8 w-8 items-center justify-center rounded-full bg-sky-100/90 text-sky-700 shadow-sm dark:bg-sky-900/80 dark:text-sky-100">
              <i class="fa-solid fa-umbrella-beach text-sm" />
            </div>
            <div class="space-y-0.5">
              <p class="font-medium text-sky-50">Plan ahead</p>
              <p class="text-[10px] text-sky-100/80">Half-day supported</p>
            </div>
          </div>
        </div>
      </div>

      <div class="px-3 pb-3 pt-3 sm:px-4 sm:pb-4">
        <div
          v-if="typesError"
          class="mb-3 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-[11px]
                 text-amber-800 dark:border-amber-500/70 dark:bg-amber-950/40 dark:text-amber-100"
        >
          {{ typesError }}
        </div>

        <form class="space-y-3" @submit.prevent="submitRequest">
          <!-- Leave type -->
          <div class="space-y-1.5">
            <label for="leaveType" class="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Leave Type
            </label>

            <select
              id="leaveType"
              v-model="form.leaveTypeCode"
              :disabled="loadingTypes || !leaveTypes.length"
              class="block w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs sm:text-sm
                     shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                     disabled:cursor-not-allowed disabled:bg-slate-100
                     dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800"
            >
              <option value="" disabled>
                {{ loadingTypes ? 'Loading leave types…' : 'Select leave type' }}
              </option>
              <option v-for="t in leaveTypes" :key="t.code" :value="t.code">
                {{ typeLabel(t) }}
              </option>
            </select>

            <p class="text-[11px] text-slate-500 dark:text-slate-400">
              These options are configured by HR / Admin for expat leave.
              <span v-if="isMA" class="font-semibold text-slate-700 dark:text-slate-200">
                MA is fixed 90 days (system will auto-calculate).
              </span>
            </p>
          </div>

          <!-- Half-day toggle -->
          <div class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/40">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <div class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-900/60 dark:text-sky-200">
                  <i class="fa-solid fa-clock text-sm" />
                </div>
                <div>
                  <p class="text-xs font-semibold text-slate-900 dark:text-slate-50">Half-day</p>
                  <p class="text-[11px] text-slate-500 dark:text-slate-400">
                    Choose Morning or Afternoon (0.5 day).
                  </p>
                </div>
              </div>

              <label class="inline-flex cursor-pointer items-center gap-2 text-[11px] text-slate-700 dark:text-slate-200">
                <input
                  v-model="form.isHalfDay"
                  type="checkbox"
                  class="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-900"
                />
                <span>Enable half-day</span>
              </label>
            </div>

            <!-- Day part -->
            <div v-if="form.isHalfDay" class="mt-2 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                class="rounded-xl border px-3 py-2 text-left text-[12px] font-semibold shadow-sm transition dark:shadow-none"
                :class="form.dayPart === 'AM'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'
                  : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-900/70'"
                @click="form.dayPart = 'AM'"
              >
                <div class="flex items-center gap-2">
                  <i class="fa-solid fa-sun text-[12px]" />
                  <div>
                    <div>Morning</div>
                    <div class="text-[10px] font-medium opacity-75">AM</div>
                  </div>
                </div>
              </button>

              <button
                type="button"
                class="rounded-xl border px-3 py-2 text-left text-[12px] font-semibold shadow-sm transition dark:shadow-none"
                :class="form.dayPart === 'PM'
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200'
                  : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-900/70'"
                @click="form.dayPart = 'PM'"
              >
                <div class="flex items-center gap-2">
                  <i class="fa-solid fa-moon text-[12px]" />
                  <div>
                    <div>Afternoon</div>
                    <div class="text-[10px] font-medium opacity-75">PM</div>
                  </div>
                </div>
              </button>

              <p v-if="form.isHalfDay && !form.dayPart" class="sm:col-span-2 text-[11px] text-rose-600 dark:text-rose-400">
                Please select Morning or Afternoon.
              </p>
            </div>
          </div>

          <!-- Dates -->
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1.5">
              <label for="startDate" class="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Start Date
              </label>
              <input
                id="startDate"
                v-model="form.startDate"
                type="date"
                class="block w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs sm:text-sm
                       shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                       dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
              <p class="text-[11px] text-slate-500 dark:text-slate-400">
                Must be a working day (Mon–Sat, not holiday).
              </p>
            </div>

            <div class="space-y-1.5">
              <label for="endDate" class="block text-xs font-medium text-slate-700 dark:text-slate-300">
                End Date
              </label>
              <input
                id="endDate"
                v-model="form.endDate"
                type="date"
                :disabled="form.isHalfDay || isMA"
                class="block w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs sm:text-sm
                       shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                       disabled:cursor-not-allowed disabled:bg-slate-100
                       dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800"
              />
              <p class="text-[11px] text-slate-500 dark:text-slate-400">
                <span v-if="form.isHalfDay">Half-day: end date is same as start date.</span>
                <span v-else-if="isMA">MA: system will set end date automatically (90 days).</span>
                <span v-else>Inclusive of both start and end dates.</span>
              </p>
            </div>
          </div>

          <!-- Reason -->
          <div class="space-y-1.5">
            <label for="reason" class="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Reason (optional)
            </label>
            <textarea
              id="reason"
              v-model="form.reason"
              rows="3"
              class="block w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs sm:text-sm
                     shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                     dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              placeholder="Example: annual family holiday, personal trip, medical check-up abroad…"
            ></textarea>
          </div>

          <!-- Inline messages -->
          <div v-if="formError || formSuccess" class="space-y-1">
            <p v-if="formError" class="text-[11px] text-rose-600 dark:text-rose-400">
              {{ formError }}
            </p>
            <p v-if="formSuccess" class="text-[11px] text-emerald-600 dark:text-emerald-400">
              {{ formSuccess }}
            </p>
          </div>

          <!-- Actions -->
          <div class="mt-3 flex justify-end gap-2">
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-3 py-1.5
                     text-xs sm:text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50
                     disabled:cursor-not-allowed disabled:opacity-60
                     dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              :disabled="submitting"
              @click="resetForm"
            >
              Reset
            </button>

            <button
              type="submit"
              class="inline-flex items-center justify-center rounded-full bg-sky-600 px-3 py-1.5 text-xs sm:text-sm
                     font-semibold text-white shadow-sm hover:bg-sky-700
                     disabled:cursor-not-allowed disabled:opacity-60
                     dark:bg-sky-500 dark:hover:bg-sky-600"
              :disabled="!canSubmit || !leaveTypes.length"
            >
              <span v-if="submitting" class="mr-1.5">
                <i class="fa-solid fa-spinner animate-spin text-[11px]" />
              </span>
              <span>Submit Request</span>
            </button>
          </div>
        </form>

        <!-- Selected type info -->
        <div
          v-if="selectedType"
          class="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600
                 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300"
        >
          <span class="font-semibold text-slate-800 dark:text-slate-100">{{ selectedType.name }}</span>
          <span class="opacity-80"> — {{ selectedType.description || 'Follow company policy and approval flow.' }}</span>
        </div>

        <div v-if="!isRealtimeReady" class="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
          Realtime is not connected yet (employeeId missing).
        </div>
      </div>
    </div>
  </div>
</template>
