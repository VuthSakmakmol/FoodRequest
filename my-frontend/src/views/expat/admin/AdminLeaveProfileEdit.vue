<!-- src/views/expat/admin/AdminLeaveProfileEdit.vue -->
<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, defineComponent, h, watch } from 'vue'
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

/* ───────── approval mode helpers ───────── */
const APPROVAL_MODES = [
  { value: 'MANAGER_AND_GM', label: 'Manager + GM', hint: 'Manager approves first, then GM.' },
  { value: 'GM_AND_COO', label: 'GM + COO', hint: 'GM approves first, then COO.' },
]

function normApprovalMode(v) {
  const s = String(v || '').trim().toUpperCase()
  if (s === 'GM_AND_COO') return 'GM_AND_COO'
  if (s === 'MANAGER_AND_GM') return 'MANAGER_AND_GM'
  // backward aliases
  if (s === 'ADMIN_AND_GM') return 'MANAGER_AND_GM'
  if (s === 'GM_ONLY') return 'MANAGER_AND_GM'
  if (s === 'MANAGER+GM') return 'MANAGER_AND_GM'
  return 'MANAGER_AND_GM'
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
  approvalMode: 'MANAGER_AND_GM',

  // approver mapping
  managerEmployeeId: '',
  gmLoginId: '',
  cooLoginId: '',

  alCarry: 0,
  isActive: true,
})

const formError = ref('')

function fillFormFromProfile(p) {
  form.joinDate = toInputDate(p?.joinDate)

  // ✅ approvalMode
  form.approvalMode = normApprovalMode(p?.approvalMode)

  // ✅ manager uses employeeId field; fallback to managerLoginId if old data
  form.managerEmployeeId = String(p?.managerEmployeeId || p?.managerLoginId || '')

  // ✅ GM + COO
  form.gmLoginId = String(p?.gmLoginId || '')
  form.cooLoginId = String(p?.cooLoginId || '')

  form.alCarry = num(p?.alCarry ?? 0)
  form.isActive = p?.isActive === false ? false : true

  originalJoinDate.value = toInputDate(p?.joinDate)
}

const joinDateChanged = computed(() => {
  const a = String(originalJoinDate.value || '')
  const b = String(form.joinDate || '')
  return a !== b
})

const needManager = computed(() => String(form.approvalMode || '') === 'MANAGER_AND_GM')
const needCoo = computed(() => String(form.approvalMode || '') === 'GM_AND_COO')

const isDirty = computed(() => {
  const p = profile.value
  if (!p) return false

  const a = {
    joinDate: toInputDate(p.joinDate),
    approvalMode: normApprovalMode(p.approvalMode),
    managerEmployeeId: String(p.managerEmployeeId || p.managerLoginId || ''),
    gmLoginId: String(p.gmLoginId || ''),
    cooLoginId: String(p.cooLoginId || ''),
    alCarry: num(p.alCarry ?? 0),
    isActive: p.isActive === false ? false : true,
  }

  const b = {
    joinDate: String(form.joinDate || ''),
    approvalMode: normApprovalMode(form.approvalMode),
    managerEmployeeId: String(form.managerEmployeeId || ''),
    gmLoginId: String(form.gmLoginId || ''),
    cooLoginId: String(form.cooLoginId || ''),
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

function validateApprovers() {
  const mode = normApprovalMode(form.approvalMode)

  if (!String(form.gmLoginId || '').trim()) return 'GM Login ID is required.'
  if (mode === 'MANAGER_AND_GM' && !String(form.managerEmployeeId || '').trim()) {
    return 'Approval Mode is Manager + GM, so Manager Employee ID is required.'
  }
  if (mode === 'GM_AND_COO' && !String(form.cooLoginId || '').trim()) {
    return 'Approval Mode is GM + COO, so COO Login ID is required.'
  }
  return ''
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

  const approverErr = validateApprovers()
  if (approverErr) {
    formError.value = approverErr
    showToast({ type: 'error', title: 'Validation', message: approverErr })
    return
  }

  saving.value = true
  try {
    const mode = normApprovalMode(form.approvalMode)

    await updateProfile(
      {
        joinDate: form.joinDate ? String(form.joinDate) : null,
        approvalMode: mode,

        managerEmployeeId: form.managerEmployeeId ? String(form.managerEmployeeId).trim() : null,
        gmLoginId: form.gmLoginId ? String(form.gmLoginId).trim() : null,
        cooLoginId: mode === 'GM_AND_COO' ? String(form.cooLoginId || '').trim() || null : null,

        alCarry: num(form.alCarry),
        isActive: form.isActive !== false,
      },
      { recalc: joinDateChanged.value }
    )

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

/* ───────── InfoRow (ui-card) ───────── */
const InfoRow = defineComponent({
  name: 'InfoRow',
  props: {
    label: { type: String, default: '' },
    value: { type: String, default: '' },
    hint: { type: String, default: '' },
  },
  setup(props) {
    return () =>
      h('div', { class: 'ui-card !rounded-2xl px-3 py-2' }, [
        h(
          'div',
          {
            class: 'ui-label !text-[10px] !font-extrabold !tracking-[0.28em] uppercase ' + (props.hint ? 'cursor-help' : ''),
            title: props.hint || '',
          },
          props.label
        ),
        h('div', { class: 'mt-1 text-[13px] font-semibold text-ui-fg' }, props.value),
      ])
  },
})

/* ✅ lock background scroll for ANY modal */
const anyModalOpen = computed(() => !!renew.open || !!contractsOpen.value)
watch(anyModalOpen, (open) => {
  if (typeof document === 'undefined') return
  document.body.classList.toggle('overflow-hidden', !!open)
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
  if (typeof document !== 'undefined') document.body.classList.remove('overflow-hidden')
})
</script>

<template>
  <div class="ui-page min-h-screen w-full">
    <div class="w-full min-h-screen flex flex-col">
      <!-- Header -->
      <div class="ui-hero rounded-none border-x-0 border-t-0 px-4 py-3">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div class="min-w-[260px]">
            <div class="ui-hero-kicker">Expat Leave · Admin</div>
            <div class="ui-hero-title">Leave Profile Edit</div>
            <div class="ui-hero-subtitle">
              Employee:
              <span class="font-mono font-semibold">{{ employeeId || '—' }}</span>
              <span class="mx-2 opacity-60">•</span>
              Manage join date, approvers, balances & contracts.
            </div>

            <div class="mt-2 flex flex-wrap items-center gap-2">
              <span v-if="isDirty" class="ui-badge ui-badge-indigo">Unsaved changes</span>
              <span v-if="joinDateChanged" class="ui-badge">Join date changed → recalc</span>
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-end gap-2">
            <button type="button" class="ui-btn ui-btn-ghost" @click="goBack">
              <i class="fa-solid fa-arrow-left text-[11px]" />
              Back
            </button>

            <button
              type="button"
              class="ui-btn ui-btn-soft"
              :disabled="loading || saving || !profile || !isDirty"
              @click="resetForm"
              :title="!isDirty ? 'No changes' : 'Reset changes'"
            >
              <i class="fa-solid fa-rotate-left text-[11px]" />
              Reset
            </button>

            <button type="button" class="ui-btn ui-btn-soft" :disabled="loading || !profile" @click="openContractsModal">
              <i class="fa-regular fa-folder-open text-[11px]" />
              Logs
            </button>

            <button type="button" class="ui-btn ui-btn-soft" :disabled="loading || !profile" @click="openRenewModal">
              <i class="fa-solid fa-arrows-rotate text-[11px]" />
              Renew
            </button>

            <button
              type="button"
              class="ui-btn ui-btn-primary"
              :disabled="loading || saving || !profile || !isDirty"
              @click="saveProfile"
              :title="!isDirty ? 'No changes' : (joinDateChanged ? 'Save + Recalculate balances' : 'Save changes')"
            >
              <i class="fa-solid" :class="saving ? 'fa-circle-notch fa-spin' : 'fa-floppy-disk'" />
              Save
              <span v-if="joinDateChanged" class="ml-1 ui-badge">+recalc</span>
            </button>

            <button type="button" class="ui-btn ui-btn-ghost" :disabled="loading" @click="fetchProfile()">
              <i class="fa-solid fa-rotate text-[11px]" :class="loading ? 'fa-spin' : ''" />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-y-auto ui-scrollbar px-3 sm:px-4 lg:px-6 py-3 space-y-3">
        <!-- Error -->
        <div
          v-if="error"
          class="ui-card !rounded-2xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-[11px] text-rose-700
                 dark:border-rose-700/70 dark:bg-rose-950/40 dark:text-rose-100"
        >
          <span class="font-semibold">Failed:</span> {{ error }}
        </div>

        <!-- Loading -->
        <div v-if="loading" class="space-y-2">
          <div class="ui-card !rounded-2xl h-12 animate-pulse bg-ui-bg-2/60" />
          <div class="ui-card !rounded-2xl h-40 animate-pulse bg-ui-bg-2/60" />
          <div class="ui-card !rounded-2xl h-40 animate-pulse bg-ui-bg-2/60" />
        </div>

        <template v-else>
          <div v-if="!profile" class="py-8 text-center text-[11px] text-ui-muted">
            Profile not loaded.
          </div>

          <template v-else>
            <!-- Top summary -->
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <InfoRow label="Employee ID" :value="profile.employeeId || '—'" hint="Read-only" />
              <InfoRow label="Name" :value="profile.name || '—'" hint="Read-only" />
              <InfoRow label="Department" :value="profile.department || '—'" hint="Read-only" />
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <!-- Settings -->
              <section class="ui-card lg:col-span-2 p-3">
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <div class="text-[12px] font-extrabold text-ui-fg">Profile settings</div>
                    <div class="text-[11px] text-ui-muted">
                      Changing Join Date affects accrual. Approval mode controls workflow.
                    </div>
                  </div>
                </div>

                <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <!-- Join Date -->
                  <div class="ui-card !rounded-2xl px-3 py-2">
                    <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase cursor-help" title="Controls AL accrual and service-year rules">
                      Join date
                    </div>
                    <div class="mt-1">
                      <input v-model="form.joinDate" type="date" class="ui-date w-full" />
                      <div class="mt-1 text-[11px] text-ui-muted">
                        Current: <span class="font-mono">{{ fmtYMD(profile.joinDate) }}</span>
                        <span v-if="joinDateChanged" class="ml-2 ui-badge">Changed → will recalc</span>
                      </div>
                    </div>
                  </div>

                  <!-- Contract start (read-only) -->
                  <InfoRow
                    label="Current contract start"
                    :value="fmtYMD(profile.contractDate)"
                    hint="To change contract date, use Renew"
                  />

                  <!-- Approval mode -->
                  <div class="ui-card !rounded-2xl px-3 py-2 sm:col-span-2">
                    <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase cursor-help" title="Approval chain for this employee profile">
                      Approval mode
                    </div>

                    <div class="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <select v-model="form.approvalMode" class="ui-select w-full">
                        <option v-for="m in APPROVAL_MODES" :key="m.value" :value="m.value">
                          {{ m.label }}
                        </option>
                      </select>

                      <div class="ui-card !rounded-2xl px-3 py-2 bg-ui-bg-2/60">
                        <div class="text-[11px] font-extrabold text-ui-fg">Rule</div>
                        <div class="mt-0.5 text-[11px] text-ui-muted">
                          <span v-if="needManager">Manager is required.</span>
                          <span v-else>COO is required.</span>
                          <span class="ml-1 opacity-70">GM is always required.</span>
                        </div>
                      </div>
                    </div>

                    <div class="mt-1 text-[11px] text-ui-muted">
                      Current: <span class="font-mono">{{ normApprovalMode(profile.approvalMode) }}</span>
                    </div>
                  </div>

                  <!-- AL carry -->
                  <div class="ui-card !rounded-2xl px-3 py-2">
                    <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase cursor-help" title="SP can make AL negative. Debt carries forward.">
                      AL carry (debt allowed)
                    </div>
                    <div class="mt-1">
                      <input v-model.number="form.alCarry" type="number" step="0.5" class="ui-input w-full" placeholder="0" />
                      <div class="mt-1 text-[11px] text-ui-muted">
                        Current: <span class="font-mono">{{ fmt(profile.alCarry ?? 0) }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Active -->
                  <div class="ui-card !rounded-2xl px-3 py-2">
                    <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase cursor-help" title="If inactive, employee cannot request leave">
                      Active
                    </div>
                    <div class="mt-2 flex items-center justify-between gap-3">
                      <div class="text-[12px] font-extrabold text-ui-fg">
                        {{ form.isActive ? 'Yes' : 'No' }}
                      </div>
                      <button type="button" class="ui-btn ui-btn-soft ui-btn-sm" @click="form.isActive = !form.isActive">
                        <i class="fa-solid" :class="form.isActive ? 'fa-toggle-on' : 'fa-toggle-off'" />
                        Toggle
                      </button>
                    </div>
                    <div class="mt-1 text-[11px] text-ui-muted">
                      Current: <span class="font-mono">{{ profile.isActive === false ? 'No' : 'Yes' }}</span>
                    </div>
                  </div>

                  <!-- Manager employeeId -->
                  <div class="ui-card !rounded-2xl px-3 py-2">
                    <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase cursor-help" :title="needManager ? 'Required for Manager + GM' : 'Optional (skipped if empty)'">
                      Manager employee ID
                      <span v-if="needManager" class="ml-2 ui-badge">required</span>
                    </div>
                    <div class="mt-1">
                      <input
                        v-model="form.managerEmployeeId"
                        type="text"
                        placeholder="Example: 51820386"
                        class="ui-input w-full"
                      />
                      <div class="mt-1 text-[11px] text-ui-muted">
                        Current: <span class="font-mono">{{ profile.managerEmployeeId || profile.managerLoginId || '—' }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- GM login -->
                  <div class="ui-card !rounded-2xl px-3 py-2">
                    <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase cursor-help" title="Approver loginId with role LEAVE_GM (required)">
                      GM login ID <span class="ml-1 text-rose-600 font-extrabold">*</span>
                    </div>
                    <div class="mt-1">
                      <input v-model="form.gmLoginId" type="text" placeholder="Example: leave_gm" class="ui-input w-full" />
                      <div class="mt-1 text-[11px] text-ui-muted">
                        Current: <span class="font-mono">{{ profile.gmLoginId || '—' }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- COO login (only if needed) -->
                  <div v-if="needCoo" class="ui-card !rounded-2xl px-3 py-2 sm:col-span-2">
                    <div class="ui-label !text-[10px] !tracking-[0.28em] uppercase cursor-help" title="Required when approval mode is GM + COO">
                      COO login ID <span class="ml-1 text-rose-600 font-extrabold">*</span>
                    </div>
                    <div class="mt-1">
                      <input v-model="form.cooLoginId" type="text" placeholder="Example: leave_coo" class="ui-input w-full" />
                      <div class="mt-1 text-[11px] text-ui-muted">
                        Current: <span class="font-mono">{{ profile.cooLoginId || '—' }}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  v-if="formError"
                  class="mt-3 ui-card !rounded-2xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-[11px] text-rose-700
                         dark:border-rose-700/70 dark:bg-rose-950/40 dark:text-rose-100"
                >
                  <span class="font-semibold">Validation:</span> {{ formError }}
                </div>
              </section>

              <!-- Balances (compact / shrink-to-content) -->
              <section class="ui-card p-3">
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <div class="text-[12px] font-extrabold text-ui-fg">Balances</div>
                    <div class="text-[11px] text-ui-muted">
                      As of <span class="font-mono">{{ profile.balancesAsOf || '—' }}</span>
                    </div>
                  </div>
                </div>

                <div v-if="!normalizedBalances.length" class="mt-2 text-[11px] text-ui-muted">
                  No balances yet.
                </div>

                <div v-else class="mt-2">
                  <!-- ✅ important: inline-block + table w-auto => table won't stretch full width -->
                  <div class="inline-block max-w-full overflow-x-auto ui-scrollbar rounded-xl border border-ui-border/60">
                    <table class="w-auto table-auto text-[11px] leading-tight">
                      <thead class="bg-ui-bg-2/60">
                        <tr class="text-ui-muted">
                          <th class="px-[26px] py-[13px] text-left text-[10px] font-extrabold">Type</th>
                          <th class="px-[26px] py-[13px] text-right text-[10px] font-extrabold">Used</th>
                          <th class="px-[26px] py-[13px] text-right text-[10px] font-extrabold">Remain</th>
                        </tr>
                      </thead>

                      <tbody>
                        <tr
                          v-for="b in normalizedBalances"
                          :key="b.leaveTypeCode"
                          class="border-t border-ui-border/60"
                        >
                          <td class="px-[26px] py-[13px] font-extrabold text-ui-fg">
                            {{ b.leaveTypeCode }}
                          </td>

                          <td class="px-[26px] py-[13px] text-right font-mono text-ui-fg">
                            {{ fmt(b.used) }}
                          </td>

                          <td class="px-[26px] py-[13px] text-right font-mono">
                            <span
                              class="inline-flex items-center rounded-full px-[6px] py-[1px] text-[10px] font-extrabold"
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
                </div>

                <div class="mt-2 text-[10px] text-ui-muted">
                  Tip: If Join Date changed, Save will try to recalc balances.
                </div>
              </section>
            </div>

            <!-- Contract history -->
            <section class="ui-card p-3">
              <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
                <div>
                  <div class="text-[12px] font-extrabold text-ui-fg">Contract history</div>
                  <div class="text-[11px] text-ui-muted">Newest first. Full view also available in Logs.</div>
                </div>
                <div class="text-[11px] text-ui-muted">{{ contractHistory.length }} log(s)</div>
              </div>

              <div v-if="!contractHistory.length" class="mt-4 py-6 text-center text-[11px] text-ui-muted">
                No contract history.
              </div>

              <div v-else class="mt-3 ui-table-wrap ui-scrollbar">
                <table class="ui-table min-w-[980px]">
                  <thead>
                    <tr>
                      <th class="ui-th">#</th>
                      <th class="ui-th">Start</th>
                      <th class="ui-th">End</th>
                      <th class="ui-th text-right">AL Carry</th>
                      <th class="ui-th">Snapshot</th>
                      <th class="ui-th">Note</th>
                    </tr>
                  </thead>

                  <tbody>
                    <tr v-for="(c, idx) in contractHistory" :key="c._id || c.createdAt || idx" class="ui-tr-hover">
                      <td class="ui-td font-mono">{{ c.contractNo ?? (idx + 1) }}</td>
                      <td class="ui-td font-mono">{{ c.startDate || '—' }}</td>
                      <td class="ui-td font-mono">{{ c.endDate || '—' }}</td>
                      <td class="ui-td text-right font-mono">{{ fmt(c.alCarrySnapshot ?? c.alCarry ?? 0) }}</td>

                      <td class="ui-td">
                        <div class="text-[11px] text-ui-muted">
                          <div v-if="Array.isArray(c.balancesSnapshot)">
                            <span
                              v-for="b in c.balancesSnapshot"
                              :key="String(b.leaveTypeCode) + String(c.createdAt)"
                              class="mr-2 mb-1 inline-flex ui-badge"
                            >
                              {{ String(b.leaveTypeCode).toUpperCase() }}:
                              U{{ fmt(b.used) }} / R{{ fmt(b.remaining) }}
                            </span>
                          </div>
                          <div v-else class="opacity-60">—</div>
                        </div>
                      </td>

                      <td class="ui-td">
                        <div class="max-w-[260px] truncate text-[11px] text-ui-muted">
                          {{ c.note || '—' }}
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </template>
        </template>
      </div>

      <!-- Renew modal -->
      <transition name="modal-fade">
        <div v-if="renew.open" class="ui-modal-backdrop" @click.self="closeRenewModal">
          <div class="ui-modal max-h-[calc(100vh-3rem)] w-full max-w-2xl flex flex-col overflow-hidden">
            <div class="ui-hero rounded-b-none px-4 py-3">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <div class="text-[14px] font-extrabold text-ui-fg">Renew contract</div>
                  <div class="text-[11px] text-ui-muted">
                    {{ profile?.employeeId }} · {{ profile?.name || '—' }}
                  </div>
                </div>
                <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm" :disabled="renew.submitting" @click="closeRenewModal">
                  <i class="fa-solid fa-xmark text-xs" />
                </button>
              </div>
            </div>

            <div class="flex-1 overflow-y-auto ui-scrollbar px-4 py-3 space-y-3">
              <div class="grid gap-3 sm:grid-cols-2">
                <div>
                  <div class="ui-label">New contract start date</div>
                  <input v-model="renew.newContractDate" type="date" class="ui-date w-full" />
                </div>

                <div>
                  <div class="ui-label">Clear unused AL?</div>
                  <div class="ui-card !rounded-2xl px-3 py-2">
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div class="text-[12px] font-extrabold text-ui-fg">
                          {{ renew.clearOldLeave ? 'Yes (clear AL to 0)' : 'No (carry AL forward)' }}
                        </div>
                        <div class="mt-1 text-[11px] text-ui-muted">
                          ON: positive AL cleared, negative debt remains. OFF: carry everything.
                        </div>
                      </div>

                      <button type="button" class="ui-btn ui-btn-soft ui-btn-sm" @click="renew.clearOldLeave = !renew.clearOldLeave">
                        <i class="fa-solid" :class="renew.clearOldLeave ? 'fa-toggle-on' : 'fa-toggle-off'" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div class="ui-label">Note (optional)</div>
                <textarea v-model="renew.note" rows="3" class="ui-input w-full" placeholder="Example: renewed contract for 3 months" />
              </div>

              <div
                v-if="renew.error"
                class="ui-card !rounded-2xl border border-rose-200 bg-rose-50/80 px-3 py-2 text-[11px] text-rose-700
                       dark:border-rose-700/70 dark:bg-rose-950/40 dark:text-rose-100"
              >
                <span class="font-semibold">Failed:</span> {{ renew.error }}
              </div>
            </div>

            <div class="shrink-0 flex items-center justify-end gap-2 border-t border-ui-border/60 bg-ui-card/70 px-4 py-3">
              <button type="button" class="ui-btn ui-btn-ghost" :disabled="renew.submitting" @click="closeRenewModal">
                Cancel
              </button>

              <button type="button" class="ui-btn ui-btn-primary" :disabled="renew.submitting" @click="submitRenew">
                <i class="fa-solid" :class="renew.submitting ? 'fa-circle-notch fa-spin' : 'fa-arrows-rotate'" />
                {{ renew.submitting ? 'Saving…' : 'Renew' }}
              </button>
            </div>
          </div>
        </div>
      </transition>

      <!-- Contract logs modal -->
      <transition name="modal-fade">
        <div v-if="contractsOpen" class="ui-modal-backdrop" @click.self="contractsOpen = false">
          <div class="ui-modal max-h-[calc(100vh-3rem)] w-full max-w-5xl flex flex-col overflow-hidden">
            <div class="ui-hero rounded-b-none px-4 py-3">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <div class="text-[14px] font-extrabold text-ui-fg">Contract logs</div>
                  <div class="text-[11px] text-ui-muted">{{ profile?.employeeId }} · {{ profile?.name || '—' }}</div>
                </div>
                <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm" @click="contractsOpen = false">
                  <i class="fa-solid fa-xmark text-xs" />
                </button>
              </div>
            </div>

            <div class="flex-1 overflow-y-auto ui-scrollbar px-4 py-3">
              <p v-if="!contractHistory.length" class="text-[11px] text-ui-muted">No contract logs yet.</p>

              <div v-else class="ui-table-wrap ui-scrollbar">
                <table class="ui-table min-w-[980px]">
                  <thead>
                    <tr>
                      <th class="ui-th">#</th>
                      <th class="ui-th">Start</th>
                      <th class="ui-th">End</th>
                      <th class="ui-th text-right">AL Carry</th>
                      <th class="ui-th">Snapshot</th>
                      <th class="ui-th">Note</th>
                      <th class="ui-th">By</th>
                      <th class="ui-th">At</th>
                    </tr>
                  </thead>

                  <tbody>
                    <tr v-for="(c, idx) in contractHistory" :key="c._id || c.createdAt || idx" class="ui-tr-hover">
                      <td class="ui-td font-mono">{{ c.contractNo ?? (idx + 1) }}</td>
                      <td class="ui-td font-mono">{{ c.startDate || '—' }}</td>
                      <td class="ui-td font-mono">{{ c.endDate || '—' }}</td>
                      <td class="ui-td text-right font-mono">{{ fmt(c.alCarrySnapshot ?? c.alCarry ?? 0) }}</td>

                      <td class="ui-td">
                        <div class="text-[11px] text-ui-muted">
                          <div v-if="Array.isArray(c.balancesSnapshot)">
                            <span
                              v-for="b in c.balancesSnapshot"
                              :key="String(b.leaveTypeCode) + String(c.createdAt)"
                              class="mr-2 mb-1 inline-flex ui-badge"
                            >
                              {{ String(b.leaveTypeCode).toUpperCase() }}:
                              U{{ fmt(b.used) }} / R{{ fmt(b.remaining) }}
                            </span>
                          </div>
                          <div v-else class="opacity-60">—</div>
                        </div>
                      </td>

                      <td class="ui-td">
                        <div class="max-w-[260px] truncate text-[11px] text-ui-muted">{{ c.note || '—' }}</div>
                      </td>

                      <td class="ui-td font-mono text-[11px]">{{ c.createdBy || '—' }}</td>
                      <td class="ui-td font-mono text-[11px]">
                        {{ c.createdAt ? dayjs(c.createdAt).format('YYYY-MM-DD HH:mm') : '—' }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div class="shrink-0 flex items-center justify-end gap-2 border-t border-ui-border/60 bg-ui-card/70 px-4 py-3">
              <button type="button" class="ui-btn ui-btn-ghost" @click="contractsOpen = false">
                Close
              </button>
            </div>
          </div>
        </div>
      </transition>
    </div>
  </div>
</template>

<style scoped>
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.18s ease-out, transform 0.18s ease-out;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.98);
}
</style>
