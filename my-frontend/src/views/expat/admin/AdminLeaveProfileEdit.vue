<!-- src/views/expat/admin/AdminLeaveProfileEdit.vue -->
<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, defineComponent, h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import dayjs from 'dayjs'
import api from '@/utils/api'
import { useToast } from '@/composables/useToast'

defineOptions({ name: 'AdminLeaveProfileEdit' })

const route = useRoute()
const router = useRouter()
const { showToast } = useToast()

/* ───────── responsive ───────── */
const isMobile = ref(false)
function updateIsMobile() {
  if (typeof window === 'undefined') return
  isMobile.value = window.innerWidth < 768
}

/* ───────── route param ───────── */
const employeeId = computed(() => String(route.params.employeeId || '').trim())

/* ───────── leave types (dynamic order) ───────── */
const leaveTypes = ref([])
async function fetchLeaveTypes() {
  try {
    const res = await api.get('/admin/leave/types')
    leaveTypes.value = Array.isArray(res.data) ? res.data : []
  } catch {
    leaveTypes.value = []
  }
}
const TYPE_ORDER = computed(() => {
  const codes = (leaveTypes.value || [])
    .map((t) => String(t?.code || '').toUpperCase())
    .filter(Boolean)
  const fallback = ['AL', 'SP', 'MC', 'MA', 'UL']
  return [...new Set([...fallback, ...codes])]
})

/* ───────── base state ───────── */
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const profile = ref(null)

/* store original joinDate to detect changes */
const originalJoinDate = ref('')

/* ───────── helpers ───────── */
function num(v) {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}
function fmt(v) {
  const n = num(v)
  return String(Number.isInteger(n) ? n : n.toFixed(1))
}
function isValidYMD(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim())
}
function toInputDate(v) {
  if (!v) return ''
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD') : ''
}
function fmtYMD(v) {
  if (!v) return '—'
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD') : String(v)
}
function safeStr(v) {
  return String(v || '').trim()
}

/* ───────── balances normalize ───────── */
function normalizeBalances(rawBalances = []) {
  const map = new Map()

  for (const b of rawBalances || []) {
    const code = safeStr(b?.leaveTypeCode).toUpperCase()
    if (!code) continue
    map.set(code, {
      leaveTypeCode: code,
      yearlyEntitlement: num(b?.yearlyEntitlement),
      used: num(b?.used),
      remaining: num(b?.remaining),
    })
  }

  // ensure all types exist
  for (const code of TYPE_ORDER.value) {
    if (!map.has(code)) {
      map.set(code, { leaveTypeCode: code, yearlyEntitlement: 0, used: 0, remaining: 0 })
    }
  }

  const arr = Array.from(map.values())
  arr.sort((a, b) => TYPE_ORDER.value.indexOf(a.leaveTypeCode) - TYPE_ORDER.value.indexOf(b.leaveTypeCode))
  return arr
}
const normalizedBalances = computed(() => normalizeBalances(profile.value?.balances || []))

/* ───────── contract history ───────── */
function readContractHistory(p) {
  if (!p) return []
  if (Array.isArray(p.contractHistory)) return p.contractHistory
  if (Array.isArray(p.contracts)) return p.contracts
  return []
}
const contractHistory = computed(() => {
  const arr = readContractHistory(profile.value).slice()
  return arr.sort((x, y) => {
    const tx = x?.createdAt ? new Date(x.createdAt).getTime() : 0
    const ty = y?.createdAt ? new Date(y.createdAt).getTime() : 0
    return ty - tx
  })
})

/* ───────── EDITABLE FORM ───────── */
const form = reactive({
  joinDate: '',
  managerEmployeeId: '',
  gmLoginId: '',
  alCarry: 0,
  isActive: true,
})
const formError = ref('')

function fillFormFromProfile(p) {
  form.joinDate = toInputDate(p?.joinDate)
  form.managerEmployeeId = String(p?.managerEmployeeId || p?.managerLoginId || '')
  form.gmLoginId = String(p?.gmLoginId || '')
  form.alCarry = num(p?.alCarry ?? 0)
  form.isActive = p?.isActive === false ? false : true

  originalJoinDate.value = toInputDate(p?.joinDate)
}

const joinDateChanged = computed(() => {
  const a = String(originalJoinDate.value || '')
  const b = String(form.joinDate || '')
  return a !== b
})

const isDirty = computed(() => {
  const p = profile.value
  if (!p) return false
  const a = {
    joinDate: toInputDate(p.joinDate),
    managerEmployeeId: String(p.managerEmployeeId || p.managerLoginId || ''),
    gmLoginId: String(p.gmLoginId || ''),
    alCarry: num(p.alCarry ?? 0),
    isActive: p.isActive === false ? false : true,
  }
  const b = {
    joinDate: String(form.joinDate || ''),
    managerEmployeeId: String(form.managerEmployeeId || ''),
    gmLoginId: String(form.gmLoginId || ''),
    alCarry: num(form.alCarry),
    isActive: !!form.isActive,
  }
  return JSON.stringify(a) !== JSON.stringify(b)
})

/* ───────── API: profile ───────── */
async function fetchProfile() {
  if (!employeeId.value) return
  loading.value = true
  error.value = ''
  try {
    const res = await api.get(`/admin/leave/profiles/${employeeId.value}`)
    profile.value = res?.data?.profile || null
    if (profile.value) fillFormFromProfile(profile.value)
  } catch (e) {
    console.error(e)
    error.value = e?.response?.data?.message || 'Failed to load profile.'
    showToast({ type: 'error', title: 'Load failed', message: error.value })
  } finally {
    loading.value = false
  }
}

function resetForm() {
  if (!profile.value) return
  formError.value = ''
  fillFormFromProfile(profile.value)
}

/* PATCH/PUT update with optional recalc param */
async function updateProfile(payload, { recalc } = { recalc: false }) {
  const url = `/admin/leave/profiles/${employeeId.value}`
  const params = recalc ? { recalc: '1' } : undefined

  try {
    return await api.patch(url, payload, { params })
  } catch (e) {
    const st = e?.response?.status
    if (st === 404 || st === 405) {
      return await api.put(url, payload, { params })
    }
    throw e
  }
}

/* call backend recalc endpoint (with fallbacks) */
async function forceRecalcBalances() {
  const id = employeeId.value
  if (!id) return

  const payload = {
    asOf: dayjs().format('YYYY-MM-DD'),
    reason: 'JOIN_DATE_CHANGED',
  }

  const tries = [
    () => api.post(`/admin/leave/profiles/${id}/recalculate`, payload),
    () => api.post(`/admin/leave/profiles/${id}/recalc`, payload),
    () => api.post(`/admin/leave/profiles/${id}/balances/recalc`, payload),
  ]

  let lastErr = null
  for (const fn of tries) {
    try {
      await fn()
      return true
    } catch (e) {
      const st = e?.response?.status
      if (st === 404 || st === 405) {
        lastErr = e
        continue
      }
      throw e
    }
  }

  console.warn('No recalc endpoint found', lastErr)
  return false
}

async function saveProfile() {
  formError.value = ''

  if (!employeeId.value) {
    formError.value = 'Missing employeeId.'
    return
  }
  if (form.joinDate && !isValidYMD(form.joinDate)) {
    formError.value = 'Join Date is invalid.'
    return
  }

  saving.value = true
  try {
    // 1) update profile
    await updateProfile(
      {
        joinDate: form.joinDate ? String(form.joinDate) : null,
        managerEmployeeId: form.managerEmployeeId ? String(form.managerEmployeeId).trim() : null,
        gmLoginId: form.gmLoginId ? String(form.gmLoginId).trim() : null,
        alCarry: num(form.alCarry),
        isActive: form.isActive !== false,
      },
      { recalc: joinDateChanged.value }
    )

    // 2) recalc if join date changed
    if (joinDateChanged.value) {
      const ok = await forceRecalcBalances()
      if (!ok) {
        showToast({
          type: 'warning',
          title: 'Saved',
          message: 'Join Date saved. (No recalc endpoint found, balances may refresh later.)',
        })
      } else {
        showToast({
          type: 'success',
          title: 'Saved + Recalculated',
          message: 'Join Date updated and balances recalculated.',
        })
      }
    } else {
      showToast({ type: 'success', title: 'Saved', message: 'Profile updated.' })
    }

    await fetchProfile()
  } catch (e) {
    console.error(e)
    const msg = e?.response?.data?.message || 'Failed to save.'
    formError.value = msg
    showToast({ type: 'error', title: 'Save failed', message: msg })
  } finally {
    saving.value = false
  }
}

/* ───────── actions ───────── */
function goBack() {
  router.back()
}

/* ───────── contracts modal ───────── */
const contractsOpen = ref(false)
function openContractsModal() {
  contractsOpen.value = true
}

/* ───────── renew modal ───────── */
const renew = reactive({
  open: false,
  newContractDate: '',
  clearOldLeave: true,
  note: '',
  submitting: false,
  error: '',
})

function openRenewModal() {
  renew.error = ''
  renew.note = ''
  renew.clearOldLeave = true
  renew.newContractDate = dayjs().format('YYYY-MM-DD')
  renew.open = true
}
function closeRenewModal() {
  if (renew.submitting) return
  renew.open = false
}
async function submitRenew() {
  renew.error = ''
  if (!employeeId.value) {
    renew.error = 'Missing employeeId.'
    return
  }
  if (!isValidYMD(renew.newContractDate)) {
    renew.error = 'Please choose a valid new contract start date.'
    return
  }

  renew.submitting = true
  try {
    await api.post(`/admin/leave/profiles/${employeeId.value}/contracts/renew`, {
      newContractDate: renew.newContractDate,
      clearOldLeave: !!renew.clearOldLeave,
      clearUnusedAL: !!renew.clearOldLeave,
      note: renew.note ? String(renew.note).trim() : null,
    })

    showToast({
      type: 'success',
      title: 'Contract renewed',
      message: renew.clearOldLeave ? 'Unused AL cleared (debt carried if negative).' : 'AL carried forward.',
    })

    renew.open = false
    await fetchProfile()
  } catch (e) {
    console.error(e)
    renew.error = e?.response?.data?.message || 'Failed to renew contract.'
    showToast({ type: 'error', title: 'Renew failed', message: renew.error })
  } finally {
    renew.submitting = false
  }
}

/* ───────── InfoRow (small card) ───────── */
const InfoRow = defineComponent({
  name: 'InfoRow',
  props: {
    label: { type: String, default: '' },
    value: { type: String, default: '' },
    hint: { type: String, default: '' },
  },
  setup(props) {
    return () =>
      h(
        'div',
        {
          class:
            'rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 shadow-sm ' +
            'dark:border-slate-800/70 dark:bg-slate-950/45',
        },
        [
          h(
            'div',
            {
              class:
                'text-[10px] uppercase tracking-[0.28em] font-extrabold text-slate-500 dark:text-slate-400 ' +
                (props.hint ? 'cursor-help' : ''),
              title: props.hint || '',
            },
            props.label
          ),
          h('div', { class: 'mt-1 text-[13px] font-semibold text-slate-900 dark:text-slate-50' }, props.value),
        ]
      )
  },
})

/* ───────── lifecycle ───────── */
onMounted(async () => {
  updateIsMobile()
  if (typeof window !== 'undefined') window.addEventListener('resize', updateIsMobile)
  await fetchLeaveTypes()
  await fetchProfile()
})
onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateIsMobile)
})
</script>

<template>
  <div class="w-full px-1 py-1 sm:px-3">
    <div
      class="rounded-3xl border border-slate-200/70 bg-white/70 shadow-[0_18px_45px_rgba(15,23,42,0.10)]
             backdrop-blur dark:border-slate-800/70 dark:bg-slate-950/55 overflow-hidden"
    >
      <!-- ✅ Natural gradient header (same standard) -->
      <header class="relative overflow-hidden px-4 py-4 sm:px-5">
        <div
          class="absolute inset-0"
          style="background: linear-gradient(90deg, rgba(2,132,199,1), rgba(79,70,229,1), rgba(16,185,129,1));"
        />
        <div
          class="absolute inset-0 opacity-60"
          style="background:
            radial-gradient(900px circle at 10% 0%, rgba(255,255,255,.22), transparent 45%),
            radial-gradient(900px circle at 100% 20%, rgba(255,255,255,.18), transparent 45%);"
        />
        <div class="relative text-white">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-[10px] font-extrabold uppercase tracking-[0.25em] text-white/80">
                Expat leave · Admin
              </p>
              <h1 class="mt-0.5 text-[16px] sm:text-[18px] font-extrabold tracking-tight truncate">
                Leave Profile Edit
              </h1>
              <p class="mt-1 text-[12px] text-white/85">
                Employee: <span class="font-mono font-semibold">{{ employeeId || '—' }}</span>
                <span class="mx-2 text-white/50">•</span>
                Manage join date, approvers, balances & contracts.
              </p>
            </div>

            <div class="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                class="btn-ghost"
                @click="goBack"
              >
                <i class="fa-solid fa-arrow-left text-[12px]" />
                Back
              </button>

              <button
                type="button"
                class="btn-soft"
                :disabled="loading || saving || !profile || !isDirty"
                @click="resetForm"
                :title="!isDirty ? 'No changes' : 'Reset changes'"
              >
                <i class="fa-solid fa-rotate-left text-[12px]" />
                Reset
              </button>

              <button
                type="button"
                class="btn-white"
                :disabled="loading || !profile"
                @click="openRenewModal"
              >
                <i class="fa-solid fa-arrows-rotate text-[12px]" />
                Renew
              </button>

              <button
                type="button"
                class="btn-primary"
                :disabled="loading || saving || !profile || !isDirty"
                @click="saveProfile"
                :title="!isDirty ? 'No changes' : (joinDateChanged ? 'Save + Recalculate balances' : 'Save changes')"
              >
                <i class="fa-solid" :class="saving ? 'fa-circle-notch fa-spin' : 'fa-floppy-disk'" />
                Save
                <span
                  v-if="joinDateChanged"
                  class="ml-1 rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-[10px] font-extrabold"
                >
                  +recalc
                </span>
              </button>

              <button
                type="button"
                class="btn-ghost"
                :disabled="loading"
                @click="fetchProfile()"
              >
                <i class="fa-solid fa-rotate text-[12px]" :class="loading ? 'fa-spin' : ''" />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </header>

      <!-- Body -->
      <div class="px-3 sm:px-4 py-4 space-y-3">
        <!-- Error -->
        <div
          v-if="error"
          class="rounded-2xl border border-rose-400/60 bg-rose-50 px-4 py-3 text-[13px] text-rose-800
                 dark:border-rose-500/60 dark:bg-rose-950/35 dark:text-rose-100"
        >
          <div class="font-extrabold mb-1">Failed</div>
          <div>{{ error }}</div>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="space-y-2">
          <div class="h-12 w-full animate-pulse rounded-2xl bg-slate-200/80 dark:bg-slate-800/60"></div>
          <div class="h-40 w-full animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800/50"></div>
          <div class="h-40 w-full animate-pulse rounded-2xl bg-slate-200/70 dark:bg-slate-800/50"></div>
        </div>

        <template v-else>
          <div v-if="!profile" class="py-8 text-center text-[13px] text-slate-500 dark:text-slate-400">
            Profile not loaded.
          </div>

          <template v-else>
            <!-- ✅ Top summary cards -->
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <InfoRow label="Employee ID" :value="profile.employeeId || '—'" hint="Read-only" />
              <InfoRow label="Name" :value="profile.name || '—'" hint="Read-only" />
              <InfoRow label="Department" :value="profile.department || '—'" hint="Read-only" />
            </div>

            <!-- ✅ Main content -->
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <!-- Edit form -->
              <section class="lg:col-span-2 rounded-3xl border border-slate-200/70 bg-white/80 p-3 shadow-sm dark:border-slate-800/70 dark:bg-slate-950/45">
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <div class="text-[13px] font-extrabold text-slate-900 dark:text-slate-50">Profile Settings</div>
                    <div class="text-[12px] text-slate-500 dark:text-slate-400">
                      Changing Join Date affects accrual. Renew is separate (contract start).
                    </div>
                  </div>

                  <button
                    type="button"
                    class="inline-flex items-center gap-2 rounded-full border border-indigo-300/70 bg-indigo-50 px-3 py-1 text-[11px] font-extrabold text-indigo-800
                           hover:bg-indigo-100 dark:border-indigo-700/50 dark:bg-indigo-950/30 dark:text-indigo-200 dark:hover:bg-indigo-950/45"
                    @click="openContractsModal"
                  >
                    <i class="fa-regular fa-folder-open text-[12px]" />
                    Logs
                  </button>
                </div>

                <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <!-- Join Date -->
                  <div class="rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 dark:border-slate-800/70 dark:bg-slate-950/45">
                    <div
                      class="text-[10px] uppercase tracking-[0.28em] font-extrabold text-slate-500 dark:text-slate-400 cursor-help"
                      title="Controls AL accrual and service-year rules"
                    >
                      Join Date
                    </div>

                    <div class="mt-1">
                      <input
                        v-model="form.joinDate"
                        type="date"
                        class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-[13px]
                               dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                      <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        Current: <span class="font-mono">{{ fmtYMD(profile.joinDate) }}</span>
                        <span
                          v-if="joinDateChanged"
                          class="ml-2 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold text-amber-900
                                 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100"
                        >
                          Changed → will recalc
                        </span>
                      </div>
                    </div>
                  </div>

                  <!-- Contract Start (read-only) -->
                  <InfoRow
                    label="Current Contract Start"
                    :value="fmtYMD(profile.contractDate)"
                    hint="To change contract date, use Renew"
                  />

                  <!-- AL Carry -->
                  <div class="rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 dark:border-slate-800/70 dark:bg-slate-950/45">
                    <div
                      class="text-[10px] uppercase tracking-[0.28em] font-extrabold text-slate-500 dark:text-slate-400 cursor-help"
                      title="SP can make AL negative. Debt carries forward."
                    >
                      AL Carry (debt allowed)
                    </div>

                    <div class="mt-1">
                      <input
                        v-model.number="form.alCarry"
                        type="number"
                        step="0.5"
                        class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-[13px]
                               dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        placeholder="0"
                      />
                      <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        Current: <span class="font-mono">{{ fmt(profile.alCarry ?? 0) }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Active toggle -->
                  <div class="rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 dark:border-slate-800/70 dark:bg-slate-950/45">
                    <div
                      class="text-[10px] uppercase tracking-[0.28em] font-extrabold text-slate-500 dark:text-slate-400 cursor-help"
                      title="If inactive, employee cannot request leave"
                    >
                      Active
                    </div>

                    <div class="mt-2 flex items-center justify-between">
                      <div class="text-[13px] font-extrabold text-slate-900 dark:text-slate-50">
                        {{ form.isActive ? 'Yes' : 'No' }}
                      </div>

                      <button
                        type="button"
                        class="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-extrabold transition"
                        :class="form.isActive
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-700/50 dark:bg-emerald-950/30 dark:text-emerald-200 dark:hover:bg-emerald-950/45'
                          : 'border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-900/80'"
                        @click="form.isActive = !form.isActive"
                      >
                        <i class="fa-solid" :class="form.isActive ? 'fa-toggle-on' : 'fa-toggle-off'" />
                        Toggle
                      </button>
                    </div>

                    <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      Current: <span class="font-mono">{{ profile.isActive === false ? 'No' : 'Yes' }}</span>
                    </div>
                  </div>

                  <!-- Manager Employee ID -->
                  <div class="rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 dark:border-slate-800/70 dark:bg-slate-950/45">
                    <div
                      class="text-[10px] uppercase tracking-[0.28em] font-extrabold text-slate-500 dark:text-slate-400 cursor-help"
                      title="Use manager employeeId (not loginId)"
                    >
                      Manager Employee ID
                    </div>

                    <div class="mt-1">
                      <input
                        v-model="form.managerEmployeeId"
                        type="text"
                        placeholder="Example: 51820386"
                        class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-[13px]
                               dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                      <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        Current: <span class="font-mono">{{ profile.managerEmployeeId || profile.managerLoginId || '—' }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- GM Login ID -->
                  <div class="rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 dark:border-slate-800/70 dark:bg-slate-950/45">
                    <div
                      class="text-[10px] uppercase tracking-[0.28em] font-extrabold text-slate-500 dark:text-slate-400 cursor-help"
                      title="Approver loginId with role LEAVE_GM"
                    >
                      GM Login ID
                    </div>

                    <div class="mt-1">
                      <input
                        v-model="form.gmLoginId"
                        type="text"
                        placeholder="Example: leave_gm"
                        class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-[13px]
                               dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                      <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        Current: <span class="font-mono">{{ profile.gmLoginId || '—' }}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  v-if="formError"
                  class="mt-3 rounded-2xl border border-rose-400/60 bg-rose-50 px-4 py-3 text-[13px] text-rose-800
                         dark:border-rose-500/60 dark:bg-rose-950/35 dark:text-rose-100"
                >
                  {{ formError }}
                </div>

                <div v-if="isDirty" class="mt-3 text-[12px] font-semibold text-indigo-700 dark:text-indigo-300">
                  You have unsaved changes.
                </div>
              </section>

              <!-- Balances -->
              <section class="rounded-3xl border border-slate-200/70 bg-white/80 p-3 shadow-sm dark:border-slate-800/70 dark:bg-slate-950/45">
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <div class="text-[13px] font-extrabold text-slate-900 dark:text-slate-50">Balances</div>
                    <div class="text-[12px] text-slate-500 dark:text-slate-400">
                      As of <span class="font-mono">{{ profile.balancesAsOf || '—' }}</span>
                    </div>
                  </div>
                </div>

                <div v-if="!normalizedBalances.length" class="mt-4 text-[13px] text-slate-500 dark:text-slate-400">
                  No balances yet.
                </div>

                <div v-else class="mt-3 overflow-hidden rounded-2xl border border-slate-200/70 dark:border-slate-800/70">
                  <table class="w-full text-[12px]">
                    <thead class="bg-slate-50 text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
                      <tr>
                        <th class="px-3 py-2 text-left font-extrabold">Type</th>
                        <th class="px-3 py-2 text-right font-extrabold">Ent</th>
                        <th class="px-3 py-2 text-right font-extrabold">Used</th>
                        <th class="px-3 py-2 text-right font-extrabold">Remain</th>
                      </tr>
                    </thead>

                    <!-- ✅ row split + zebra -->
                    <tbody class="divide-y divide-slate-200/70 dark:divide-slate-800/70">
                      <tr
                        v-for="(b, idx) in normalizedBalances"
                        :key="b.leaveTypeCode"
                        class="text-slate-700 dark:text-slate-100"
                        :class="idx % 2 === 0
                          ? 'bg-white/70 dark:bg-slate-950/40'
                          : 'bg-slate-50/70 dark:bg-slate-900/35'"
                      >
                        <td class="px-3 py-2 font-extrabold">{{ b.leaveTypeCode }}</td>
                        <td class="px-3 py-2 text-right font-mono">{{ fmt(b.yearlyEntitlement) }}</td>
                        <td class="px-3 py-2 text-right font-mono">{{ fmt(b.used) }}</td>
                        <td class="px-3 py-2 text-right font-mono">
                          <span
                            class="inline-flex rounded-full px-2 py-0.5 font-extrabold"
                            :class="num(b.remaining) < 0
                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200'
                              : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200'"
                          >
                            {{ fmt(b.remaining) }}
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div class="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
                  Tip: If Join Date changed, Save will try to recalc balances.
                </div>
              </section>
            </div>

            <!-- Contract History -->
            <section class="rounded-3xl border border-slate-200/70 bg-white/80 p-3 shadow-sm dark:border-slate-800/70 dark:bg-slate-950/45">
              <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
                <div>
                  <div class="text-[13px] font-extrabold text-slate-900 dark:text-slate-50">Contract History</div>
                  <div class="text-[12px] text-slate-500 dark:text-slate-400">
                    Newest first. Full view also available in Logs.
                  </div>
                </div>
                <div class="text-[12px] text-slate-500 dark:text-slate-400">
                  {{ contractHistory.length }} log(s)
                </div>
              </div>

              <div v-if="!contractHistory.length" class="mt-4 py-6 text-center text-[13px] text-slate-500 dark:text-slate-400">
                No contract history.
              </div>

              <div v-else class="mt-3 overflow-x-auto rounded-2xl border border-slate-200/70 dark:border-slate-800/70">
                <table class="min-w-[980px] w-full text-[12px]">
                  <thead class="bg-slate-50 text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
                    <tr>
                      <th class="px-3 py-2 text-left font-extrabold">#</th>
                      <th class="px-3 py-2 text-left font-extrabold">Start</th>
                      <th class="px-3 py-2 text-left font-extrabold">End</th>
                      <th class="px-3 py-2 text-right font-extrabold">AL Carry</th>
                      <th class="px-3 py-2 text-left font-extrabold">Snapshot</th>
                      <th class="px-3 py-2 text-left font-extrabold">Note</th>
                      <th class="px-3 py-2 text-left font-extrabold">By</th>
                      <th class="px-3 py-2 text-left font-extrabold">At</th>
                    </tr>
                  </thead>

                  <!-- ✅ row split + zebra -->
                  <tbody class="divide-y divide-slate-200/70 dark:divide-slate-800/70">
                    <tr
                      v-for="(c, idx) in contractHistory"
                      :key="c._id || c.createdAt || idx"
                      :class="idx % 2 === 0
                        ? 'bg-white/70 dark:bg-slate-950/40'
                        : 'bg-slate-50/70 dark:bg-slate-900/35'"
                      class="text-slate-700 dark:text-slate-100"
                    >
                      <td class="px-3 py-2 font-mono">{{ c.contractNo ?? (idx + 1) }}</td>
                      <td class="px-3 py-2 font-mono">{{ c.startDate || '—' }}</td>
                      <td class="px-3 py-2 font-mono">{{ c.endDate || '—' }}</td>
                      <td class="px-3 py-2 text-right font-mono">{{ fmt(c.alCarrySnapshot ?? c.alCarry ?? 0) }}</td>

                      <td class="px-3 py-2">
                        <div class="text-[11px] text-slate-600 dark:text-slate-300">
                          <div v-if="Array.isArray(c.balancesSnapshot)">
                            <span
                              v-for="b in c.balancesSnapshot"
                              :key="String(b.leaveTypeCode) + String(c.createdAt)"
                              class="mr-2 mb-1 inline-flex rounded-full border border-slate-300/80 bg-white/70 px-2 py-0.5 text-[10px]
                                     dark:border-slate-700/60 dark:bg-slate-950/40"
                            >
                              {{ String(b.leaveTypeCode).toUpperCase() }}:
                              U{{ fmt(b.used) }} / R{{ fmt(b.remaining) }}
                            </span>
                          </div>
                          <div v-else class="text-slate-400">—</div>
                        </div>
                      </td>

                      <td class="px-3 py-2">
                        <div class="max-w-[260px] truncate text-[11px] text-slate-600 dark:text-slate-300">
                          {{ c.note || '—' }}
                        </div>
                      </td>

                      <td class="px-3 py-2 font-mono text-[11px]">{{ c.createdBy || '—' }}</td>
                      <td class="px-3 py-2 font-mono text-[11px]">
                        {{ c.createdAt ? dayjs(c.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </template>
        </template>
      </div>
    </div>

    <!-- Renew Contract Modal -->
    <transition name="modal-fade">
      <div v-if="renew.open" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-2">
        <div class="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950">
          <div class="border-b border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/80">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="text-[13px] font-extrabold text-slate-900 dark:text-slate-50">Renew Contract</div>
                <div class="text-[12px] text-slate-500 dark:text-slate-400">
                  {{ profile?.employeeId }} · {{ profile?.name || '—' }}
                </div>
              </div>
              <button
                type="button"
                class="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200/60
                       dark:text-slate-300 dark:hover:bg-slate-800/80"
                :disabled="renew.submitting"
                @click="closeRenewModal"
              >
                <i class="fa-solid fa-xmark text-xs" />
              </button>
            </div>
          </div>

          <div class="px-4 py-3 space-y-3">
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="space-y-1">
                <label class="block text-[11px] font-extrabold text-slate-600 dark:text-slate-300">
                  New Contract Start Date
                </label>
                <input
                  v-model="renew.newContractDate"
                  type="date"
                  class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-[13px]
                         dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>

              <div class="space-y-1">
                <label class="block text-[11px] font-extrabold text-slate-600 dark:text-slate-300">
                  Clear unused AL?
                </label>

                <div class="rounded-2xl border border-slate-200/70 bg-white/80 p-3 dark:border-slate-700/70 dark:bg-slate-950/40">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <div class="text-[12px] font-extrabold text-slate-800 dark:text-slate-100">
                        {{ renew.clearOldLeave ? 'Yes (clear AL to 0)' : 'No (carry AL forward)' }}
                      </div>
                      <div class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        ON: positive AL cleared, negative debt remains. OFF: carry everything.
                      </div>
                    </div>

                    <button
                      type="button"
                      class="inline-flex items-center rounded-full border border-slate-300 px-2 py-1 text-[11px] font-extrabold text-slate-700
                             dark:border-slate-600 dark:text-slate-200"
                      @click="renew.clearOldLeave = !renew.clearOldLeave"
                    >
                      <i class="fa-solid" :class="renew.clearOldLeave ? 'fa-toggle-on' : 'fa-toggle-off'" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div class="space-y-1">
              <label class="block text-[11px] font-extrabold text-slate-600 dark:text-slate-300">Note (optional)</label>
              <textarea
                v-model="renew.note"
                rows="3"
                class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-[13px]
                       dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                placeholder="Example: renewed contract for 3 months"
              />
            </div>

            <div
              v-if="renew.error"
              class="rounded-2xl border border-rose-400/60 bg-rose-50 px-4 py-3 text-[13px] text-rose-800
                     dark:border-rose-500/60 dark:bg-rose-950/35 dark:text-rose-100"
            >
              {{ renew.error }}
            </div>
          </div>

          <div class="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/80 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900/80">
            <button
              type="button"
              class="rounded-full px-4 py-2 text-[12px] font-extrabold text-slate-600 hover:bg-slate-200/70
                     dark:text-slate-200 dark:hover:bg-slate-800 disabled:opacity-60"
              :disabled="renew.submitting"
              @click="closeRenewModal"
            >
              Cancel
            </button>

            <button
              type="button"
              class="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-[12px] font-extrabold text-white shadow-sm
                     hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed"
              :disabled="renew.submitting"
              @click="submitRenew"
            >
              <i class="fa-solid" :class="renew.submitting ? 'fa-circle-notch fa-spin' : 'fa-arrows-rotate'" />
              <span>{{ renew.submitting ? 'Saving...' : 'Renew' }}</span>
            </button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Contract Logs Modal -->
    <transition name="modal-fade">
      <div v-if="contractsOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-2">
        <div
          class="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl
                 dark:border-slate-700 dark:bg-slate-950"
        >
          <div class="border-b border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-900/80">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="text-[13px] font-extrabold text-slate-900 dark:text-slate-50">Contract Logs</div>
                <div class="text-[12px] text-slate-500 dark:text-slate-400">
                  {{ profile?.employeeId }} · {{ profile?.name || '—' }}
                </div>
              </div>
              <button
                type="button"
                class="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200/60
                       dark:text-slate-300 dark:hover:bg-slate-800/80"
                @click="contractsOpen = false"
              >
                <i class="fa-solid fa-xmark text-xs" />
              </button>
            </div>
          </div>

          <div class="px-4 py-3 space-y-3 overflow-auto">
            <p v-if="!contractHistory.length" class="text-[13px] text-slate-500 dark:text-slate-400">
              No contract logs yet.
            </p>

            <div v-else class="overflow-x-auto rounded-2xl border border-slate-200/70 dark:border-slate-800/70">
              <table class="min-w-[980px] w-full text-[12px]">
                <thead class="bg-slate-50 text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
                  <tr>
                    <th class="px-3 py-2 text-left font-extrabold">#</th>
                    <th class="px-3 py-2 text-left font-extrabold">Start</th>
                    <th class="px-3 py-2 text-left font-extrabold">End</th>
                    <th class="px-3 py-2 text-right font-extrabold">AL Carry</th>
                    <th class="px-3 py-2 text-left font-extrabold">Snapshot</th>
                    <th class="px-3 py-2 text-left font-extrabold">Note</th>
                    <th class="px-3 py-2 text-left font-extrabold">By</th>
                    <th class="px-3 py-2 text-left font-extrabold">At</th>
                  </tr>
                </thead>

                <tbody class="divide-y divide-slate-200/70 dark:divide-slate-800/70">
                  <tr
                    v-for="(c, idx) in contractHistory"
                    :key="c._id || c.createdAt || idx"
                    :class="idx % 2 === 0
                      ? 'bg-white/70 dark:bg-slate-950/40'
                      : 'bg-slate-50/70 dark:bg-slate-900/35'"
                  >
                    <td class="px-3 py-2 font-mono">{{ c.contractNo ?? (idx + 1) }}</td>
                    <td class="px-3 py-2 font-mono">{{ c.startDate || '—' }}</td>
                    <td class="px-3 py-2 font-mono">{{ c.endDate || '—' }}</td>
                    <td class="px-3 py-2 text-right font-mono">{{ fmt(c.alCarrySnapshot ?? c.alCarry ?? 0) }}</td>

                    <td class="px-3 py-2">
                      <div class="text-[11px] text-slate-600 dark:text-slate-300">
                        <div v-if="Array.isArray(c.balancesSnapshot)">
                          <span
                            v-for="b in c.balancesSnapshot"
                            :key="String(b.leaveTypeCode) + String(c.createdAt)"
                            class="mr-2 mb-1 inline-flex rounded-full border border-slate-300/80 bg-white/70 px-2 py-0.5 text-[10px]
                                   dark:border-slate-700/60 dark:bg-slate-950/40"
                          >
                            {{ String(b.leaveTypeCode).toUpperCase() }}:
                            U{{ fmt(b.used) }} / R{{ fmt(b.remaining) }}
                          </span>
                        </div>
                        <div v-else class="text-slate-400">—</div>
                      </div>
                    </td>

                    <td class="px-3 py-2">
                      <div class="max-w-[260px] truncate text-[11px] text-slate-600 dark:text-slate-300">
                        {{ c.note || '—' }}
                      </div>
                    </td>

                    <td class="px-3 py-2 font-mono text-[11px]">{{ c.createdBy || '—' }}</td>
                    <td class="px-3 py-2 font-mono text-[11px]">
                      {{ c.createdAt ? dayjs(c.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/80 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900/80">
            <button
              type="button"
              class="rounded-full px-4 py-2 text-[12px] font-extrabold text-slate-600 hover:bg-slate-200/70
                     dark:text-slate-200 dark:hover:bg-slate-800"
              @click="contractsOpen = false"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
/* Modal transition */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.18s ease-out, transform 0.18s ease-out;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.98);
}

/* Header buttons */
.btn-ghost {
  @apply inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-[12px] font-extrabold text-white
         transition hover:bg-white/15 disabled:opacity-60 disabled:cursor-not-allowed;
}
.btn-soft {
  @apply inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-[12px] font-extrabold text-white
         transition hover:bg-white/15 disabled:opacity-60 disabled:cursor-not-allowed;
}
.btn-white {
  @apply inline-flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-[12px] font-extrabold text-slate-900
         transition hover:bg-white disabled:opacity-60 disabled:cursor-not-allowed;
}
.btn-primary {
  @apply inline-flex items-center gap-2 rounded-full bg-emerald-400/95 px-4 py-2 text-[12px] font-extrabold text-slate-950
         transition hover:bg-emerald-300 disabled:opacity-60 disabled:cursor-not-allowed;
}
</style>
