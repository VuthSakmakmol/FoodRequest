<!-- src/views/expat/RequestLeave.vue -->
<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { subscribeEmployeeIfNeeded, onSocket } from '@/utils/socket'

const emit = defineEmits(['submitted'])
const { showToast } = useToast()

/* ───────── Employee identity for realtime ───────── */
const employeeId = ref((localStorage.getItem('employeeId') || '').toString())

/* ───────── LEAVE TYPES (Expat holiday only) ───────── */

const loadingTypes = ref(false)
const leaveTypes = ref([])
const typesError = ref('')

async function fetchLeaveTypes() {
  try {
    loadingTypes.value = true
    typesError.value = ''

    const res = await api.get('/leave/types')
    let data = Array.isArray(res.data) ? res.data : []

    // Optional: only show active types if backend sends isActive
    data = data.filter(t => t.isActive !== false)

    leaveTypes.value = data

    if (!data.length) {
      typesError.value =
        'No holiday leave types configured yet. Please contact HR / Admin.'
    }
  } catch (e) {
    console.error('fetchLeaveTypes error', e)
    typesError.value =
      e?.response?.data?.message ||
      'Unable to load holiday leave types. Please contact HR / Admin.'
    leaveTypes.value = []
  } finally {
    loadingTypes.value = false
  }
}

/* ───────── NEW EXPAT HOLIDAY LEAVE REQUEST ───────── */

const form = ref({
  leaveTypeCode: '',
  startDate: '',
  endDate: '',
  reason: ''
})

const submitting = ref(false)
const formError = ref('')
const formSuccess = ref('')

const hasBasicFields = computed(
  () =>
    !!form.value.leaveTypeCode &&
    !!form.value.startDate &&
    !!form.value.endDate
)

const canSubmit = computed(() => hasBasicFields.value && !submitting.value)

function resetForm() {
  form.value = {
    leaveTypeCode: '',
    startDate: '',
    endDate: '',
    reason: ''
  }
  formError.value = ''
  formSuccess.value = ''
}

async function submitRequest() {
  if (!canSubmit.value) return

  formError.value = ''
  formSuccess.value = ''

  // Front-end validation: start <= end
  if (form.value.startDate > form.value.endDate) {
    formError.value = 'End date cannot be earlier than start date.'
    return
  }

  submitting.value = true

  try {
    const payload = {
      leaveTypeCode: form.value.leaveTypeCode,
      startDate: form.value.startDate,
      endDate: form.value.endDate,
      reason: form.value.reason || ''
    }

    await api.post('/leave/requests', payload)

    formSuccess.value = 'Holiday leave request submitted successfully.'
    showToast({
      type: 'success',
      title: 'Submitted',
      message: 'Your expat holiday leave request has been sent for approval.'
    })

    resetForm()
    emit('submitted') // parent can refresh MyRequests immediately
  } catch (e) {
    console.error('submitRequest error', e)
    const msg = e?.response?.data?.message || 'Failed to submit leave request.'
    formError.value = msg
    showToast({
      type: 'error',
      title: 'Submit failed',
      message: msg
    })
  } finally {
    submitting.value = false
  }
}

/* ───────── Realtime: subscribe + listeners ───────── */

const offHandlers = []

function setupRealtime() {
  if (!employeeId.value) return

  // join employee:<id> room so backend emits reach this browser
  subscribeEmployeeIfNeeded(employeeId.value)

  // Manager decision (PENDING_MANAGER → PENDING_GM / REJECTED)
  const offManager = onSocket('leave:req:manager-decision', (payload = {}) => {
    const emp = String(payload.employeeId || '')
    if (emp !== employeeId.value) return

    const status = String(payload.status || '')
    if (status === 'PENDING_GM') {
      showToast({
        type: 'success',
        title: 'Manager approved',
        message: 'Your leave request has been approved by your manager and sent to GM.'
      })
    } else if (status === 'REJECTED') {
      showToast({
        type: 'error',
        title: 'Manager rejected',
        message: 'Your leave request has been rejected by your manager.'
      })
    }
  })

  // GM decision (PENDING_GM → APPROVED / REJECTED)
  const offGm = onSocket('leave:req:gm-decision', (payload = {}) => {
    const emp = String(payload.employeeId || '')
    if (emp !== employeeId.value) return

    const status = String(payload.status || '')
    if (status === 'APPROVED') {
      showToast({
        type: 'success',
        title: 'GM approved',
        message: 'Your leave request has been approved by GM.'
      })
    } else if (status === 'REJECTED') {
      showToast({
        type: 'error',
        title: 'GM rejected',
        message: 'Your leave request has been rejected by GM.'
      })
    }
  })

  offHandlers.push(offManager, offGm)
}

/* INIT */
onMounted(async () => {
  await fetchLeaveTypes()
  setupRealtime()
})

onBeforeUnmount(() => {
  offHandlers.forEach(off => {
    try { off && off() } catch {}
  })
})
</script>

<template>
  <div class="px-1 py-1 sm:px-3">
    <div
      class="rounded-2xl border border-slate-200 bg-white shadow-sm
             dark:border-slate-800 dark:bg-slate-900"
    >
      <!-- Gradient header -->
      <div
        class="rounded-t-2xl bg-gradient-to-r from-sky-600 via-sky-500 to-indigo-500
               px-4 py-3 text-white"
      >
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p class="text-[10px] uppercase tracking-[0.25em] text-sky-100/80">
              Expat Holiday
            </p>
            <h2 class="text-sm font-semibold">
              Request Holiday Leave
            </h2>
            <p class="mt-0.5 text-[11px] text-sky-50/90">
              Use this form to request holiday leave as a foreign employee
              (not for flight booking).
            </p>
          </div>

          <div
            class="mt-1 flex items-center gap-2 rounded-xl bg-sky-900/30 px-3 py-2
                   text-[11px]"
          >
            <div
              class="flex h-8 w-8 items-center justify-center rounded-full
                     bg-sky-100/90 text-sky-700 shadow-sm
                     dark:bg-sky-900/80 dark:text-sky-100"
            >
              <i class="fa-solid fa-umbrella-beach text-sm" />
            </div>
            <div class="space-y-0.5">
              <p class="font-medium text-sky-50">
                Plan ahead
              </p>
              <p class="text-[11px] text-sky-100/80">
                Submit leave before booking flights or long holidays.
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Body -->
      <div class="px-3 pb-3 pt-3 sm:px-4 sm:pb-4">
        <!-- Types error banner -->
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
            <label
              for="leaveType"
              class="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Holiday Leave Type
            </label>
            <div class="relative">
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
                  {{ loadingTypes ? 'Loading holiday types…' : 'Select holiday leave type' }}
                </option>
                <option
                  v-for="t in leaveTypes"
                  :key="t.code"
                  :value="t.code"
                >
                  {{ t.name }} ({{ t.code }})
                </option>
              </select>
            </div>
            <p class="text-[11px] text-slate-500 dark:text-slate-400">
              These options are configured by HR / Admin for expat holiday entitlement.
            </p>
          </div>

          <!-- Start date -->
          <div class="space-y-1.5">
            <label
              for="startDate"
              class="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
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
          </div>

          <!-- End date -->
          <div class="space-y-1.5">
            <label
              for="endDate"
              class="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              End Date
            </label>
            <input
              id="endDate"
              v-model="form.endDate"
              type="date"
              class="block w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs sm:text-sm
                     shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                     dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            <p class="text-[11px] text-slate-500 dark:text-slate-400">
              Inclusive of both start and end dates.
            </p>
          </div>

          <!-- Reason -->
          <div class="space-y-1.5">
            <label
              for="reason"
              class="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
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
            <p
              v-if="formError"
              class="text-[11px] text-rose-600 dark:text-rose-400"
            >
              {{ formError }}
            </p>
            <p
              v-if="formSuccess"
              class="text-[11px] text-emerald-600 dark:text-emerald-400"
            >
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
                <i class="fa-solid fa-spinner animate-spin text-[11px]"></i>
              </span>
              <span>Submit Request</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
