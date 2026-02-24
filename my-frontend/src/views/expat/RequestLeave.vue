<!-- src/views/expat/RequestLeave.vue
  ✅ Split screen (balances left, request right)
  ✅ Desktop ratio: My Leave 6/10, Request Leave 4/10
  ✅ Square balance cards, bigger numbers, 1-row
  ✅ AL shows Used/Remain only
  ✅ SP shows Used only (NO SP remaining)
  ✅ Others show Used only
  ✅ Half-day: NO "Enable" checkbox (removed)
  ✅ Half-day selection is DIRECT:
     - Single-day: choose AM or PM (optional)
     - Multi-day: choose AM/PM on Start and/or End edge (optional)
  ✅ Show requested day count (e.g. 2.5 day(s))
  ✅ Show breakdown hint
  ✅ Hide attachments until Leave Type selected
  ✅ IMPORTANT: show ONLY clean name like "Annual Leave" (never "Annual Leave (AL)")
  ✅ FIX: enforce start/end must be working day (Mon–Sat, not holiday) + safer calc

  ✅ NEW: Attachment required rules:
     - MA always requires
     - BL always requires
     - Sick Leave (SP or SL) requires when requestedDays >= 3
-->

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'
import { subscribeEmployeeIfNeeded, subscribeUserIfNeeded, onSocket } from '@/utils/socket'

defineOptions({ name: 'RequestLeave' })

const router = useRouter()
const { showToast } = useToast()
const evidenceInputEl = ref(null)
const MY_REQUESTS_PATH = '/leave/user/my-requests'

/* ───────── Identity (for realtime only) ───────── */
const employeeId = ref(String(localStorage.getItem('employeeId') || '').trim())
const loginId = ref(String(localStorage.getItem('loginId') || '').trim())

/* ───────── Leave types ───────── */
const loadingTypes = ref(false)
const leaveTypes = ref([])
const typesError = ref('')

function cleanTypeName(name, code) {
  const n = String(name || '').trim()
  const c = String(code || '').trim().toUpperCase()
  if (!n) return c || ''
  if (!c) return n
  const re = new RegExp(`\\s*\\(\\s*${c}\\s*\\)\\s*$`, 'i')
  return n.replace(re, '').trim() || n
}

async function fetchLeaveTypes() {
  try {
    loadingTypes.value = true
    typesError.value = ''
    const res = await api.get('/leave/types')
    let data = Array.isArray(res.data) ? res.data : []
    data = data.filter((t) => t.isActive !== false)

    data = data.map((t) => {
      const code = String(t?.code || '').trim().toUpperCase()
      const name = cleanTypeName(t?.name, code)
      return { ...t, code, name }
    })

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

/* ───────── Profile balances (simple, no contract history UI) ───────── */
const loadingProfile = ref(false)
const profileError = ref('')
const balancesRaw = ref([]) // array of { code, used, remaining, entitlement }

/* ✅ employee info */
const me = ref({
  name: '',
  employeeId: '',
  department: '',
  position: '',
  contactNumber: '',
  telegramChatId: '',
})

function s(v) {
  return String(v ?? '').trim()
}
function n(v) {
  const x = Number(v ?? 0)
  return Number.isFinite(x) ? x : 0
}
function codeOf(x) {
  return String(x?.code || x?.leaveTypeCode || x?.typeCode || '').trim().toUpperCase()
}

function extractBalances(profile) {
  const arr =
    (Array.isArray(profile?.balances) && profile.balances) ||
    (Array.isArray(profile?.leaveBalances) && profile.leaveBalances) ||
    (Array.isArray(profile?.meta?.balances) && profile.meta.balances) ||
    []
  return arr
    .map((b) => ({
      code: codeOf(b),
      used: n(b?.used),
      remaining: n(b?.remaining),
      entitlement: n(b?.entitlement),
    }))
    .filter((b) => !!b.code)
}

/* ✅ map code -> clean name only */
const typeNameByCode = computed(() => {
  const m = {}
  for (const t of leaveTypes.value || []) {
    const c = String(t?.code || '').trim().toUpperCase()
    if (!c) continue
    const name = cleanTypeName(t?.name, c)
    m[c] = name || c
  }
  return m
})

function fullTypeName(code) {
  const c = String(code || '').trim().toUpperCase()
  return typeNameByCode.value[c] || c
}

/**
 * Apply carry to displayed balances (your rule):
 * - if carry positive => add to remaining
 * - if carry negative => used += abs(carry), remaining -= abs(carry)
 * Remaining clamped >= 0 for display.
 */
function applyCarryForDisplay(profile, arr) {
  const carry = profile?.carry || {}
  return arr.map((b) => {
    const c = n(carry?.[b.code])
    if (!c) return { ...b, remaining: Math.max(0, b.remaining) }
    if (c > 0) return { ...b, remaining: Math.max(0, b.remaining + c) }
    const abs = Math.abs(c)
    return { ...b, used: b.used + abs, remaining: Math.max(0, b.remaining - abs) }
  })
}

function extractEmployeeInfo(profile) {
  const p = profile || {}
  const emp = p.employee || p.employeeInfo || p.employeeDirectory || p.meta?.employee || {}
  const fallbackId = s(p.employeeId) || s(emp.employeeId) || s(emp._id) || employeeId.value || loginId.value
  return {
    employeeId: s(emp.employeeId || emp._id || p.employeeId || fallbackId),
    name: s(emp.name || p.name),
    department: s(emp.department || p.department),
    position: s(emp.position || p.position || p.jobTitle || p.title),
    contactNumber: s(emp.contactNumber || p.contactNumber),
    telegramChatId: s(emp.telegramChatId || p.telegramChatId),
  }
}

async function fetchMyProfile() {
  try {
    loadingProfile.value = true
    profileError.value = ''

    const res = await api.get('/leave/profile/me')
    const profile = res?.data || {}

    me.value = extractEmployeeInfo(profile)

    let arr = extractBalances(profile)
    arr = applyCarryForDisplay(profile, arr)

    const order = (leaveTypes.value || []).map((t) => String(t.code || '').toUpperCase()).filter(Boolean)
    if (order.length) {
      const idx = (c) => {
        const i = order.indexOf(c)
        return i >= 0 ? i : 9999
      }
      arr.sort((a, b) => idx(a.code) - idx(b.code))
    }

    balancesRaw.value = arr
  } catch (e) {
    console.error('fetchMyProfile error', e)
    profileError.value = e?.response?.data?.message || 'Unable to load your leave profile.'
    balancesRaw.value = []
  } finally {
    loadingProfile.value = false
  }
}

const iconByCode = Object.freeze({
  AL: 'fa-solid fa-calendar-days',
  SP: 'fa-solid fa-star',
  MC: 'fa-solid fa-heart-pulse',
  MA: 'fa-solid fa-person-pregnant',
  UL: 'fa-solid fa-ban',
  BL: 'fa-solid fa-briefcase', // ✅ Business Leave
})

const balancesForUI = computed(() => {
  const raw = Array.isArray(balancesRaw.value) ? balancesRaw.value : []
  const byCode = {}
  raw.forEach((b) => {
    const c = String(b?.code || '').trim().toUpperCase()
    if (c) byCode[c] = { ...b, code: c }
  })

  // ✅ Build cards from leave types so BL appears even if not returned in balances
  const list = (leaveTypes.value || [])
    .filter((t) => t?.isActive !== false)
    .map((t) => String(t?.code || '').trim().toUpperCase())
    .filter(Boolean)

  // fallback if types not loaded yet
  const codes = list.length ? list : Object.keys(byCode)

  return codes.map((code) => {
    const b = byCode[code] || { code, used: 0, remaining: 0, entitlement: 0 }
    return {
      ...b,
      code,
      name: fullTypeName(code),
      icon: iconByCode[code] || 'fa-solid fa-circle-info',
      isAL: code === 'AL',
      isSP: code === 'SP',
    }
  })
})

/* ───────── Form ───────── */
const form = ref({
  leaveTypeCode: '',
  startDate: '',
  endDate: '',
  reason: '',

  // Half-day selection is DIRECT (no checkbox):
  singleHalf: '', // 'AM' | 'PM'
  startHalfPart: '', // 'AM' | 'PM' | ''
  endHalfPart: '', // 'AM' | 'PM' | ''
})

/* ───────── Holidays ───────── */
const holidaySet = ref(new Set())
const loadingHolidays = ref(false)

async function fetchHolidays() {
  try {
    loadingHolidays.value = true
    const res = await api.get('/leave/holidays')
    const items = Array.isArray(res.data?.items) ? res.data.items : Array.isArray(res.data) ? res.data : []
    holidaySet.value = new Set(items.map((x) => String(x || '').trim()).filter(Boolean))
  } catch (e) {
    console.warn('fetchHolidays failed, fallback to Sunday-only', e?.message)
    holidaySet.value = new Set()
  } finally {
    loadingHolidays.value = false
  }
}

/* ───────── Evidence (Optional Attachments) ───────── */
const evidenceFiles = ref([]) // [{ id, file, previewUrl }]
const evidenceError = ref('')

function cryptoRandom() {
  return Math.random().toString(36).slice(2)
}

function isAllowedEvidence(file) {
  const t = String(file?.type || '').toLowerCase()
  return [
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ].includes(t)
}

function onPickEvidence(ev) {
  const files = Array.from(ev?.target?.files || [])
  evidenceError.value = ''

  for (const f of files) {
    if (!isAllowedEvidence(f)) {
      evidenceError.value = `File type not allowed: ${f.type || 'unknown'}`
      continue
    }
    if (f.size > 5 * 1024 * 1024) {
      evidenceError.value = `File too large (max 5MB): ${f.name}`
      continue
    }

    const previewUrl = String(f.type || '').startsWith('image/') ? URL.createObjectURL(f) : null

    evidenceFiles.value.push({
      id: cryptoRandom(),
      file: f,
      previewUrl,
    })
  }

  ev.target.value = ''
}

function removeEvidence(id) {
  const idx = evidenceFiles.value.findIndex((x) => x.id === id)
  if (idx >= 0) {
    const item = evidenceFiles.value[idx]
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl)
    evidenceFiles.value.splice(idx, 1)
  }
}

function resetEvidence() {
  evidenceFiles.value.forEach((x) => {
    if (x.previewUrl) URL.revokeObjectURL(x.previewUrl)
  })
  evidenceFiles.value = []
  evidenceError.value = ''
  if (evidenceInputEl.value) evidenceInputEl.value.value = ''
}

/* ───────── Helpers: multi-day / MA ───────── */
const isMA = computed(() => String(form.value.leaveTypeCode || '').toUpperCase() === 'MA')

const isMultiDay = computed(() => {
  if (!form.value.startDate || !form.value.endDate) return false
  return form.value.endDate > form.value.startDate
})

/* ───────── Half usage derived (no checkbox) ───────── */
const useHalf = computed(() => {
  return !!(form.value.singleHalf || form.value.startHalfPart || form.value.endHalfPart)
})

/* ───────── Working day logic (Mon–Sat only; Sunday excluded) ───────── */
function isWorkingDay(ymd) {
  if (!ymd) return false
  const d = dayjs(ymd)
  if (!d.isValid()) return false
  if (d.day() === 0) return false // Sunday
  if (holidaySet.value?.has(String(ymd).trim())) return false // holiday from backend env
  return true
}

function countWorkingDaysInclusive(startYmd, endYmd) {
  if (!startYmd || !endYmd) return 0
  let a = dayjs(startYmd)
  let b = dayjs(endYmd)
  if (!a.isValid() || !b.isValid()) return 0
  if (b.isBefore(a, 'day')) return 0

  let count = 0
  let cur = a.startOf('day')
  const end = b.startOf('day')

  while (cur.isSame(end, 'day') || cur.isBefore(end, 'day')) {
    const ymd = cur.format('YYYY-MM-DD')
    if (isWorkingDay(ymd)) count += 1
    cur = cur.add(1, 'day')
  }
  return count
}

/* ✅ FIX: explicit working checks */
const startIsWorking = computed(() => isWorkingDay(form.value.startDate))
const endIsWorking = computed(() => isWorkingDay(isMA.value ? form.value.startDate : form.value.endDate))

const workingRangeCount = computed(() => {
  if (!form.value.startDate || !form.value.endDate) return 0
  if (isMA.value) return 0
  return countWorkingDaysInclusive(form.value.startDate, form.value.endDate)
})

/* Requested days final (safe) */
const requestedDays = computed(() => {
  const start = form.value.startDate
  const end = isMA.value ? form.value.startDate : form.value.endDate
  if (!start || !end) return 0
  if (isMA.value) return 0

  // backend requires start/end must be working day
  if (!isWorkingDay(start) || !isWorkingDay(end)) return 0

  const work = workingRangeCount.value
  if (!work) return 0

  if (!useHalf.value) return work

  // single-day half
  if (start === end) return form.value.singleHalf ? 0.5 : work

  // multi-day edges
  let total = work
  if (form.value.startHalfPart) total -= 0.5
  if (form.value.endHalfPart) total -= 0.5
  return Math.max(0, total)
})

const requestedDaysText = computed(() => {
  if (isMA.value) return 'MA: 90 days (auto)'
  const v = requestedDays.value
  if (!v) return '—'
  const pretty = Number.isInteger(v) ? String(v) : String(v)
  return `${pretty} day(s)`
})

/* Breakdown hint */
const requestedBreakdownText = computed(() => {
  if (!form.value.leaveTypeCode) return ''
  if (!form.value.startDate || !form.value.endDate) return ''

  if (isMA.value) return 'You request MA (90 days auto).'

  const start = form.value.startDate
  const end = form.value.endDate

  if (!isWorkingDay(start) || !isWorkingDay(end)) {
    return 'Start/End must be a working day (Mon–Sat, not holiday).'
  }

  const total = requestedDays.value
  if (!total) return 'No working days selected.'

  const parts = []

  if (!isMultiDay.value && form.value.singleHalf) {
    parts.push(`0.5 on Start (${String(form.value.singleHalf).toUpperCase()})`)
  }

  if (isMultiDay.value) {
    if (form.value.startHalfPart) parts.push(`0.5 on Start (${String(form.value.startHalfPart).toUpperCase()})`)
    if (form.value.endHalfPart) parts.push(`0.5 on End (${String(form.value.endHalfPart).toUpperCase()})`)
  }

  const base = workingRangeCount.value
  const baseStr = Number.isInteger(base) ? String(base) : String(base)
  const totalStr = Number.isInteger(total) ? String(total) : String(total)

  if (!parts.length) return `You request ${totalStr} day(s)`
  return `You request ${totalStr} day(s) from ${baseStr} working day(s): ${parts.join(' + ')}`
})

/* ───────── Attachment Required Rules (MUST be AFTER form/evidence/requestedDays) ───────── */
const leaveCode = computed(() => String(form.value.leaveTypeCode || '').toUpperCase())

const attachmentRequired = computed(() => {
  const t = leaveCode.value

  // MA always requires
  if (t === 'MA') return true

  // BL always requires
  if (t === 'BL') return true

  // Sick leave rule: optional for 1-2 days, required for >=3 days
  if (t === 'SP' || t === 'SL') {
    const days = Number(requestedDays.value || 0)
    return days >= 3
  }

  return false
})

const hasRequiredAttachment = computed(() => {
  if (!attachmentRequired.value) return true
  return (evidenceFiles.value.length || 0) > 0
})

/* ───────── Half selection (DIRECT) ───────── */
function clearAllHalf() {
  form.value.singleHalf = ''
  form.value.startHalfPart = ''
  form.value.endHalfPart = ''
}

function toggleSingleHalf(part) {
  const p = String(part || '').toUpperCase()
  if (isMA.value) return
  form.value.startHalfPart = ''
  form.value.endHalfPart = ''
  form.value.singleHalf = form.value.singleHalf === p ? '' : p
}

function toggleEdgeHalf(edge, part) {
  const p = String(part || '').toUpperCase()
  if (isMA.value) return
  form.value.singleHalf = ''
  if (edge === 'start') form.value.startHalfPart = form.value.startHalfPart === p ? '' : p
  if (edge === 'end') form.value.endHalfPart = form.value.endHalfPart === p ? '' : p
}

/* ───────── Submit validation ───────── */
const submitting = ref(false)
const formError = ref('')
const formSuccess = ref('')

const canSubmit = computed(() => {
  if (submitting.value || loadingTypes.value) return false
  if (!form.value.leaveTypeCode) return false
  if (!form.value.startDate) return false
  if (!form.value.endDate) return false
  if (!isMA.value && form.value.endDate < form.value.startDate) return false

  // MA: start must be working day, no half allowed
  if (isMA.value) {
    if (!startIsWorking.value) return false
    if (useHalf.value) return false
  } else {
    // normal: start & end must be working
    if (!startIsWorking.value || !endIsWorking.value) return false
    if (workingRangeCount.value <= 0) return false
  }

  // ✅ attachment required rule
  if (!hasRequiredAttachment.value) return false

  return true
})

function resetForm() {
  form.value = {
    leaveTypeCode: '',
    startDate: '',
    endDate: '',
    reason: '',
    singleHalf: '',
    startHalfPart: '',
    endHalfPart: '',
  }
  formError.value = ''
  formSuccess.value = ''
}

watch(
  () => [form.value.startDate, form.value.leaveTypeCode],
  () => {
    if (!form.value.startDate) return

    if (isMA.value) {
      form.value.endDate = form.value.startDate
      clearAllHalf()
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

watch(
  () => [form.value.startDate, form.value.endDate],
  () => {
    if (!form.value.startDate || !form.value.endDate) return
    if (isMA.value) return

    if (!isMultiDay.value) {
      form.value.startHalfPart = ''
      form.value.endHalfPart = ''
    } else {
      form.value.singleHalf = ''
    }
  }
)

watch(
  () => form.value.leaveTypeCode,
  (v) => {
    if (!v) resetEvidence()
    if (String(v || '').toUpperCase() === 'MA') {
      if (form.value.startDate) form.value.endDate = form.value.startDate
      clearAllHalf()
    }
  }
)

/* ───────── Submit ───────── */
async function submitRequest() {
  if (!canSubmit.value) {
    formError.value = 'Please complete required fields.'
    return
  }

  formError.value = ''
  formSuccess.value = ''

  if (!form.value.leaveTypeCode) return (formError.value = 'Please select leave type.')
  if (!form.value.startDate) return (formError.value = 'Please select start date.')
  if (!form.value.endDate) return (formError.value = 'Please select end date.')
  if (!isMA.value && form.value.endDate < form.value.startDate) return (formError.value = 'End date cannot be earlier than start date.')

  if (isMA.value && useHalf.value) return (formError.value = 'MA does not support half-day.')

  // ✅ enforce working-day constraints
  if (isMA.value) {
    if (!isWorkingDay(form.value.startDate)) {
      formError.value = 'Start Date must be a working day (Mon–Sat, not holiday).'
      return
    }
  } else {
    if (!isWorkingDay(form.value.startDate) || !isWorkingDay(form.value.endDate)) {
      formError.value = 'Start/End must be a working day (Mon–Sat, not holiday).'
      return
    }
    if (workingRangeCount.value <= 0) {
      formError.value = 'No working days in selected range.'
      return
    }
  }

  // ✅ attachment required message
  if (!hasRequiredAttachment.value) {
    const t = leaveCode.value
    let msg = 'Attachment is required for this leave type.'
    if (t === 'SP' || t === 'SL') msg = 'Attachment is required for Sick Leave when requesting 3+ day(s).'
    if (t === 'MA') msg = 'Attachment is required for Maternity Leave.'
    if (t === 'BL') msg = 'Attachment is required for Business Leave.'

    formError.value = msg
    showToast({ type: 'error', title: 'Missing attachment', message: msg })
    return
  }

  submitting.value = true
  try {
    const payload = {
      leaveTypeCode: form.value.leaveTypeCode,
      startDate: form.value.startDate,
      endDate: isMA.value ? form.value.startDate : form.value.endDate,
      reason: form.value.reason || '',
    }

    if (!isMA.value && useHalf.value) {
      if (!isMultiDay.value) {
        const part = String(form.value.singleHalf || '').toUpperCase()
        payload.isHalfDay = true
        payload.dayPart = part
        payload.startHalf = part
        payload.endHalf = null
      } else {
        payload.isHalfDay = false
        payload.dayPart = ''
        payload.startHalf = form.value.startHalfPart ? String(form.value.startHalfPart).toUpperCase() : null
        payload.endHalf = form.value.endHalfPart ? String(form.value.endHalfPart).toUpperCase() : null
      }
    } else {
      payload.isHalfDay = false
      payload.dayPart = ''
      payload.startHalf = null
      payload.endHalf = null
    }

    const res = await api.post('/leave/requests', payload)
    const requestId = res?.data?._id

    if (requestId && evidenceFiles.value.length) {
      const fd = new FormData()
      evidenceFiles.value.forEach((e) => fd.append('files', e.file))
      await api.post(`/leave/requests/${requestId}/attachments`, fd)
    }

    showToast({ type: 'success', title: 'Submitted', message: 'Your request has been sent for approval.' })
    formSuccess.value = 'Submitted successfully.'
    resetForm()
    resetEvidence()
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
}

function isMine(payload = {}) {
  const emp = String(payload.employeeId || '').trim()
  const reqr = String(payload.requesterLoginId || '').trim()
  return (employeeId.value && emp === employeeId.value) || (loginId.value && reqr === loginId.value)
}

function setupRealtimeListeners() {
  offHandlers.push(
    onSocket('leave:req:updated', (p = {}) => {
      if (isMine(p)) fetchMyProfile()
    }),
    onSocket('leave:profile:updated', (p = {}) => {
      if (isMine(p)) fetchMyProfile()
    })
  )
}

watch(
  () => String(localStorage.getItem('employeeId') || '').trim(),
  (v) => {
    employeeId.value = v
  }
)
watch(
  () => String(localStorage.getItem('loginId') || '').trim(),
  (v) => {
    loginId.value = v
  }
)

onMounted(async () => {
  await fetchLeaveTypes()
  await fetchHolidays()
  await fetchMyProfile()
  ensureRealtime()
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
  <div class="ui-page">
    <div class="ui-container py-3">
      <div class="grid gap-3 lg:grid-cols-10 lg:items-stretch">
        <!-- LEFT: Balances -->
        <div class="lg:col-span-6 ui-card overflow-hidden lg:sticky lg:top-3">
          <div class="ui-hero-gradient">
            <div class="flex items-center justify-between gap-3">
              <div class="flex items-center gap-2">
                <div class="grid h-9 w-9 place-items-center rounded-2xl bg-white/15">
                  <i class="fa-solid fa-chart-pie" />
                </div>
                <div>
                  <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">My Leave</div>
                  <div class="text-[11px] font-semibold opacity-90">Balances</div>
                </div>
              </div>
            </div>
          </div>

          <div class="p-3">
            <div
              class="mb-2 rounded-2xl border border-slate-200 bg-white/60 px-3 py-2 text-[13px]
                    dark:border-slate-800 dark:bg-slate-950/30"
            >
              <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div class="min-w-0">
                  <div class="text-[12px] font-extrabold text-slate-700 dark:text-slate-200">Name</div>
                  <div class="text-[14px] font-black leading-snug text-slate-900 break-words dark:text-slate-50">
                    {{ me.name || '—' }}
                  </div>
                </div>

                <div class="min-w-0">
                  <div class="text-[12px] font-extrabold text-slate-700 dark:text-slate-200">ID</div>
                  <div class="text-[14px] font-black leading-snug text-slate-900 break-words dark:text-slate-50">
                    {{ me.employeeId || '—' }}
                  </div>
                </div>

                <div class="min-w-0">
                  <div class="text-[12px] font-extrabold text-slate-700 dark:text-slate-200">Department</div>
                  <div class="text-[14px] font-black leading-snug text-slate-900 break-words dark:text-slate-50">
                    {{ me.department || '—' }}
                  </div>
                </div>
              </div>
            </div>

            <div
              v-if="profileError"
              class="mb-2 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-800
                     dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200"
            >
              {{ profileError }}
            </div>

            <div class="balance-grid">
              <div
                v-for="b in balancesForUI"
                :key="b.code"
                class="ui-balance-card"
                :class="b.isAL ? 'ui-balance-card-al' : ''"
                :title="b.name"
              >
                <div class="ui-balance-head">
                  <div class="ui-balance-ico">
                    <i :class="b.icon" />
                  </div>
                  <div class="ui-balance-code" :title="b.name">
                    {{ b.name }}
                  </div>
                </div>

                <template v-if="b.isAL">
                  <div class="ui-balance-two">
                    <div class="ui-balance-block ui-balance-block-al">
                      <div class="ui-balance-num ui-balance-num-al">{{ b.used }}</div>
                      <div class="ui-balance-sub">Used</div>
                    </div>
                    <div class="ui-balance-block ui-balance-block-al">
                      <div class="ui-balance-num ui-balance-num-al" :class="b.remaining < 0 ? 'al-remain-neg' : 'al-remain-pos'">
                        {{ b.remaining }}
                      </div>
                      <div class="ui-balance-sub">Remain</div>
                    </div>
                  </div>
                </template>

                <template v-else>
                  <div class="ui-balance-one">
                    <div class="ui-balance-num">{{ b.used }}</div>
                    <div class="ui-balance-sub">Used</div>
                  </div>
                </template>
              </div>

              <div v-if="!balancesForUI.length && !loadingProfile" class="text-[11px] text-slate-500 dark:text-slate-400">
                No balances found.
              </div>
            </div>
          </div>
        </div>

        <!-- RIGHT: Request form -->
        <div class="lg:col-span-4 ui-card overflow-hidden">
          <div class="ui-hero-gradient">
            <div class="flex items-center justify-between gap-3">
              <div class="flex items-center gap-2">
                <div class="grid h-9 w-9 place-items-center rounded-2xl bg-white/15">
                  <i class="fa-solid fa-wand-magic-sparkles" />
                </div>
                <div>
                  <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Request Leave</div>
                  <div class="text-[11px] font-semibold opacity-90">{{ isMA ? 'MA: 90 days auto' : 'Create request' }}</div>
                </div>
              </div>

              <div class="text-right">
                <div class="text-[10px] font-bold opacity-90">Requested</div>
                <div class="text-[12px] font-extrabold">{{ requestedDaysText }}</div>
              </div>
            </div>
          </div>

          <div class="p-3">
            <form class="space-y-2.5" @submit.prevent="submitRequest">
              <!-- Leave type -->
              <div class="ui-card p-3">
                <div class="ui-label">Leave Type</div>
                <select v-model="form.leaveTypeCode" :disabled="loadingTypes || !leaveTypes.length" class="ui-select">
                  <option value="" disabled>{{ loadingTypes ? 'Loading…' : 'Select leave type' }}</option>
                  <option v-for="t in leaveTypes" :key="t.code" :value="t.code">{{ t.name }}</option>
                </select>

                <div
                  v-if="typesError"
                  class="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-800
                         dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200"
                >
                  {{ typesError }}
                </div>
              </div>

              <!-- Dates + Chips -->
              <div class="ui-card p-3">
                <div class="grid gap-2">
                  <!-- Start row -->
                  <div class="date-row">
                    <div class="ui-ico !h-10 !w-10"><i class="fa-solid fa-play" /></div>

                    <div class="flex-1">
                      <div class="ui-label">Start Date</div>
                      <input v-model="form.startDate" type="date" class="ui-date" />
                    </div>

                    <div class="date-right-slot">
                      <div v-if="!isMA && form.startDate && form.endDate && form.startDate === form.endDate" class="chip-row">
                        <button type="button" class="sq-chip" :class="form.singleHalf === 'AM' ? 'sq-chip-on' : ''" @click="toggleSingleHalf('AM')">AM</button>
                        <button type="button" class="sq-chip" :class="form.singleHalf === 'PM' ? 'sq-chip-on' : ''" @click="toggleSingleHalf('PM')">PM</button>
                      </div>

                      <div v-else-if="!isMA && isMultiDay" class="chip-row">
                        <button type="button" class="sq-chip" :class="form.startHalfPart === 'AM' ? 'sq-chip-on' : ''" @click="toggleEdgeHalf('start', 'AM')">AM</button>
                        <button type="button" class="sq-chip" :class="form.startHalfPart === 'PM' ? 'sq-chip-on' : ''" @click="toggleEdgeHalf('start', 'PM')">PM</button>
                      </div>

                      <div v-else class="slot-placeholder"></div>
                    </div>
                  </div>

                  <!-- End row -->
                  <div class="date-row">
                    <div class="ui-ico !h-10 !w-10"><i class="fa-solid fa-flag-checkered" /></div>

                    <div class="flex-1">
                      <div class="ui-label">End Date</div>
                      <input
                        v-model="form.endDate"
                        type="date"
                        :disabled="isMA"
                        class="ui-date disabled:opacity-70 disabled:cursor-not-allowed"
                      />
                    </div>

                    <div class="date-right-slot">
                      <div v-if="!isMA && isMultiDay" class="chip-row">
                        <button type="button" class="sq-chip" :class="form.endHalfPart === 'AM' ? 'sq-chip-on' : ''" @click="toggleEdgeHalf('end', 'AM')">AM</button>
                        <button type="button" class="sq-chip" :class="form.endHalfPart === 'PM' ? 'sq-chip-on' : ''" @click="toggleEdgeHalf('end', 'PM')">PM</button>
                      </div>
                      <div v-else class="slot-placeholder"></div>
                    </div>
                  </div>

                  <!-- ✅ Warnings -->
                  <div
                    v-if="form.startDate && !startIsWorking && !isMA"
                    class="mt-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800
                           dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200"
                  >
                    Start Date is not a working day (Sunday/holiday). Please choose another date.
                  </div>

                  <div
                    v-if="form.endDate && !isMA && !endIsWorking"
                    class="mt-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800
                           dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200"
                  >
                    End Date is not a working day (Sunday/holiday). Please choose another date.
                  </div>

                  <div
                    v-if="isMA && form.startDate && !startIsWorking"
                    class="mt-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800
                           dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200"
                  >
                    MA Start Date must be a working day (Mon–Sat, not holiday).
                  </div>

                  <!-- ✅ breakdown hint -->
                  <div
                    v-if="form.leaveTypeCode"
                    class="mt-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-700
                           dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200"
                  >
                    <span class="font-extrabold">Calculation:</span>
                    <span class="opacity-90"> {{ requestedBreakdownText }} </span>
                  </div>
                </div>
              </div>

              <!-- Evidence (only when type selected) -->
              <div v-if="form.leaveTypeCode" class="ui-card p-3">
                <div class="flex items-center justify-between gap-2">
                  <div class="text-[12px] font-extrabold text-slate-800 dark:text-slate-100">
                    Evidence ({{ attachmentRequired ? 'Required' : 'Optional' }})
                  </div>

                  <span class="ui-badge text-[10px]" :class="attachmentRequired ? 'ui-badge-rose' : 'ui-badge-info'">
                    {{ evidenceFiles.length }} file(s) {{ attachmentRequired ? '• Required' : '• Optional' }}
                  </span>
                </div>

                <div v-if="attachmentRequired" class="mt-2 text-[11px] font-semibold text-rose-600 dark:text-rose-300">
                  Attachment is required for this request.
                </div>

                <div class="mt-3">
                  <input
                    id="evidenceInput"
                    ref="evidenceInputEl"
                    type="file"
                    multiple
                    accept=".png,.jpg,.jpeg,.webp,.pdf,.doc,.docx,.xls,.xlsx"
                    class="hidden"
                    @change="onPickEvidence"
                  />

                  <div class="flex items-center justify-between gap-2">
                    <label for="evidenceInput" class="ui-btn ui-btn-soft" role="button" tabindex="0">
                      <i class="fa-solid fa-upload" />
                      Upload Files
                    </label>
                    <div v-if="evidenceFiles.length" class="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                      {{ evidenceFiles.length }} file(s) selected
                    </div>
                  </div>
                </div>

                <div v-if="evidenceError" class="mt-2 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                  {{ evidenceError }}
                </div>

                <div v-if="evidenceFiles.length" class="mt-3 space-y-2">
                  <div
                    v-for="f in evidenceFiles"
                    :key="f.id"
                    class="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white/60 px-3 py-2
                           dark:border-slate-800 dark:bg-slate-950/30"
                  >
                    <div class="min-w-0">
                      <div class="truncate text-[12px] font-extrabold text-slate-900 dark:text-slate-50">
                        {{ f.file?.name || 'File' }}
                      </div>
                      <div class="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                        {{ Math.round((f.file?.size || 0) / 1024) }} KB
                      </div>
                    </div>

                    <button type="button" class="ui-btn ui-btn-rose ui-btn-sm" @click="removeEvidence(f.id)">
                      <i class="fa-solid fa-trash" />
                      Remove
                    </button>
                  </div>
                </div>
              </div>

              <!-- Reason -->
              <div class="ui-card p-3">
                <div class="ui-label">Reason</div>
                <textarea v-model="form.reason" rows="2" class="ui-textarea" placeholder="Optional…" />
              </div>

              <div v-if="formError" class="text-[11px] font-extrabold text-rose-600 dark:text-rose-400">{{ formError }}</div>
              <div v-if="formSuccess" class="text-[11px] font-extrabold text-emerald-600 dark:text-emerald-300">{{ formSuccess }}</div>

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
            </form>
          </div>
        </div>
      </div>
      <!-- end split -->
    </div>
  </div>
</template>

<style scoped>
/* ─────────────────────────────────────────────────────────────
   Balance Cards (Bigger + 3 per row)
───────────────────────────────────────────────────────────── */

.balance-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (min-width: 640px) {
  .balance-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr)); /* ✅ 3 per row */
  }
}

.ui-balance-card {
  @apply rounded-2xl border border-slate-200 bg-white p-3 shadow-sm
         dark:border-slate-800 dark:bg-slate-950/40;

  height: 156px; /* ✅ bigger */
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ui-balance-card-al {
  height: 156px; /* same height, content differs */
}

.ui-balance-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ui-balance-ico {
  @apply grid place-items-center rounded-2xl border border-slate-200 bg-slate-50
         dark:border-slate-800 dark:bg-slate-900/40;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
}

.ui-balance-ico i {
  @apply text-slate-700 dark:text-slate-200;
  font-size: 18px;
}

.ui-balance-code {
  @apply text-[13px] font-extrabold tracking-wide text-slate-800 dark:text-slate-100;
  line-height: 1.15;
  overflow: hidden;
  text-overflow: ellipsis;
  word-break: break-word;
}

.ui-balance-one {
  @apply rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-center
         dark:border-slate-800 dark:bg-slate-900/40;

  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.ui-balance-two {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  align-items: stretch;
}

.ui-balance-block {
  @apply rounded-2xl border border-slate-200 bg-slate-50 px-2 text-center
         dark:border-slate-800 dark:bg-slate-900/40;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.ui-balance-num {
  @apply text-slate-900 dark:text-slate-50;
  font-weight: 900;
  line-height: 1;
  font-size: clamp(26px, 3.2vw, 38px); /* ✅ bigger number */
}

.ui-balance-num-al {
  @apply text-slate-900 dark:text-slate-50;
  font-weight: 900;
  line-height: 1;
  font-size: clamp(28px, 3.6vw, 40px); /* ✅ bigger number */
}

.ui-balance-sub {
  @apply mt-1 text-[12px] font-bold text-slate-500 dark:text-slate-400;
}

/* ─────────────────────────────────────────────────────────────
   Date rows + chips
───────────────────────────────────────────────────────────── */
.date-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.date-right-slot {
  width: 146px;
  display: flex;
  justify-content: flex-end;
}

.chip-row {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: flex-end;
}

.slot-placeholder {
  width: 146px;
  height: 42px;
}

/* square AM/PM chips */
.sq-chip {
  @apply grid place-items-center rounded-xl border border-slate-200 bg-white
         text-[11px] font-extrabold text-slate-700
         hover:bg-slate-50 active:translate-y-[0.5px]
         disabled:opacity-40 disabled:cursor-not-allowed
         dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200 dark:hover:bg-slate-900/40;

  width: 42px;
  height: 42px;
}

.sq-chip-on {
  @apply border-sky-300 bg-sky-50 text-sky-800
         dark:border-sky-700/60 dark:bg-sky-950/40 dark:text-sky-200;
}

.al-remain-pos {
  @apply text-emerald-600 dark:text-emerald-300;
}
.al-remain-neg {
  @apply text-rose-600 dark:text-rose-300;
}
</style>