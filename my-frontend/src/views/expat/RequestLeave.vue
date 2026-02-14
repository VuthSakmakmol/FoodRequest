<!-- src/views/expat/RequestLeave.vue
  ✅ Split screen (balances left, request right)
  ✅ Desktop ratio: My Leave 6/10, Request Leave 4/10
  ✅ Square balance cards, bigger numbers, 1-row
  ✅ AL shows Used/Remain only
  ✅ SP shows Used only (NO SP remaining)
  ✅ Others show Used only
  ✅ Half-day: NO "½" button (removed)
  ✅ Multi-day: choose AM/PM directly on Start and/or End (optional)
  ✅ Show requested day count (e.g. 2.5 days)
  ✅ Hide attachments until Leave Type selected
  ✅ IMPORTANT: show ONLY name like "Annual Leave" (never "Annual Leave (AL)")
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

const balancesForUI = computed(() => {
  const arr = Array.isArray(balancesRaw.value) ? balancesRaw.value : []
  return arr.map((b) => {
    const code = String(b.code || '').toUpperCase()
    return { ...b, isAL: code === 'AL', isSP: code === 'SP' }
  })
})

/* ───────── Form ───────── */
const form = ref({
  leaveTypeCode: '',
  startDate: '',
  endDate: '',
  reason: '',
  useHalf: false,

  // single-day half
  singleHalf: '', // 'AM' | 'PM'

  // multi-day half edges (NO 1/2 button)
  startHalfPart: '', // 'AM' | 'PM' | ''
  endHalfPart: '', // 'AM' | 'PM' | ''
})

/* ───────── Evidence (Optional Attachments) ───────── */
const evidenceFiles = ref([]) // [{ file, previewUrl }]
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

    const previewUrl = f.type.startsWith('image/') ? URL.createObjectURL(f) : null

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

  // ✅ clear file input value (so user can re-pick same files)
  if (evidenceInputEl.value) evidenceInputEl.value.value = ''
}

/* ───────── Helpers: multi-day / MA ───────── */
const selectedType = computed(() => {
  const code = String(form.value.leaveTypeCode || '').toUpperCase()
  return leaveTypes.value.find((t) => String(t.code || '').toUpperCase() === code) || null
})

const isMA = computed(() => String(form.value.leaveTypeCode || '').toUpperCase() === 'MA')

const isMultiDay = computed(() => {
  if (!form.value.startDate || !form.value.endDate) return false
  return form.value.endDate > form.value.startDate
})

/* ───────── Requested days calculation (Mon–Sat working, Sunday excluded) ───────── */
function isWorkingDay(ymd) {
  if (!ymd) return false
  const d = dayjs(ymd)
  // 0 = Sunday (excluded), Mon–Sat included
  return d.day() !== 0
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

const requestedDays = computed(() => {
  const start = form.value.startDate
  const end = isMA.value ? form.value.startDate : form.value.endDate
  if (!start || !end) return 0

  // MA: let backend handle exact 90 calendar days; we show 0 here or 90 label
  if (isMA.value) return 0

  // base working day count (inclusive)
  const work = countWorkingDaysInclusive(start, end)
  if (!work) return 0

  // half-day adjustments
  if (!form.value.useHalf) return work

  // single-day half
  if (start === end) {
    return form.value.singleHalf ? 0.5 : work
  }

  // multi-day: subtract 0.5 for each edge half selected
  let total = work
  if (form.value.startHalfPart) total -= 0.5
  if (form.value.endHalfPart) total -= 0.5
  return Math.max(0, total)
})

const requestedDaysText = computed(() => {
  if (isMA.value) return 'MA: 90 days (auto)'
  const v = requestedDays.value
  if (!v) return '—'
  // show .0 removed, keep .5
  const pretty = Number.isInteger(v) ? String(v) : String(v)
  return `${pretty} day(s)`
})

/* ───────── Half selection (NO 1/2 step) ───────── */
function toggleSingleHalf(part) {
  const p = String(part || '').toUpperCase()
  form.value.singleHalf = form.value.singleHalf === p ? '' : p
}

function toggleEdgeHalf(edge, part) {
  const p = String(part || '').toUpperCase()
  if (edge === 'start') {
    form.value.startHalfPart = form.value.startHalfPart === p ? '' : p
  }
  if (edge === 'end') {
    form.value.endHalfPart = form.value.endHalfPart === p ? '' : p
  }
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

  if (!form.value.useHalf) return true
  if (isMA.value) return false

  // single-day half requires AM/PM
  if (!isMultiDay.value) return !!form.value.singleHalf

  // multi-day half: at least one edge selected
  if (!form.value.startHalfPart && !form.value.endHalfPart) return false
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
    startHalfPart: '',
    endHalfPart: '',
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
      form.value.endDate = form.value.startDate
      form.value.useHalf = false
      form.value.singleHalf = ''
      form.value.startHalfPart = ''
      form.value.endHalfPart = ''
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
      form.value.startHalfPart = ''
      form.value.endHalfPart = ''
      return
    }
    // turning on half: clear incompatible values based on multi/single
    if (isMultiDay.value) {
      form.value.singleHalf = ''
    } else {
      form.value.startHalfPart = ''
      form.value.endHalfPart = ''
    }
  }
)

watch(
  () => [form.value.startDate, form.value.endDate],
  () => {
    if (!form.value.useHalf) return
    if (isMultiDay.value) {
      form.value.singleHalf = ''
    } else {
      form.value.startHalfPart = ''
      form.value.endHalfPart = ''
    }
  }
)

/* Hide attachments if leave type cleared */
watch(
  () => form.value.leaveTypeCode,
  (v) => {
    if (!v) resetEvidence()
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
  if (!isMA.value && form.value.endDate < form.value.startDate)
    return (formError.value = 'End date cannot be earlier than start date.')

  // half validation (no 1/2 step)
  if (form.value.useHalf && !isMA.value) {
    if (!isMultiDay.value) {
      if (!form.value.singleHalf) return (formError.value = 'Please choose AM or PM.')
    } else {
      if (!form.value.startHalfPart && !form.value.endHalfPart) {
        return (formError.value = 'Choose AM/PM for Start day and/or End day.')
      }
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
      // single-day
      if (!isMultiDay.value) {
        const part = String(form.value.singleHalf || '').toUpperCase()
        payload.isHalfDay = true
        payload.dayPart = part
        payload.startHalf = part
        payload.endHalf = null
      } else {
        // multi-day (edges)
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

    // ✅ If user selected evidence → upload after request created
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

watch(() => String(localStorage.getItem('employeeId') || '').trim(), (v) => {
  employeeId.value = v
})
watch(() => String(localStorage.getItem('loginId') || '').trim(), (v) => {
  loginId.value = v
})

onMounted(async () => {
  await fetchLeaveTypes()
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
        <!-- LEFT: Balances (6/10) -->
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
            <!-- Employee info row -->
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

            <!-- ONE ROW cards -->
            <div class="flex gap-2 overflow-x-auto pb-1">
              <div
                v-for="b in balancesForUI"
                :key="b.code"
                class="ui-balance-card shrink-0"
                :class="b.isAL ? 'ui-balance-card-al' : ''"
                :title="fullTypeName(b.code)"
                 >                
                <div class="ui-balance-code" :title="fullTypeName(b.code)">
                  {{ fullTypeName(b.code) }}
                </div>

                <template v-if="b.isAL">
                  <div class="ui-balance-two">
                    <div class="ui-balance-block ui-balance-block-al">                      
                      <div class="ui-balance-num ui-balance-num-al">{{ b.used }}</div>
                      <div class="ui-balance-sub">Used</div>
                    </div>
                    <div class="ui-balance-block ui-balance-block-al">
                      <div class="ui-balance-num ui-balance-num-al">{{ b.remaining }}</div>
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

        <!-- RIGHT: Request form (4/10) -->
        <div class="lg:col-span-4 ui-card overflow-hidden">
          <div class="ui-hero-gradient">
            <div class="flex items-center justify-between gap-3">
              <div class="flex items-center gap-2">
                <div class="grid h-9 w-9 place-items-center rounded-2xl bg-white/15">
                  <i class="fa-solid fa-wand-magic-sparkles" />
                </div>
                <div>
                  <div class="text-sm font-extrabold text-slate-900 dark:text-slate-50">Request Leave</div>
                  <div class="text-[11px] font-semibold opacity-90">
                    {{ isMA ? 'MA: 90 days auto' : 'Create request' }}
                  </div>
                </div>
              </div>

              <!-- ✅ Requested days indicator -->
              <div class="text-right">
                <div class="text-[10px] font-bold opacity-90">Requested</div>
                <div class="text-[12px] font-extrabold">{{ requestedDaysText }}</div>
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
                      <option v-for="t in leaveTypes" :key="t.code" :value="t.code">{{ t.name }}</option>
                    </select>
                  </div>
                </div>
              </div>

              <!-- Half-day toggle -->
              <div class="ui-card p-3">
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <div class="grid h-9 w-9 place-items-center rounded-2xl bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                      <i class="fa-solid fa-clock" />
                    </div>
                    <div>
                      <div class="text-[12px] font-extrabold text-slate-800 dark:text-slate-100">Half-day</div>
                      <div class="text-[11px] text-slate-500 dark:text-slate-400">Choose AM/PM directly</div>
                    </div>
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

                <div v-if="isMA && form.useHalf" class="mt-2 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                  MA does not support half-day.
                </div>
              </div>

              <!-- Dates -->
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
                      <!-- single-day -->
                      <div v-if="form.useHalf && !isMA && !isMultiDay" class="chip-row">
                        <button type="button" class="sq-chip" :class="form.singleHalf === 'AM' ? 'sq-chip-on' : ''" @click="toggleSingleHalf('AM')">AM</button>
                        <button type="button" class="sq-chip" :class="form.singleHalf === 'PM' ? 'sq-chip-on' : ''" @click="toggleSingleHalf('PM')">PM</button>
                      </div>

                      <!-- multi-day start edge -->
                      <div v-else-if="form.useHalf && !isMA && isMultiDay" class="chip-row">
                        <button type="button" class="sq-chip" :class="form.startHalfPart === 'AM' ? 'sq-chip-on' : ''" @click="toggleEdgeHalf('start','AM')">AM</button>
                        <button type="button" class="sq-chip" :class="form.startHalfPart === 'PM' ? 'sq-chip-on' : ''" @click="toggleEdgeHalf('start','PM')">PM</button>
                      </div>

                      <div v-else class="slot-placeholder"></div>
                    </div>
                  </div>

                  <!-- End row -->
                  <div class="date-row">
                    <div class="ui-ico !h-10 !w-10"><i class="fa-solid fa-flag-checkered" /></div>

                    <div class="flex-1">
                      <div class="ui-label">End Date</div>
                      <input v-model="form.endDate" type="date" :disabled="isMA" class="ui-date disabled:opacity-70 disabled:cursor-not-allowed" />
                    </div>

                    <div class="date-right-slot">
                      <!-- multi-day end edge -->
                      <div v-if="form.useHalf && !isMA && isMultiDay" class="chip-row">
                        <button type="button" class="sq-chip" :class="form.endHalfPart === 'AM' ? 'sq-chip-on' : ''" @click="toggleEdgeHalf('end','AM')">AM</button>
                        <button type="button" class="sq-chip" :class="form.endHalfPart === 'PM' ? 'sq-chip-on' : ''" @click="toggleEdgeHalf('end','PM')">PM</button>
                      </div>

                      <div v-else class="slot-placeholder"></div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- ✅ Evidence (hidden until leave type selected) -->
              <div v-if="form.leaveTypeCode" class="ui-card p-3">
                <div class="flex items-start justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <div class="grid h-9 w-9 place-items-center rounded-2xl bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                      <i class="fa-solid fa-paperclip" />
                    </div>
                    <div>
                      <div class="text-[12px] font-extrabold text-slate-800 dark:text-slate-100">
                        Evidence (Optional)
                      </div>
                      <div class="text-[11px] text-slate-500 dark:text-slate-400">
                        Images, PDF, Word, Excel (max 5MB each)
                      </div>
                    </div>
                  </div>

                  <span class="ui-badge ui-badge-info text-[10px]">
                    {{ evidenceFiles.length }} file(s)
                  </span>
                </div>

                <!-- Custom upload button (hides "No file chosen") -->
                <div class="mt-3">
                  <!-- hidden real input -->
                  <input
                    :id="'evidenceInput'"
                    ref="evidenceInputEl"
                    type="file"
                    multiple
                    accept=".png,.jpg,.jpeg,.webp,.pdf,.doc,.docx,.xls,.xlsx"
                    class="hidden"
                    @change="onPickEvidence"
                  />

                  <!-- visible button -->
                  <div class="flex items-center justify-between gap-2">
                    <label
                      :for="'evidenceInput'"
                      class="ui-btn ui-btn-soft"
                      role="button"
                      tabindex="0"
                    >
                      <i class="fa-solid fa-upload" />
                      Upload Files
                    </label>

                    <!-- optional: show selected count only (no filename input UI) -->
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
                    v-for="e in evidenceFiles"
                    :key="e.id"
                    class="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2
                          dark:border-slate-800 dark:bg-slate-900/40"
                  >
                    <div class="flex items-center gap-3 min-w-0">
                      <img
                        v-if="e.previewUrl"
                        :src="e.previewUrl"
                        class="h-10 w-10 rounded-lg object-cover border border-slate-200 dark:border-slate-800"
                      />
                      <div v-else class="grid h-10 w-10 place-items-center rounded-lg bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                        <i class="fa-solid fa-file" />
                      </div>

                      <div class="min-w-0">
                        <div class="truncate text-[12px] font-semibold text-slate-900 dark:text-slate-50">
                          {{ e.file.name }}
                        </div>
                        <div class="text-[10px] text-slate-500 dark:text-slate-400">
                          {{ (e.file.size / 1024).toFixed(1) }} KB
                        </div>
                      </div>
                    </div>

                    <button type="button" class="ui-btn ui-btn-ghost ui-btn-xs" @click="removeEvidence(e.id)">
                      <i class="fa-solid fa-xmark" />
                    </button>
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
/* Square balance cards (improved layout + responsiveness) */
.ui-balance-card{
  @apply rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-950/40;
  width: 124px;
  height: 124px;

  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ✅ Make AL numbers bigger (match other "Used" cards) */
.ui-balance-num-al{
  font-size: clamp(24px, 3.8vw, 32px);
}
/* ✅ Leave type label centered (not top) */
.ui-balance-code{
  @apply text-[11px] font-extrabold tracking-wide text-slate-700 dark:text-slate-200 text-center;
  flex: 1;                  /* take available space */
  display: grid;            /* center vertically */
  place-items: center;      /* center both axis */
  padding: 0 6px;

  /* keep nice if long */
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

/* ✅ Make AL card bigger than others */
.ui-balance-card-al{
  width: 170px;   /* was 124px */
  height: 124px;  /* keep same height to align rows */
}

/* Optional: if you also want taller AL card (uncomment) */
/*
.ui-balance-card-al{
  width: 170px;
  height: 140px;
}
*/

/* content area always sits at bottom */
.ui-balance-two,
.ui-balance-one{
  margin-top: auto;
}

/* ✅ AL two blocks responsive */
.ui-balance-two{
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  align-items: stretch;
}

/* blocks fill width and scale */
.ui-balance-block{
  @apply rounded-xl border border-slate-200 bg-slate-50 px-2 py-1 text-center
         dark:border-slate-800 dark:bg-slate-900/40;
  min-width: 0;             /* allow shrink */
}
/* ✅ Make AL blocks same visual height as other cards */
.ui-balance-block-al{
  padding-top: 10px;   /* similar to ui-balance-one py-2 */
  padding-bottom: 10px;
  min-height: 64px;    /* forces equal bottom area height */
  display: grid;
  align-content: center;
}

/* single block */
.ui-balance-one{
  @apply rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-center
         dark:border-slate-800 dark:bg-slate-900/40;
  min-width: 0;
}

/* ✅ Numbers responsive (never overflow) */
.ui-balance-num{
  font-weight: 900;
  line-height: 1;
  color: rgb(15 23 42);
  font-size: clamp(18px, 3.2vw, 26px); /* responsive */
}
:global(.dark) .ui-balance-num{
  color: #fff;
}

.ui-balance-sub{
  @apply mt-1 text-[11px] font-bold text-slate-500 dark:text-slate-400;
}

/* aligned AM/PM: reserve same width on both rows */
.date-row{
  display: flex;
  align-items: center;
  gap: 8px;
}
.date-right-slot{
  width: 146px;
  display: flex;
  justify-content: flex-end;
}
.chip-row{
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: flex-end;
}
.slot-placeholder{
  width: 146px;
  height: 42px;
}

/* square AM/PM chips */
.sq-chip{
  @apply grid place-items-center rounded-xl border border-slate-200 bg-white text-[11px] font-extrabold text-slate-700
         hover:bg-slate-50 active:translate-y-[0.5px] disabled:opacity-40 disabled:cursor-not-allowed
         dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200 dark:hover:bg-slate-900/40;
  width: 42px;
  height: 42px;
}
.sq-chip-on{
  @apply border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700/60 dark:bg-sky-950/40 dark:text-sky-200;
}
</style>