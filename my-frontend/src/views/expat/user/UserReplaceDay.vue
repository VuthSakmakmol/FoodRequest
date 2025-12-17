<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { subscribeEmployeeIfNeeded, onSocket } from '@/utils/socket'

const { showToast } = useToast()

/* ───────── identity for realtime ───────── */
const employeeId = ref(String(localStorage.getItem('employeeId') || ''))

/* ───────── holidays from backend (env-based) ───────── */
const holidaySet = ref(new Set())
const loadingHolidays = ref(false)

async function fetchHolidays() {
  try {
    loadingHolidays.value = true
    const res = await api.get('/public/holidays') // expects array like ['2026-01-01', ...]
    const list = Array.isArray(res.data) ? res.data : (res.data?.holidays || [])
    holidaySet.value = new Set((list || []).map(s => String(s || '').trim()).filter(Boolean))
  } catch (e) {
    // don't block the page if holidays endpoint fails (backend still validates)
    holidaySet.value = new Set()
  } finally {
    loadingHolidays.value = false
  }
}

/* Sunday check (Mon=1 .. Sun=0 in dayjs) */
function isSunday(ymd) {
  if (!ymd) return false
  return dayjs(ymd).day() === 0
}
function isHoliday(ymd) {
  if (!ymd) return false
  return isSunday(ymd) || holidaySet.value.has(ymd)
}
function isWorkingDay(ymd) {
  // company working day = Mon–Sat (6 days), and NOT holiday set
  if (!ymd) return false
  if (isSunday(ymd)) return false
  if (holidaySet.value.has(ymd)) return false
  return true
}

/* ───────── form ───────── */
const form = ref({
  requestDate: dayjs().format('YYYY-MM-DD'),
  compensatoryDate: dayjs().add(1, 'day').format('YYYY-MM-DD'),
  reason: '',
})

const files = ref([]) // File[]
const submitting = ref(false)
const formError = ref('')
const formSuccess = ref('')

const MAX_FILES = 10
const MAX_MB = 10
const acceptHint = 'PDF/JPG/PNG • up to 10 files • max 10MB each'

const fileCountLabel = computed(() => `${files.value.length}/${MAX_FILES} files`)

const requestDateHelp = computed(() => 'Allowed any day (working day / Sunday / holiday).')

const compensatoryHelp = computed(() => {
  if (!form.value.compensatoryDate) return 'Must be Mon–Sat and not a Cambodian National Holiday.'
  if (!holidaySet.value.size && loadingHolidays.value) return 'Checking holidays...'
  if (!holidaySet.value.size && !loadingHolidays.value) return 'Must be Mon–Sat and not a Cambodian National Holiday.'
  return isWorkingDay(form.value.compensatoryDate)
    ? 'OK: working day (Mon–Sat) and not holiday.'
    : 'Invalid: must be Mon–Sat and not a holiday.'
})

const canSubmit = computed(() => {
  if (submitting.value) return false
  if (!form.value.requestDate || !form.value.compensatoryDate) return false
  // client-side check for compensatoryDate only (backend is final judge)
  if (holidaySet.value.size && !isWorkingDay(form.value.compensatoryDate)) return false
  return true
})

function resetForm() {
  form.value = {
    requestDate: dayjs().format('YYYY-MM-DD'),
    compensatoryDate: dayjs().add(1, 'day').format('YYYY-MM-DD'),
    reason: '',
  }
  files.value = []
  formError.value = ''
  formSuccess.value = ''
}

function formatMB(bytes = 0) {
  return (Number(bytes || 0) / (1024 * 1024)).toFixed(2)
}

function validateFiles(list) {
  const errs = []
  if (list.length > MAX_FILES) errs.push(`Maximum ${MAX_FILES} files allowed.`)

  for (const f of list) {
    const name = String(f?.name || '')
    const okExt = /\.(pdf|jpg|jpeg|png)$/i.test(name)
    if (!okExt) errs.push(`File not allowed: ${name} (only PDF/JPG/PNG)`)
    if (f?.size > MAX_MB * 1024 * 1024) errs.push(`File too large: ${name} (max ${MAX_MB}MB)`)
  }
  return errs
}

function onPickFiles(e) {
  const picked = Array.from(e?.target?.files || [])
  const combined = [...files.value, ...picked].slice(0, MAX_FILES)

  const errs = validateFiles(combined)
  if (errs.length) {
    formError.value = errs[0]
    showToast({ type: 'error', title: 'Upload error', message: errs[0] })
    return
  }

  files.value = combined
  formError.value = ''
}

function removeFile(idx) {
  files.value.splice(idx, 1)
}

/* ───────── submit ───────── */
async function submit() {
  if (!canSubmit.value) return

  formError.value = ''
  formSuccess.value = ''

  try {
    submitting.value = true

    const fd = new FormData()
    fd.append('requestDate', form.value.requestDate)
    fd.append('compensatoryDate', form.value.compensatoryDate)
    fd.append('reason', form.value.reason || '')

    // IMPORTANT: backend route uses evidenceUpload.array('evidence', 10)
    files.value.forEach(f => fd.append('evidence', f))

    await api.post('/leave/replace-days', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })

    formSuccess.value = 'Replace Day request submitted successfully.'
    showToast({
      type: 'success',
      title: 'Submitted',
      message: 'Your Replace Day request has been sent for approval.',
    })

    resetForm()
  } catch (e) {
    const msg = e?.response?.data?.message || 'Failed to submit Replace Day request.'
    formError.value = msg
    showToast({ type: 'error', title: 'Submit failed', message: msg })
  } finally {
    submitting.value = false
  }
}

/* ───────── realtime (optional) ───────── */
const offHandlers = []

function setupRealtime() {
  if (!employeeId.value) return
  subscribeEmployeeIfNeeded(employeeId.value)

  // If you later broadcast replace-day events, hook them here.
  // Example event names:
  // - replace:manager-decision
  // - replace:gm-decision
  const off1 = onSocket('replace:req:manager-decision', (payload = {}) => {
    if (String(payload.employeeId || '') !== employeeId.value) return
    showToast({ type: 'warning', title: 'Update', message: 'Manager updated your Replace Day request.' })
  })
  const off2 = onSocket('replace:req:gm-decision', (payload = {}) => {
    if (String(payload.employeeId || '') !== employeeId.value) return
    showToast({ type: 'warning', title: 'Update', message: 'GM updated your Replace Day request.' })
  })

  offHandlers.push(off1, off2)
}

onMounted(async () => {
  await fetchHolidays()
  setupRealtime()
})

onBeforeUnmount(() => {
  offHandlers.forEach(off => {
    try { off && off() } catch {}
  })
})
</script>

<template>
  <div class="px-1 py-1 sm:px-3 space-y-3">
    <div
      class="rounded-2xl border border-slate-200 bg-white shadow-sm
             dark:border-slate-800 dark:bg-slate-900"
    >
      <!-- Header -->
      <div
        class="rounded-t-2xl bg-gradient-to-r from-emerald-600 via-teal-500 to-sky-500
               px-4 py-3 text-white"
      >
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p class="text-[10px] uppercase tracking-[0.35em] font-semibold text-emerald-50/90">
              Expat Leave
            </p>
            <h2 class="text-sm sm:text-base font-semibold">
              Replace Day (Compensatory Day Off)
            </h2>
            <p class="mt-0.5 text-[11px] text-emerald-50/90">
              Day you worked can be any date. Day off must be Mon–Sat and not a holiday.
            </p>
          </div>

          <div class="flex items-center gap-2 rounded-xl bg-white/15 px-3 py-2 text-[11px]">
            <div class="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-emerald-700 shadow-sm">
              <i class="fa-solid fa-rotate text-sm" />
            </div>
            <div class="space-y-0.5">
              <p class="font-medium text-emerald-50">
                Upload evidence
              </p>
              <p class="text-[10px] text-emerald-50/80">
                {{ acceptHint }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Body -->
      <div class="px-3 pb-3 pt-3 sm:px-4 sm:pb-4">
        <form class="space-y-3" @submit.prevent="submit">
          <div class="grid gap-3 sm:grid-cols-2">
            <!-- Request date -->
            <div class="space-y-1.5">
              <label class="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Request Date (day you worked)
              </label>
              <input
                v-model="form.requestDate"
                type="date"
                class="block w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs sm:text-sm
                       shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500
                       dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
              <p class="text-[11px] text-slate-500 dark:text-slate-400">
                {{ requestDateHelp }}
              </p>
            </div>

            <!-- Comp day -->
            <div class="space-y-1.5">
              <label class="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Compensatory Day Off
              </label>
              <input
                v-model="form.compensatoryDate"
                type="date"
                class="block w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs sm:text-sm
                       shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500
                       dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
              <p
                class="text-[11px]"
                :class="(holidaySet.size && !isWorkingDay(form.compensatoryDate))
                  ? 'text-rose-500'
                  : 'text-slate-500 dark:text-slate-400'"
              >
                {{ compensatoryHelp }}
              </p>
            </div>
          </div>

          <!-- Reason -->
          <div class="space-y-1.5">
            <label class="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Reason (optional)
            </label>
            <textarea
              v-model="form.reason"
              rows="3"
              class="block w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs sm:text-sm
                     shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500
                     dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              placeholder="Explain urgent work / midnight task..."
            />
          </div>

          <!-- Evidence -->
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <label class="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Evidence (multiple)
              </label>
              <span class="text-[11px] text-slate-500 dark:text-slate-400">
                {{ fileCountLabel }}
              </span>
            </div>

            <div class="flex items-center gap-2">
              <input
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png"
                class="block w-full text-xs text-slate-600 file:mr-3 file:rounded-full file:border-0
                       file:bg-emerald-600 file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white
                       hover:file:bg-emerald-700
                       dark:text-slate-300"
                @change="onPickFiles"
              />
            </div>

            <!-- File list -->
            <div v-if="files.length" class="space-y-2">
              <div
                v-for="(f, idx) in files"
                :key="f.name + idx"
                class="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2
                       dark:border-slate-800 dark:bg-slate-950/40"
              >
                <div class="min-w-0">
                  <div class="truncate text-xs font-semibold text-slate- Toggle
                  900 dark:text-slate-100">
                    {{ f.name }}
                  </div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400">
                    {{ formatMB(f.size) }} MB
                  </div>
                </div>

                <button
                  type="button"
                  class="inline-flex items-center gap-2 rounded-full border border-rose-400/60 bg-rose-500/10
                         px-3 py-1.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-500/20
                         dark:text-rose-300"
                  @click="removeFile(idx)"
                >
                  <i class="fa-solid fa-trash text-[11px]" />
                  Remove
                </button>
              </div>
            </div>
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
              class="inline-flex items-center justify-center rounded-full bg-emerald-600 px-3 py-1.5 text-xs sm:text-sm
                     font-semibold text-white shadow-sm hover:bg-emerald-700
                     disabled:cursor-not-allowed disabled:opacity-60
                     dark:bg-emerald-500 dark:hover:bg-emerald-600"
              :disabled="!canSubmit"
            >
              <span v-if="submitting" class="mr-1.5">
                <i class="fa-solid fa-spinner animate-spin text-[11px]"></i>
              </span>
              <span>Submit Replace Day</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
